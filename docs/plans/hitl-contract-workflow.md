# HITL Contract Workflow — Role Review and Plan

Status: proposal. Owner: product. Written 2026-08-31.

## 1. What exists today

Three unrelated permission systems, plus four unrelated "human checked this" flags.

### 1.1 Permission systems

| Layer | Values | Defined | Enforced |
|---|---|---|---|
| System role | `system_role` (defaults `"user"`) | `apps/backend/core/security.py:108` | Never read for any authorization decision |
| Account role | `team_role: admin \| member`, `role: owner \| member \| individual` | `apps/backend/models/domain.py:74`, `:143` | Team membership CRUD only (`api/routes/teams.py`) |
| Workflow role | `workflowRoles.editorUserId`, `workflowRoles.approverUserId` | `apps/backend/models/domain.py:149` | Per contract, only in `api/routes/workflows.py` |

Workflow roles are set on a single contract at a time
(`api/routes/workflows.py:44`), by the account owner or the uploader, and only
for team-owned documents — personal documents raise 400 (`:89`).

### 1.2 Document state machine (as implemented)

`Uploaded → Processing → Ingested` (worker, `worker/tasks.py:576`)
`→ Editing` (save-draft, `:344`) `→ Pending Approval` (submit, `:627`)
`→ Ingested` (approve, `:746`) or `→ Rejected` (reject).

Personal docs: `complete` also writes `Ingested` (`:919`, docstring says
`Completed`).

**The `Editing` step reviews nothing.** The thing under review is
`process.results` — a list of `QuestionAnswer` (`models/contract_types.py:11`).
Nothing populates it:

- created empty at upload (`api/routes/contracts.py:166`);
- the ingestion worker never writes it (`worker/tasks.py` touches
  `index.status` and `status`, never `process.results`);
- the only writer is `submit-draft`, pushing back whatever the client sent
  (`api/routes/workflows.py:492`);
- `save-draft` rejects an empty list with 400 (`:319`), so an untouched
  contract cannot enter `Editing` at all.

And the client never sends it: `handleSaveDraft`
(`app/contracts/[contract_id]/page.tsx:2108`) and `handleSubmitDraft` (`:2174`)
are declared and never passed to a child component or bound to a control. The
only wired buttons are submit-for-approval, approve, reject, mark-complete and
the re-edit set.

So the live path is: `Ingested → (button) Pending Approval → (button) Ingested`.
The approver approves an artifact that does not exist, and the document lands
back on the status it started from. That is the entire workflow.

### 1.2b The approval that *is* actually used

Agent proposals: `PATCH /agent/workflows/{id}/proposal`, `POST
/agent/workflows/{id}/approve` and `/reject`
(`api/routes/agent.py:283`, `:301`). The user reviews a proposal and approves,
which then writes a tabular review, a KPI extraction, a remembered project fact,
a corrected fact, or a document artifact (`:331`–`:486`).

This is a fifth, entirely separate approval system, and the only one carrying
real human-in-the-loop traffic. Gated by `_require_owned_workflow` (`:216`) —
the requester must own the run. No editor/approver role, no separation of
duties, no audit log, no record of who approved what.

### 1.3 The four independent human-check flags

1. Contract approval — `status` + `workflowRoles` (above).
2. KPI governance — `governance_status: draft|reviewed|certified|deprecated`
   with `certified_by` / `governance_version` (`services/kpi_manager.py:797`).
3. Playbook finding status — `acceptable | not_acceptable | needs_review |
   not_applicable` (`apps/frontend/app/playbooks/[playbook_id]/page.tsx:123`).
4. `needs_review` booleans on extracted KPIs/obligations
   (`services/kpi_manager.py:5537`) and on project memory facts
   (`services/project_memory.py:901`).

None of 2–4 consult `workflowRoles`. None of 2–4 write an audit log.

## 2. Defects found (fix before anything new)

