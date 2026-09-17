# Agent-First CLM — Flow Fix & Re-Architecture Plan

> Branch: `feature/agent-first-clm`
> Author: flow audit — 2026-04-22
> Scope: end-to-end contract lifecycle (intake → draft → negotiate → approve → sign → file → post-sig)
> **Direction change (from 2026-04-22 review):** the primary surface of this product becomes an **agent chat** (Genspark/Claude-Code style). Traditional UI persists for setup, config, and power-user flows. Every CLM action becomes an agent tool.

---

## 0. The thesis

**We are building an agent-first CLM.** Not "CLM with an AI assistant bolted on" — a product whose *default workspace is a chat with an agent that can do the work*, backed by rich embedded UI, with traditional screens reserved for configuration and admin.

This is aligned with where the category is moving (Harvey, Legora, Genspark) and plays to our existing strengths: 12 LangGraph agents, streaming chat, multi-provider LLM support.

But it also requires two things before it can work:

1. **The underlying pipeline must actually function end-to-end.** The agent is only as good as the tools it calls. Broken editor, missing signature, one-way portal — these kill the agent's usefulness just as surely as they kill the UI's.
2. **Every CLM action must be exposed as a first-class tool with a clear contract.** The agent doesn't "click buttons" — it calls tools. Tool surface = product surface.

So the plan becomes: **fix the pipeline AND define the tool surface in the same pass**, then layer an agent-first primary UX on top, then iterate.

---

## 1. Confirmed decisions (from 2026-04-22 product review)

| # | Question | Decision | Why it matters |
|---|----------|----------|----------------|
| 1 | Users | **Cross-functional teams** (legal + sales + procurement + finance + exec) | Role-aware sidebar is required. Agent context must know user's role. Permission model stays non-trivial. |
| 2 | Counterparty flow | **Both portal AND email-redline** | Portal is our Legora-style differentiator; email is the realistic legacy path. Scope doubles on P1.2. |
| 3 | Canonical artifact | **Hybrid — original PDF canonical until first edit, then regenerated from HTML; both tracked** | Preserves counterparty formatting; still lets our edits flow through to signed artifact. Diff always available. |
| 4 | eSignature | **Self-hosted** (Phase 07 as originally scoped) | `pdf-lib` + `node-forge` + internal signing portal. No DocuSign dependency. |
| 5 | Product direction | **Agent-first with UI for setup** | Changes primary surface from "Dashboard + 14 sidebar items" to "agent chat + setup screens". |

These decisions are now binding. They enter the Architecture Decisions Log in BUILD_TRACKER once this plan is accepted.

---

## 2. What agent-first actually means (concrete)

### 2.1 The default workspace

Replace the current Dashboard with an **Agent Home**:

```
┌─ CLM Platform ──────────────────── 🔍 Search  🛎 Notif  👤 Admin ─┐
│                                                                    │
│        What would you like to do today?                            │
│                                                                    │
│   ┌──────────────────────────────────────────────────────────┐     │
│   │ ▸ Draft a vendor agreement with Stark Industries…        │     │
│   └──────────────────────────────────────────────────────────┘     │
│                                                                    │
│   Suggested                                                        │
│   ┌────────────────┐ ┌────────────────┐ ┌────────────────┐         │
│   │ 3 waiting on   │ │ 2 expire this  │ │ 1 redline from │         │
│   │ your approval  │ │ quarter        │ │ Zynga today    │         │
│   │ → Review now   │ │ → Plan renewals│ │ → Open         │         │
│   └────────────────┘ └────────────────┘ └────────────────┘         │
│                                                                    │
│   Recent                                                           │
│   [WPT-Zynga License] [Massive Dynamic MSA] [Pied Piper NDA]       │
│                                                                    │
├─ CORE / LEGAL / ADMIN (collapsible sidebar, role-filtered) ────────┤
```

- Single input field = the entry point for everything.
- "Suggested" cards = the agent surfacing what needs this user's attention *right now*.
- Recent = quick jump back into active contracts.
- Sidebar still exists, role-filtered, collapsible (sales rep sees 3 items; legal ops sees 10).

