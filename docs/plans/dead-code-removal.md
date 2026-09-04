# Dead Code Removal Plan

Status: proposal. Written 2026-08-31. Companion to
[hitl-contract-workflow.md](hitl-contract-workflow.md).

Everything below was verified by tracing writers and readers, not by reading
names. Each item states what proves it dead and what could still bite.

---

## Tier A — verified dead, delete

### A1. The draft / version subsystem (~700 lines, backend + frontend)

The whole Q&A "versions" feature. Nothing produces its data and nothing renders
it.

Proof:

- `process.results` is initialised empty (`api/routes/contracts.py:166`) and no
  server path ever writes content into it. The single writer is `submit-draft`
  echoing the client payload (`api/routes/workflows.py:492`).
- The client never calls it: `handleSaveDraft`
  (`app/contracts/[contract_id]/page.tsx:2108`) and `handleSubmitDraft`
  (`:2174`) are declared and never bound to a control or passed to a child.
- `process.dynamic_results` has no writer at all — initialised at
  `contracts.py:166`, read back at `:1153`.
- `handleExportToCSV` (`:2611`) — one occurrence in the file, the definition.

Delete:

| Where | What |
|---|---|
| `api/routes/workflows.py:269-381` | `save_draft` endpoint |
| `api/routes/workflows.py:383-541` | `submit_draft` endpoint |
| `api/routes/workflows.py:981-994` | the `report_info.is_draft` fixup inside `complete_personal_contract` |
| `models/response_types.py:57` | `LastSaveResponse` |
| `models/response_types.py:174` | `DraftSaveRequest` |
| `models/response_types.py:78-85` | `results`, `dynamic_results`, `lastSave` on `ProcessResponse` |
| `api/routes/contracts.py:166`, `:658`, `:1007-1008`, `:1153` | writes/projections of those three fields |
| `app/contracts/[contract_id]/page.tsx:2108`, `:2174`, `:2611` | `handleSaveDraft`, `handleSubmitDraft`, `handleExportToCSV` |
| `app/contracts/[contract_id]/page.tsx:768`, `:939-1016`, `:1945-1962`, `:2100-2106` | version-dropdown state, `allVersionsForDropdown`, `currentDisplayData`, `isViewingLastSave`, `isUnprocessed`, `isSavingDraft`, `isSubmittingVersion` |
| `components/contracts/panes.tsx:240` | `dynamic_results` on the pane type |

**Answered.** `scripts/report_workflow_data.py` against the configured Atlas
cluster (524 contracts): `process.results` holds a version on **0**,
`process.lastSave` is set on **0**, `process.dynamic_results` holds anything on
**0**. Deleted in `0ffa42c`.

The original check, for reference:

```bash
mongosh "$MONGO_URI" --quiet --eval 'db.contracts.countDocuments({"process.results.0":{$exists:true}})'
```

If the count is non-zero, that is real customer content from an older release.
Export it before dropping the fields, or keep a read-only viewer. If it is zero,
delete outright.

**This is Phase 0a of the HITL plan**, not a separate cleanup. Deleting it is
what makes the workflow endpoints able to point at artifacts that exist (KPIs,
obligations, playbook findings, agent-proposed artifacts).

### A2. `use_local_marker` — a toggle the ingestion refactor orphaned

**Branch-scoped: true on `feature/ingestion-markdown-tables`, false on `main`.**
On `main` the flag is live — `_process_with_marker` (`worker/tasks.py:588`) is
called at `:448` and branches on it into the local Marker path. The feature
branch replaced that call with `_extract_document_text`, deleted
`_process_with_marker`, and left the flag and `utils/marker_processor.py`
orphaned behind it. This is cleanup that branch owes, not a `main` PR.

A switch the user flips, persisted to `localStorage`, sent on every upload,
stored on the contract, passed into the Celery task signature — and never read.
The parser is chosen by `_parser_for_contract` (`worker/tasks.py:995`).

Proof: `index_contract_task` takes `use_local_marker: bool`
(`worker/tasks.py:388`) and the parameter appears nowhere in the body
(lines 390–983).

Delete the whole chain: `app/dashboard/page.tsx:141`, `:817`, `:924`, `:1101`,
`:1257`; `components/projects/ProjectContractsScreen.tsx:80`, `:379`, `:468`;
`api/routes/contracts.py:224`, `:280`, `:422`, `:452`, `:649`, `:672`, `:698`,
`:713`, `:726`; `api/dependencies.py:52`, `:69`, `:82`;
`models/response_types.py:139`, `:148`; `worker/tasks.py:345`, `:353`, `:388`.

Keep the audit-log renderers (`app/audit/page.tsx:151`,
`app/teams/[teamId]/audit/page.tsx:246`) — they display historical log entries
that already contain the field.

Note: the Celery signature change needs the queue drained or a
backward-compatible `**kwargs` shim for one release, since in-flight tasks carry
the old argument list.

### A3. Orphan scripts and modules

Unreferenced by any import, Makefile target, Dockerfile, Jenkinsfile, or CI
workflow:

| File | Note |
|---|---|
| File | On `main`? | Note |
|---|---|---|
| `apps/backend/import_eval_reports.py` | yes | **deleted** |
| `apps/backend/verify_runner_endpoints.py` | yes | **deleted** |
| `apps/backend/utils/jsontocsv.py` (36 lines) | yes | **deleted** |
| `apps/backend/test_test.py` (20 lines) | no — feature branch only | scratch script at backend root, not a test |
| `apps/backend/test_fetch.py` (29 lines) | no — feature branch only | same |
| `apps/backend/scripts/seed_iata_demo_actuals.py` | no — feature branch only | no caller |
| `apps/backend/scripts/get_demo_token.py` | no — feature branch only | no caller |
| `apps/backend/utils/marker_processor.py` (65 lines) | yes, and **live on `main`** | orphaned only by the feature branch's refactor — goes with A2, not here |

`jsontocsv.py` was referenced only by the directory listings in
`docs/BACKEND.md` and `docs/DEVELOPER_GUIDE.md` — docs describing a module the
code never used. Deleted with the file.

The two named `test_*` are not tests and are never collected: every pytest
invocation in the `Makefile` passes explicit paths (`:27`, `:55`), and neither
points at `apps/backend/`. They are scratch scripts that hit a live Mongo at
import time.

---

## Tier B — broken, not dead. Fix, do not delete.

**The re-edit chain.** `request-reedit`, `approve-reedit`, `deny-reedit`,
`acknowledge-denial` (`api/routes/workflows.py:1032-1320`) plus four wired
frontend buttons. Currently unreachable because entry requires
`status == "Completed"` and nothing writes `"Completed"` — `approve` writes
`"Ingested"` (`:746`).

This is a real feature blocked by one wrong string. Deleting it destroys work;
the fix is the terminal-state change already in the HITL plan (add `approved`,
point re-edit at it). Do not touch it in a cleanup PR.

**Never-written status literals** in query filters: `"Ready to Edit"`,
`"Indexed"`, `"Completed"`, `"Pending Your Approval"` appear in `$in` lists at
`api/routes/contracts.py:830`, `:1331`, `:1361`, `:1410` and
`api/routes/projects.py:121`. No code writes them.

**Measured, and the answer is: leave them.** The census found `Ready to Edit`,
`Completed` and `Pending Your Approval` on zero contracts, but that is one
database — the cluster this checkout is configured against. Another
environment may hold them, and an inert literal in a `$in` list costs nothing
while a wrongly stripped one hides contracts from every count. Not worth the
trade.

The check, if you want to run it per environment:

```bash
mongosh "$MONGO_URI" --quiet --eval 'db.contracts.distinct("status")'
```

What the census did surface is worse than a dead literal: **34 contracts carry
statuses no filter matches at all** — lowercase `completed` (28) and `active`
(6). Every dashboard count uses capitalised values, so those contracts are
silently missing from the ingested, ready-to-edit and completed tallies. That
is a live undercount, not tidiness, and it needs a decision on what those two
values were meant to mean before anything maps them.

**`system_role`.** Defaulted in two places (`core/security.py:108`,
`api/dependencies.py:180`) and never read for authorization. It is part of the
token payload, so removal is an auth-surface change for zero gain. Leave it;
resolve it when the role model lands.

---

## Sequencing

| PR | Contents | Risk | Gate | Status |
|---|---|---|---|---|
| 1 | A3, the three that exist on `main` + doc lines | none | imports load; backend suite green | **done — `79cf5d6`** |
| 1b | A3 remainder (4 scratch files) — on the feature branch | none | branch suite green | **done — `4e023eb`** |
| 2 | A2 `use_local_marker` chain + `marker_processor.py` — on the feature branch | low; `**_legacy_kwargs` shim on the task instead of draining | upload → ingest a PDF end to end | **done — `4e023eb`** |
| 3 | A1 draft/version subsystem | medium; blocked on the Mongo count | upload → submit → approve still works; contract page renders | blocked |
| 4 | Tier B status-literal trim, only for literals with zero documents | low | dashboard counts unchanged before/after | blocked |

Everything lands on `chore/ingestion-branch-cleanup`, off
`feature/ingestion-markdown-tables`. The main-based branch was dropped: work
stays in one lane, on the feature branch, and nothing is aimed at `main` or
`dev`. No PR is open yet — `gh` is not installed on this machine. PR 3 lands with, or just before, Phase 0a of the HITL
plan.

**Lesson for the rest of this plan: every claim is branch-scoped.** The A2
finding was measured on `feature/ingestion-markdown-tables` and is false on
`main`. Re-verify each remaining item against the branch it will land on.

---

## Keeping it clean

None of this was catchable by tooling, because there is none:

- `apps/frontend/tsconfig.json` sets neither `noUnusedLocals` nor
  `noUnusedParameters`;
- `apps/backend/pyproject.toml` configures no linter — no ruff, no vulture, no
  flake8;
- the `Makefile` has `lint-frontend` (`next lint`) and nothing for the backend.

Minimum to stop the next `handleSaveDraft`:

1. `noUnusedLocals` + `noUnusedParameters` in the frontend tsconfig. Catches
   dead locals, not dead exports.
2. `knip` for unreferenced exports, files and dependencies — that is the check
   that would have flagged `handleExportToCSV` and the orphan modules.
3. `ruff` on the backend with `F401`, `F841`, `ARG` enabled. `ARG` is what flags
   `use_local_marker` sitting unused in a task signature.
4. A `make lint` target running all three, wired into the same CI job as the
   backend suite.

Expect a large first run. Land the baseline as an ignore list, then burn it down
— a gate that cannot fail is worse than no gate.