| # | Defect | Evidence |
|---|---|---|
| **D0** | **The approval workflow reviews nothing.** `process.results` is never populated by any server path, and the two client handlers that would populate it are dead code. Submit/approve moves a status field and nothing else. | `api/routes/contracts.py:166`, `worker/tasks.py`, `app/contracts/[contract_id]/page.tsx:2108`, `:2174` |
| **D0b** | The real HITL surface (agent proposal approve/reject) is a separate system with no roles and no audit. | `api/routes/agent.py:216`, `:301` |
| D1 | Approval has no terminal state. `approve` writes `"Ingested"` — the same status the ingestion worker writes. An approved contract is indistinguishable from a freshly OCR'd one in every list, count and filter. | `api/routes/workflows.py:746` vs `worker/tasks.py:576` |
| D2 | Re-edit flow is dead code. `request-reedit` requires `status == "Completed"`; no code path anywhere writes `"Completed"`. Four endpoints (request / approve / deny / acknowledge) are unreachable. | `api/routes/workflows.py:1060`; `grep '"Completed"'` finds only reads |
| D3 | Editor role does not gate editing. `save-draft` and `submit-draft` accept **any** team member; the assigned editor is never checked. | `api/routes/workflows.py:299-313` |
| D4 | No separation of duties. Nothing prevents `editorUserId == approverUserId`, and the account owner may both submit (`:610`) and approve (`:733`) the same document. | `api/routes/workflows.py:44` assignment has no distinctness check |
| D5 | `"Ready to Edit"` is read in six places but never written. | `api/routes/contracts.py:830`, `:1410` |
| D6 | Roles are per-contract only. A 200-document project needs 200 assignments; no project or team default, no inheritance. | no `roles` reference in `api/routes/projects.py` |
| D7 | No notification of any kind. No email transport in the backend at all; websockets carry ingestion progress only. An approver learns work is waiting by refreshing the dashboard. | no `smtplib`/`sendgrid`/`resend` in `apps/backend`; `api/routes/websocket.py` |
| D8 | Audit coverage is workflow-only: 13 `create_audit_log` calls in `workflows.py`, 7 in `contracts.py`, **1** in `kpis.py`, **0** in `tabular_reviews.py`, `playbooks.py`, `projects.py`, `agent.py`. KPI certification — the artifact a CFO relies on — leaves no trail. | grep counts |
| D9 | KPI certify is open to anyone with contract read access. `check_contract_access` only. Any team member can certify a KPI. | `api/routes/kpis.py:757` |
| D10 | `needs_review` is a flag, not work. No queue, no assignee, no resolution endpoint, no aging. | `services/kpi_manager.py:5537`, `services/project_memory.py:901` |

D1–D4 and D9 are the ones a security engineer or an auditor finds in the second
call. They are all small.

## 3. Target model

**One review contract, four reviewable artifact types.**

### 3.1 Roles — collapse to three, scoped at project level

| Role | Can | Scope |
|---|---|---|
| `owner` | assign roles, override with reason, everything below | account |
| `reviewer` (was Editor) | edit drafts, certify-propose, submit for approval | project, overridable per document |
| `approver` | approve / reject / return, cannot edit what they approve | project, overridable per document |

Read access stays as-is (team membership). Roles are assigned on the **project**
and inherited by its contracts; the per-contract override stays for exceptions.
Fixes D6.

Hard rule: `approver != the user who submitted this artifact`. Owner override
allowed but written to the audit log as `SELF_APPROVAL_OVERRIDE`. Fixes D4.

### 3.2 One state machine, reused by every artifact

```
draft ──submit──► pending_approval ──approve──► approved ──request_change──► change_requested
  ▲                     │                                                          │
  └────── return ───────┘                                                          │
  └──────────────────────────── reopen (approver grants) ◄──────────────────────────┘
```

`approved` is terminal and distinct from any ingestion status (fixes D1). The
existing re-edit endpoints map onto `request_change`/`reopen` and become
reachable (fixes D2).

Artifacts that use it: **contract Q&A results** (today), **KPI definitions**
(replaces `governance_status`, keeping the same wire values), **obligations**,
**playbook findings**. `needs_review == true` becomes the automatic reason an
artifact is created in `draft` with an open review item (fixes D10).

### 3.3 One review inbox

`GET /me/review-queue` → items across all four artifact types, each with
`{artifact_type, artifact_id, project, contract, state, assigned_role, waiting_since}`.
Two tabs: *Waiting on me to approve*, *Waiting on me to edit*. This is the
surface that makes the roles visible; today a user cannot see what is assigned
to them without opening documents one by one.