### 2.2 The interaction pattern (plan-then-execute)

When a user types "Draft an NDA with Zynga for IP licensing, $2M, auto-renewal, send to legal for review":

```
  Agent (thinking…)
  ┌──────────────────────────────────────────────────────────┐
  │ Here's what I'll do:                                      │
  │                                                           │
  │ ☐ 1. Create draft from "Mutual NDA — Standard" template  │
  │ ☐ 2. Set counterparty: Zynga Inc. (existing)             │
  │ ☐ 3. Set value: $2,000,000 USD                           │
  │ ☐ 4. Insert auto-renewal clause from playbook (favorable)│
  │ ☐ 5. Submit for review to: Legal Counsel                 │
  │                                                           │
  │ [Modify]  [Execute]                                      │
  └──────────────────────────────────────────────────────────┘
```

User confirms → agent streams execution → rich response lands in the chat:

```
  Agent:  Done. Contract drafted and sent for review.
          ┌───────────────────────────────────────────┐
          │ 📄 NDA — Zynga (IP Licensing, 2026)       │
          │ Status: IN_REVIEW · Due Apr 24            │
          │ Risk: Medium (auto-renewal flagged)       │
          │ Reviewer: Legal Counsel                   │
          │ [Open in editor]  [View status]           │
          └───────────────────────────────────────────┘
```

Cards are interactive — click opens the document-first detail page (which still exists for power users).

### 2.3 Two navigation modes coexist

- **Agent mode (default):** chat-driven, agent orchestrates tool calls, UI renders results as cards.
- **UI mode (power users + setup):** traditional screens remain for templates, playbooks, workflows, roles, org admin, custom fields, clause library. Invoked via sidebar or via agent command ("take me to the template editor for NDAs").

The agent can navigate into UI mode and back. UI mode has an "Ask agent about this" shortcut on every screen that returns to chat with contract context pre-loaded.

---

## 3. Current state — what actually happens today

### 3.1 The six breaks (unchanged from prior draft)

1. **Editor hijacks uploaded PDFs** — draft agent writes `"No suitable template found. Please create a template first."` as the HTML body when no template matches. See [apps/agents/app/agents/draft_agent.py:276](../apps/agents/app/agents/draft_agent.py).
2. **Two parallel DRAFT→APPROVED tracks.** Manual status-tick track ([ContractDetailPage.tsx:97](../apps/web/src/pages/ContractDetailPage.tsx)) vs. workflow track ([routes/contracts.ts:1093](../apps/api/src/routes/contracts.ts)) never reconcile.
3. **`APPROVED → EXECUTED` is a manual lie** — no signature implementation. `PENDING_SIGNATURE` unreachable.
4. **Portal is one-way** — only `GET /:token/contract` + `POST /:token/comments` in [routes/portal.ts](../apps/api/src/routes/portal.ts).
5. **Versions, attachments, parent/child = three overlapping UIs** for closely-related data.
6. **Post-execution void** — no obligations, renewals, or expiry automation.

### 3.2 State machine today

Enum defines 10 states ([packages/types/src/enums.ts:1-12](../packages/types/src/enums.ts)); UI exposes 6 transitions ([ContractDetailPage.tsx:97-105](../apps/web/src/pages/ContractDetailPage.tsx)); `PENDING_SIGNATURE`, `EXPIRED`, `TERMINATED` all unreachable by code.

### 3.3 Additional seams (P3 polish)

Canonical artifact flip (PDF vs HTML), request-contract lineage invisible, stale AI text on failed analysis, raw user cuid in activity, `CONTRACT_VIEWED` spam, unexplained colored dots, `Failed` chip + `DRAFT` status double-signal, seed pollution (`Aniket NDA`, `Temp`, `My Categoty`, duplicate categories), flaky 422 on clauses first-load, profile email/password rendering, 0-permission roles (FINANCE / PROCUREMENT / SALES_REP).

---

## 4. Target state

### 4.1 One state machine (unchanged — applies to both chat and UI mode)

```
  Entry points (3 → 1 output):
    A) Upload PDF ─┐
    B) Template   ─┼─► DRAFT
    C) Convert    ─┘
                   │
                   ▼
   (optional, threshold-gated, agent can skip)
                   │
              IN_REVIEW ─────► UNDER_NEGOTIATION ⇄ portal/email redlines
                   │                   │
                   │                   ▼ (user or agent)
                   └──────────► PENDING_APPROVAL
                                       │
                             ┌─────────┴─────────┐
                             ▼                   ▼
                          APPROVED          REJECTED → back to DRAFT + reason
                             │
                             ▼
                      PENDING_SIGNATURE
                             │
                             ▼
                         EXECUTED
                             │
                             ▼
                          ACTIVE  ── EXPIRING (90/60/30 alerts) ─► EXPIRED
                             │                                        │
                             └─► AMENDED  ── TERMINATED ─► ARCHIVED  ◄┘
```

### 4.2 Hybrid canonical artifact (per Decision #3)

```
  ContractVersion:
    ┌─────────────────────────────────────────────────────┐
    │ id, versionNumber, createdAt, authorId              │
    │                                                      │
    │ sourceFile      : S3 URI (original PDF, if uploaded)│
    │ htmlContent     : extracted/edited HTML              │
    │ renderedPdfFile : S3 URI (null until first edit)    │
    │ canonicalIs     : 'source' | 'rendered'              │
    └─────────────────────────────────────────────────────┘

  Rules:
  • On upload:           canonicalIs = 'source',  renderedPdfFile = null
  • On first HTML edit:  canonicalIs = 'rendered', renderedPdfFile = Gotenberg(HTML)
                         sourceFile preserved for diff-against-original
  • Signers see:         whichever is canonical
  • Diff view:           always both available, side-by-side
  • Counterparty portal: sees canonical
```

### 4.3 Two-way portal + email redline ingestion (per Decision #2)

**Portal (expand existing):**
- `POST /portal/:token/versions` — counterparty uploads redlined PDF → becomes `v(n+1)` with `author: portal:<linkId>`
- `POST /portal/:token/decisions` — counterparty accepts/rejects specific clauses
- UI: "Propose counter-version" button on external portal

**Email (new):**
- Dedicated inbound email address per org (`contracts+<contractId>@mail.ourdomain.com`)
- `imapflow`-based listener, or SendGrid inbound parse
- Attached PDF → pipe through parse + classify → attached as new version
- `REDLINE_INGESTED` audit event

### 4.4 Role-aware sidebar (per Decision #1)

Sidebar items filtered by `usePermission()` per role. A Sales Rep sees:

```
  Agent Home (default)
  CORE
    My Requests
    My Contracts
  ── (everything else hidden)
```

A Legal Ops user sees the full 14-item nav. "Show all" toggle in header for users with custom mixes of permissions.

### 4.5 Self-hosted eSignature (per Decision #4)

Phase 07 as originally scoped in BUILD_TRACKER:
- Tables: `signature_requests`, `signers`, `signature_events`
- `pdf-lib` for field injection, `node-forge` for X.509 signing
- Internal signing portal (token-gated page, unauthenticated access via signed JWT per signer)
- Both internal (JWT auth) and external (tokenized link) signers supported
- Reminder scheduler via BullMQ delayed jobs
- Signed PDF re-stored as final version

---

## 5. The tool surface (the heart of agent-first)

Every action the agent can take is a first-class tool with: JSON schema, permission check, audit hook, rich-response formatter. Tools are defined once, used by both the agent AND the API. This is the foundational work of agent-first.

### 5.1 Tool catalog (initial set — v1)

**Contract lifecycle**
- `contracts.create_from_template(templateId, variables, counterpartyId?, metadata?)`
- `contracts.upload(file, counterpartyId?, parentContractId?, relationshipType?)`
- `contracts.get(contractId)`
- `contracts.update(contractId, patch)`
- `contracts.delete(contractId)`
- `contracts.search(query, filters, sort, limit)`
- `contracts.ask(contractId, question)` — RAG chat, returns answer + [Clause N] citations
- `contracts.compare_versions(contractId, fromVersion, toVersion)` — returns structured diff