### 3.4 Notification

State transitions emit an event (`services/event_stream.py` already exists) →
in-app badge on the inbox + a daily digest email. Email transport does not exist
yet and must be built. Fixes D7.

### 3.5 Audit

Every transition on every artifact type goes through one helper that writes
`create_audit_log` with `{artifact_type, artifact_id, from_state, to_state,
actor, role_exercised, reason}`. Reason mandatory on reject, return, and any
owner override. Fixes D8.

## 4. Prioritized plan (RICE, capacity 12 person-months)

| # | Item | RICE | Effort |
|---|---|---|---|
| 1 | Separation of duties (`editor != approver`, self-approval blocked + logged) | 200 | XS |
| 2 | Terminal `approved` state; unblock re-edit endpoints | 100 | S |
| 3 | Role-gate `save-draft` / `submit-draft` to the assigned reviewer | 100 | S |
| 4 | Unified review inbox | 60 | M |
| 5 | Audit-log coverage for KPI / playbook / memory actions | 46.7 | S |
| 6 | Notifications (in-app + digest email) | 40 | M |
| 7 | Project-level roles with inheritance | 28.8 | M |
| 8 | Extend approval to KPIs and obligations | 24 | L |
| 9 | `needs_review` triage queue with assignee | 19.2 | M |
| 10 | Delegation / out-of-office reassignment | 10.7 | S |
| — | Multi-step approval chains | 5 | L (post-MVP) |
| — | E-signature / export handoff | 4.5 | L (post-MVP) |

### Phasing

- **Phase 0a — decide what is reviewed.** Blocks everything else. The Q&A
  results object the current workflow wraps is never produced and never edited
  (D0). Either delete it and re-point submit/approve at artifacts that exist —
  KPIs, obligations, playbook findings, agent-proposed artifacts — or build the
  extraction that fills `process.results`. Recommendation: **delete it.** The
  agent proposal flow (§1.2b) already carries the real review traffic; make
  that the artifact the roles govern, and the workflow endpoints become a thin
  state machine over it rather than over an empty list.
- **Phase 0b — one week, correctness.** Items 1–3 and 5. No new UI. Makes the
  claim "the platform enforces reviewer/approver separation with a full audit
  trail" true. This claim is currently false.
- **Phase 1 — three weeks, visibility.** Items 4, 6, 7. The reviewer and the
  approver each get an inbox and get told. This is what makes the roles
  *usable* rather than merely present.
- **Phase 2 — six weeks, coverage.** Items 8–10. Approval stops being
  Q&A-only and covers the artifacts customers actually act on (KPIs,
  obligations).
- **Post-MVP.** Approval chains by contract value; signature handoff.

## 4b. What has shipped

On `chore/ingestion-branch-cleanup`, in order:

| Item | Commit |
|---|---|
| Terminal `Approved` status; re-edit chain unblocked; separation of duties; self-approval guard; audit on KPI certify | `6f83a59` |
| Tests for all of the above | `6f8f5fc` |
| Project-level roles with contract-level override and inheritance everywhere | `6549dc3` |
| `GET /me/review-queue`, `/inbox`, header badge | `ddf4622` |
| Notifications on every handover | `fe80cba` |
| Certification gated on the Approver; delegation | `9de44b1` |
| `needs_review` triage and resolution; `Approved` backfill script | `964abb9` |

Correction to §3.4 above: the backend **does** have an email transport —
Azure Communication Services, already used by the KPI alert and support tasks.
The first pass grepped for smtplib and sendgrid and missed it. No vendor
decision was needed.

Still open from §4: role-gating `save-draft` / `submit-draft` (deliberately
skipped — it guards code no client calls, and Phase 0a may delete it),
multi-step approval chains, and the e-signature handoff.

## 5. Open decisions

1. **Do KPI `governance_status` values survive?** Recommend yes — map
   `draft→draft`, `reviewed→pending_approval`, `certified→approved`,
   `deprecated→archived`, so stored data migrates without a rewrite.
2. **Is personal (non-team) use single-state?** Recommend yes: personal
   documents skip approval entirely and go `draft → approved` via `complete`,
   as today, but write the real terminal status.
3. **Email transport** — no vendor is chosen and none is wired. Phase 1 blocks
   on this pick.