**State transitions**
- `contracts.send_for_review(contractId, reviewers?, workflowId?, deadline?)`
- `contracts.submit_for_approval(contractId, workflowId?)`
- `contracts.approve(instanceId, stepId, comment?)`
- `contracts.reject(instanceId, stepId, reason)`
- `contracts.delegate(instanceId, stepId, toUserId, comment?)`
- `contracts.send_for_signature(contractId, signers[], order?)`
- `contracts.mark_executed(contractId)` — only callable when all sigs complete (enforced)
- `contracts.amend(parentContractId, amendmentReason)`
- `contracts.terminate(contractId, reason, effectiveDate)`

**Negotiation**
- `contracts.add_comment(contractId, text, clauseRef?, parentCommentId?)`
- `contracts.resolve_comment(commentId)`
- `contracts.propose_redline(contractId, clauseRef, suggestedText)`
- `contracts.share(contractId, expiresInDays?, permissions, label?)` — generates portal link
- `contracts.send_to_counterparty(contractId, email, message?)` — emails portal link

**Post-signature**
- `contracts.get_obligations(contractId)` (Phase 08)
- `contracts.complete_obligation(obligationId, evidenceFile?)` (Phase 08)
- `contracts.schedule_renewal(contractId)` (Phase 08)

**Setup/admin (agent can navigate, can't modify without UI confirmation)**
- `templates.list(type?, status?)`
- `templates.create(name, type, sections)` — requires UI confirmation
- `workflows.list(isDefault?)`
- `users.invite(email, name, roles)` — requires UI confirmation
- `counterparties.create(name, email?, website?)`
- `clauses.search(text, favored?)`

**Reporting**
- `reports.team_workload()` — who's overloaded, OOO, etc.
- `reports.expiring(days)` — contracts expiring in N days
- `reports.overdue_approvals()` — stuck approvals past SLA
- `reports.contract_stats(groupBy?, filter?)` — counts and values by dimension

**Rule:** every tool has permission scope. Agent cannot do what the user cannot do. Tool call = same authorization path as API call.

### 5.2 Rich response components

Each of these is a React component that renders inside the agent's chat stream:

| Component | Purpose |
|-----------|---------|
| `<ContractCard>` | thumbnail, title, status badge, next action button |
| `<ContractList>` | table of cards for search/filter results |
| `<DiffViewer>` | side-by-side or inline diff between two versions |
| `<StatusStepper>` | horizontal stepper: DRAFT → IN_REVIEW → … → EXECUTED |
| `<ApprovalTimeline>` | per-step status with approver, timestamp, comments |
| `<ObligationList>` | upcoming/overdue obligations with action buttons |
| `<ShareLinkCard>` | copyable URL + QR + expiration + permissions badge |
| `<PlanPreview>` | agent's proposed plan with checkboxes + Execute/Modify |
| `<ToolCallStream>` | live execution of a plan — each step flips to ✓ as it completes |
| `<ContractThumbnail>` | lightweight preview (first page + top clauses) |

These render from structured agent output (JSON), not from markdown. Tight contract between agent and UI.

---

## 6. The fix plan — user flow first, agent surface last

> **Build-order decision (2026-04-22):** fix the traditional user flow (pipeline + journey UI) before layering the agent on top. The product is still agent-first; the *build order* is pipeline → UI → post-sig → agent.
>
> Rationale: the agent is only as useful as the tools it calls. A working UI is also the fallback when the agent misunderstands. Shipping the agent surface first would mean betting everything on agent reliability from day one — too much risk for too long.
>
> Phases renamed A/B/C/D/E to reflect execution order (no more P0/P1/P2 inversion ambiguity).

### Phase A — Pipeline fixes (est. 3 weeks)

**Goal:** unbreak every seam in the pipeline. A contract can go upload → edit → review → negotiate → approve → sign → executed via API without DB hand-ticks.

**Status (2026-04-22): 4 of 8 done.**

| # | Change | Status | Files | Acceptance |
|---|--------|--------|-------|-----------|
| A.1 | **Decouple editor from draft agent.** Editor always loads latest `ContractVersion.htmlContent`. Draft agent only runs on `create_from_template`, never on editor open. | ✅ done (d76588c) | `apps/agents/app/agents/draft_agent.py`, `apps/web/src/pages/ContractDetailPage.tsx` | Open editor on any uploaded PDF → extracted HTML shows, not the template error. |
| A.2 | **Remove draft agent's error-as-HTML fallback.** Return typed error `NO_TEMPLATE_MATCH` instead. | ✅ done (bundled in A.1) | `draft_agent.py:276` | 422 response + UI error banner, not broken HTML. |
| A.3 | **Collapse two buttons into one "Send for Review".** Always routes through `/submit-approval`; primary CTA filled blue. | ✅ done (d7c52b6) | `ContractDetailPage.tsx` | One button visible per state. |
| A.5 | **Hybrid canonical artifact.** Add `renderedPdfKey` + `renderedAt` to `ContractVersion`. On every HTML save → Gotenberg renders PDF → stored as canonical. `s3Key` remains as source for diff. | ✅ done (1b8244e) | `prisma/schema.prisma` migration, `lib/gotenberg.ts`, `routes/contracts.ts` (/html-version fires render async; /download serves canonical) | Upload PDF → edit in editor → signed PDF matches edited content; original PDF still accessible. |
| A.8 | **State-machine stepper component.** `<StatusStepper>` — horizontal stepper driven by the state enum. Used first on detail page; reused in Phase B and D. | ✅ done (44db41e) | `components/contracts/StatusStepper.tsx` | Detail page shows the stepper with current state highlighted. |
| A.4 | **Build Phase 07 — self-hosted eSignature.** Tables, routes, worker, `pdf-lib` + `node-forge` signing, reminder scheduler, internal signing portal with both JWT and tokenized-link support. `PENDING_SIGNATURE` becomes reachable; `EXECUTED` is no longer a lie. | ⏳ next (after B.1) | New: `routes/signatures.ts`, `workers/signature.worker.ts`, `pages/SignaturePrepPage.tsx`, `pages/SignerPortal.tsx`, migration | End-to-end signed contract demo passes. |
| A.6 | **Two-way portal.** `POST /portal/:token/versions`, `POST /portal/:token/decisions`. UI: "Propose counter-version" button on external portal page. | ⏳ pending | `routes/portal.ts`, `pages/ExternalPortalPage.tsx` | Counterparty uploads redline → appears as v(n+1) in our detail page. |
| A.7 | **Email-redline inbound.** Dedicated per-org inbound address, IMAP listener or SendGrid inbound parse, pipes attached PDFs through parse pipeline + attaches as new version. | ⏳ pending | New `workers/inbound-email.worker.ts`, route handler, env config | Send an email with PDF attachment to `contracts+<id>@…` → new version appears within 60s. |

**Note on ordering (2026-04-22 revision):** after A.1/A.3/A.5/A.8 landed, the detail page was *less broken* but not *simpler*. The user's original complaint — "I don't see the contract" — is still true because the document is hidden behind a tab. **B.1 (document-first detail page) is pulled forward to run next, before A.4.** That way signature UI (A.4) layers onto a clean page, not the cluttered one.

**Deferred from prior plan:** tool registry — moved to Phase D where it actually gets consumed. Endpoints built in A stay as clean REST; wrapping as tools in D is a thin layer.

**Exit criteria for A:** API end-to-end test — upload NDA → edit → send for review (workflow-backed) → approve → send for signature → both parties sign → status becomes `EXECUTED`. Zero DB edits.

---

### Phase B — Coherent Journey UI (est. 2 weeks)

**Goal:** the traditional UI is clean, document-first, and internally consistent. A new user can drive the full lifecycle by clicking, without the agent.

| # | Change | Files | Acceptance |
|---|--------|-------|-----------|
| B.1 | **Document-first detail page.** PDF/HTML as the hero, right rail with collapsible metadata/summary/risks/clauses/versions/activity sections. One primary CTA + `⋯`. `<StatusStepper>` at top. | `ContractDetailPage.tsx` major refactor | Contract content visible above the fold on every contract. |
| B.2 | **Unified History timeline.** Merge Versions + Attachments + Parent/Child into one `<HistoryTimeline>` component, icon-differentiated. | New `components/contract/HistoryTimeline.tsx` | One panel replaces Versions tab, Attachments section, and Contract Family panel. |
| B.3 | **Inline comments on document.** TipTap margin comments attached to clause refs, replacing Comments tab. | TipTap extension; `contract_comments.clauseRef` already in schema | Select text → "Add comment" → bubble appears in margin. |
| B.4 | **Request ↔ Contract lineage UI.** Contract card shows "Converted from Request #XXX". Request card shows "Became Contract XXX". | Schema: add `sourceRequestId` on Contract; UI badges | Two clicks reach from any request to its contract and vice versa. |
| B.5 | **Reject = transient reason, not terminal status.** Contract returns to DRAFT with `rejectionReason` surfaced as banner. | `workflow-engine.ts` | Rejecting re-opens the contract to editing, no manual status change needed. |
| B.6 | **Hide empty metadata rows.** No more 6× `—` on Contract Details panel. Only render fields with values. | Detail page right rail | Empty contracts show a minimal rail, not a skeleton. |
| B.7 | **Role-aware sidebar.** Filter nav items by `usePermission()` per role. "Show all" toggle in header. | `components/Sidebar.tsx` | Sales rep sees 3 items (My Requests, My Contracts, + core nav); legal ops sees full 12. |
| B.8 | **`<StatusStepper>` in all three contexts** — list (mini badge), detail (full), agent cards (compact, later in Phase D). | `components/contract/StatusStepper.tsx` variants | Same visual language everywhere a contract appears. |

**Exit criteria for B:** demo — new user goes from login to executed contract in under 10 minutes of clicking, without any documentation.

---

### Phase C — Post-Signature + Setup UI Polish (est. 3 weeks, = Phase 08)

Implement Phase 08 and polish the setup UIs so admins can configure the product end-to-end without needing the agent.

**Post-signature (Phase 08 as originally scoped):**
- `obligations` table + extraction worker on `signature.completed`
- Renewal detection from `auto_renewal` clause → calendar events
- Expiry monitor → 90/60/30 day alerts, auto-transition to `EXPIRED` on date
- Amendment workflow → creates child contract linked by `parentContractId`
- Obligation list UI + completion with evidence upload

**Setup UIs (polish existing):**
- Template editor: fix versioning UI (collapse duplicates per Templates screenshot)
- Playbook: fix "My Categoty" typo, dedup categories
- Workflows: fix two redundant "New/Create Workflow" buttons
- Admin Roles: seed real permissions on FINANCE / PROCUREMENT / SALES_REP
- Settings Custom Fields: ok as-is
- Org Settings: verified at `/admin/org`

**Exit criteria for C:** executed contracts generate calendar events, obligation reminders, renewal alerts. Admin can configure all setup surfaces via UI alone.

---

### Phase D — Agent-First Surface (est. 3 weeks)

**Goal:** the agent chat becomes the primary workspace, layered on top of a working A+B+C foundation. Everything Phase A built as REST endpoints becomes callable via agent tools too.

| # | Change | Files | Acceptance |
|---|--------|-------|-----------|
| D.1 | **Tool registry.** Every existing endpoint from Phase A/B/C declared as a tool with JSON Schema args, permission scope, result shape, rich-component hint. `packages/tools/src/index.ts` is the registry. Agent orchestrator reads from this; API handlers can reuse validators. | New `packages/tools/` workspace package | `GET /tools` returns the full catalog; at least 30 tools registered. |
| D.2 | **Agent Home screen replaces Dashboard.** Central input, suggested cards (driven by `reports.*` tools), recent contracts. Sidebar collapses to icons by default. | `pages/AgentHome.tsx`, new route `/` | Loading the app lands on agent home. |
| D.3 | **Plan-then-execute orchestrator.** LangGraph graph: intent → plan → preview → (confirm) → execute → respond. Plans are structured JSON, not free text. Read-only tools auto-execute; state-changing tools require confirmation. | `apps/agents/app/agents/orchestrator.py` (new), `pages/AgentChat.tsx` | "Draft an NDA with Stark for a pilot" produces a 4-step plan preview before any tool fires. |
| D.4 | **Rich response rendering pipeline.** Agent streams messages that include `{type: 'component', name: 'ContractCard', props: {...}}`. Frontend parses and renders inline. | `packages/types/src/agent-messages.ts`, `components/agent/ChatStream.tsx` | Agent responses mix markdown + interactive cards. |
| D.5 | **Component library for chat.** Build `<ContractCard>`, `<ContractList>`, `<DiffViewer>`, `<ApprovalTimeline>`, `<ObligationList>`, `<ShareLinkCard>`, `<PlanPreview>`, `<ToolCallStream>`, `<ContractThumbnail>`. (`<StatusStepper>` reused from Phase A/B.) | `apps/web/src/components/agent/*` | Each component renders from a fixed JSON prop shape; storybook per. |
| D.6 | **Per-contract agent context.** When user is on `/contracts/:id`, chat input is pre-contextualized. `<ContextPill>` shows active context; one click to clear. | `store/agent-context.ts`, `hooks/useAgentContext.ts` | On detail page, "summarize this" returns a summary of that contract. |
| D.7 | **Navigation between agent and UI modes.** Agent can say "open the template editor for NDAs" → navigates. Every UI screen has "Ask agent about this" shortcut → returns to chat with page context. | Router hooks, `AgentInvokeButton.tsx` | Bidirectional transit works on every major screen. |

**Exit criteria for D:** demo video — user types `"I need an NDA with Acme for a pilot project, standard mutual terms, send for review"` in agent home. Agent plans, confirms, executes, lands with a contract card showing `IN_REVIEW` status and reviewer. Total time under 45 seconds.

---

### Phase E — Polish + data hygiene (parallel to A/B/C/D)

Non-blocking cleanups, run continuously:

| # | Change |
|---|--------|
| E.1 | Delete seed pollution: `Aniket NDA` template, `Temp` clause, `My Categoty` typo, duplicate clause categories. |
| E.2 | Clear `summary`/`keyTerms` when Review Agent fails. |
| E.3 | Fix `"AI-generated draft ()"` — fill with filename or drop. |
| E.4 | Join userId → name on activity entries; never show raw cuid. |
| E.5 | Dedupe `CONTRACT_VIEWED` events (once per user-contract per hour). |
| E.6 | Remove colored dots OR add legend on contracts list. |
| E.7 | Unify `Failed` chip + `DRAFT` status into single semantic (`PARSE_FAILED` / `ANALYSIS_FAILED`). |
| E.8 | Filename fallback for `Unnamed Contract` / `Unidentified Contract`. |
| E.9 | Fix faceted filter counts (Risk, Status, Type, Jurisdiction). |
| E.10 | Profile page: email as value not placeholder; clear pre-filled password dots. |
| E.11 | Activity feed: show contract name + action, not `Contract updated · System` × 7. |
| E.12 | Clause Library 422 race condition investigation. |

---

## 7. Cross-cutting architecture principles (agent-first)

1. **Tools are the product's API surface.** Anything a user can do, the agent can do. Anything an API can do, a tool must do. No UI-only actions.
2. **Permission scope at tool layer.** `requirePermission` runs on tool call, not after. Agent cannot escalate by calling a tool the user can't.
3. **Structured responses, not prose.** Agent returns `{ text, components: [...] }`. UI renders components natively.
4. **Plan-then-execute for destructive actions.** Any tool that changes state requires plan confirmation OR is explicitly flagged `autoExecute: true` (read-only tools only).
5. **Audit every tool call.** `AuditAction.AGENT_ACTION` includes tool name, args hash, resultHash.
6. **Tool versioning.** Tools have semver; agent pins to versions; breaking changes require upstream migration.
7. **Observability.** Every tool call streamed to developer console when `DEBUG_AGENT=1`.

---

## 8. What's out of scope (stated explicitly)

- Real-time collaborative editing (Yjs) — Phase 5.4 still deferred.
- Analytics & diligence rooms — Phase 09; post-P3.
- External integrations (Salesforce, Slack, DocuSign) — Phase 10.
- Multi-tenant test suite — separate effort.
- Voice / mobile agent interface — future.

---

## 9. Ordering and dependencies

```
  A (pipeline)  ──►  B (journey UI)  ──►  C (post-sig + setup)  ──►  D (agent)
   │                                                                    │
   └────────────────────────  E (continuous)  ──────────────────────────┘
```

**A is hard-blocking.** Nothing else ships until the pipeline works end-to-end.
**B depends on A** — journey UI renders the state machine that A made coherent.
**C depends on B** — obligations UI reuses the cleaned detail-page frame from B.
**D depends on A/B/C** — the agent needs a working product to orchestrate. Building the agent on a broken pipeline would produce an unreliable agent.
**E runs in parallel** — polish items with no blocking dependency.

**Total estimate:** 11 weeks end-to-end for solo. 6–7 weeks with a team of 2–3 working A+E in parallel then B+E in parallel.

### Why not build the agent earlier?

Considered and rejected. Arguments for earlier agent:
- Agent-first is the product thesis.
- Early agent feedback accelerates tool design.

Arguments against (won):
- The agent's usefulness is bounded by tool quality. Broken tools → broken agent. Better to ship tools that work first.
- A working UI is the fallback when the agent misunderstands. Without it, every misunderstanding is a dead-end.
- Iterating on pipeline bugs via natural-language commands is slower than via clicks.
- Agent scope can still be large in D; deferring doesn't shrink it.
- Product thesis ≠ build order. The final product is still agent-first.

---

## 10. Accept criteria for the whole plan

Two demos:

**Agent-first demo:**
> User opens app → agent home. Types: *"I just got a redlined NDA back from Zynga by email. Accept the liability-cap clause change but push back on the 5-year term. Then send it back to them."* Agent plans: fetch latest version with redline from email inbox, create v4 with liability cap accepted + term reverted, add comment on term clause explaining our position, share via portal to Zynga's contact, notify Admin User of status change. Executes. Returns a card showing NDA status updated to `UNDER_NEGOTIATION`, v4 created, shared with Zynga. Total clicks: 2 (type, confirm).

**Traditional demo (for users who prefer UI):**
> Sales rep files a request → legal accepts → drafts from template → inline comments → submit for review → approval workflow with escalation → counterparty redlines via portal + email (both) → accept some clauses → re-submit for approval → approved → send for signature → both parties sign via internal portal → executed → obligations auto-extracted → renewal alert scheduled for T-90 days → obligation completed with evidence. Zero DB hand-ticks. All via UI.

Both demos must work end-to-end before the plan is considered done.

---

## 11. Progress log

| Date | Commit | Task | Headline |
|------|--------|------|----------|
| 2026-04-22 | 3b5fdcd | — | Plan authored (agent-first thesis) |
| 2026-04-22 | de723b6 | — | Reorder: user-flow first, agent last |
| 2026-04-22 | d76588c | **A.1** | Editor decouple: stop saving "No suitable template found" as HTML. 5 contaminated versions cleaned. |
| 2026-04-22 | d7c52b6 | **A.3** | Single primary CTA: removed the workflow-bypass button, renamed to "Send for Review" (filled blue). |
| 2026-04-22 | 44db41e | **A.8** | `<StatusStepper>` component wired into detail page. Three size variants ready for reuse. |
| 2026-04-22 | 1b8244e | **A.5** | Hybrid canonical artifact. Gotenberg renders PDF on every HTML save. `/download` serves canonical; source preserved. |
| 2026-04-22 | — | A→B reorder | Pulled B.1 (document-first detail page) forward before A.4 eSignature, per user feedback that detail page is still not simpler. |

**Next up: B.1 — document-first detail page.** Target: contract content visible above the fold. Kill the Document tab + "Load Document" dance. Collapse action buttons to 1 primary CTA + `⋯`. Right rail for metadata/summary/risks/clauses/versions/activity. Estimated 1 day.
