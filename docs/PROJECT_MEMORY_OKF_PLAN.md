# Project Memory — OKF Restructure Plan

Restructures project memory from one glued markdown blob into an OKF-shaped
concept store: Mongo is the source of truth, markdown is the rendered view.

Goal is not token savings for their own sake. It is that the agent should never
answer a question about *which documents or facts exist* from a ranked subset.
The complete index is always cheap and always sent; everything else is fetched
on demand.

---

## Why

Two bugs, already fixed, motivate the shape:

- `search_project_memory` ranked across every project's vectors because the
  store returned by `load_existing_vector_store` is bound to the whole
  collection and the call site passed no namespace pre-filter. Fixed in
  `ff1e4a1`. The lesson: project scoping must be structural, enforced in one
  place, not remembered per call site.
- The scratchpad was stored as a single 3.6KB Document, larger than nothing and
  smaller than `chunk_size` (4000), so "semantic search" retrieved exactly one
  chunk — then truncated it at 900 chars, cutting the project history off after
  the first document. Fixed in `e143728` by reading the scratchpad directly,
  uncapped. The lesson: **storage unit is not retrieval unit**, and splitting
  must happen on real boundaries, never on character count.

## Current state

| Thing | Where | Notes |
|---|---|---|
| Per-document overviews | `contract_agent_db.project_memories` | Typed fields + rendered `markdown` |
| Glued scratchpad | `contract_agent_db.project_scratchpads` | `pm:section` markers + freeform manual prose |
| Vectors | `contract_vectors`, ns `project-memory-{id}` | **Dead** — nothing reads it since `e143728` |
| Agent surface | `get_project_timeline` | Single tool, returns whole scratchpad |
| KPI series | `contract_kpi_actuals` / `_breaches` / `_alerts` | Stays where it is |

## Target

```
project-{id}/
├── index.md          complete list, always sent (~80 chars/doc)
├── documents/        one concept per contract  (from project_memories)
├── facts.md          all facts, one delimited block each
├── notes.md          human prose only
└── events/log.md     notable events, recent window
```

Frontmatter per OKF v0.1 (`type`, `title`, `timestamp`, `tags`) plus
`project_id` and `source_contract_id`. `project_id` in frontmatter is what makes
the cross-project leak structurally impossible rather than per-call-site
discipline.

**Revision to what I said in chat:** I suggested storing facts as an array on
one Mongo document with `$push`. Per-fact documents are better — no 16MB
ceiling, single-document atomic writes, and indexable by tag / source /
superseded state. One `facts.md` file is a rendering concern; it does not
require one Mongo document. The user-facing requirement (one file, not one file
per fact) is unaffected.

---

## Gaps found auditing this plan against the code

Verified against the live database and the current call graph. All five were
missing from the first draft of this plan.

1. **The index cannot be built from `project_memories`.** Both
   `_existing_light_docs` and `build_project_context_for_agent` filter
   `status: "success"`, and overview generation is deliberately best-effort at
   ingest (`worker/tasks.py` — "Never fails ingestion"). A document whose
   overview fails is invisible to the agent. Build `index.md` from the
   `contracts` collection with memory joined in, and render a failed or missing
   overview as an explicit row rather than an absence. Live data is currently
   9/9 success across both projects, so this is latent, not active.

2. **Project deletion orphans memory.** `delete_project` reassigns contracts to
   the fallback project and deletes the project row; `project_memories`,
   `project_scratchpads`, and the vectors retain the dead `project_id`
   indefinitely. The reassigned contracts also arrive in the fallback project
   with no memory there.

3. **`replicate_document` never generates an overview.** It writes a document
   into a target project, but `generate_document_overview` is only ever called
   from the ingest task, so replicated documents never enter that project's
   memory or index.

4. **`PUT /{project_id}/memory`'s docstring is false.** It claims auto-sync
   stops once a human edits. `edited_manually` is written and never read;
   `_sync_scratchpad` keeps updating its own markers regardless. The
   service-layer docstring documents this correctly. Fix the route docstring,
   and decide the real semantics before Phase 1 splits `notes.md` out.

5. **No tests exist for project memory.** Nothing in `final_evaluation` or
   `testing` covers it.

Non-gap, recorded so it is not re-investigated: there is no contract-delete
endpoint, so document deletion cannot orphan memory today.

### Where these land

| Gap | Phase |
|---|---|
| Index from `contracts`, failures rendered explicitly | 1 |
| Deletion/reassignment cleanup | 1 |
| Overview on replicate | 1 |
| Docstring + manual-edit semantics | 0 |
| Tests | every phase |

---

## Phase 0 — Remove the dead vector path

Small, self-contained, no behaviour change.

- Drop `_reembed_scratchpad` and its call sites; stop writing
  `project-memory-*` vectors on every ingest and scratchpad edit.
- Delete existing `project-memory-*` vectors.
- Remove `vectorized` / `vector_error` / `memory_namespace` from records and
  from whatever UI surfaces them.

Vectors return in Phase 2, on facts, where ranking is actually needed.

**Verify:** ingest a document, confirm no new vectors in that namespace, agent
timeline answer unchanged.

## Phase 1 — Concept layer

- Add frontmatter fields to `project_memories`: `type`, `title`, `tags`,
  `timestamp`, `links` (cross-refs from existing `related_documents`).
- `render_concept(record)` — replaces `_build_markdown_section`, emits YAML
  frontmatter + body.
- `render_index(project_id)` — one line per document: filename, type, date,
  relates-to. Complete, never truncated, never ranked.
- Split the scratchpad: marked `pm:section` blocks are regenerable from records
  and get dropped; unmarked prose migrates to `notes.md`.

**Migration risk — the one to be careful about.** Manual prose exists *only* in
the scratchpad text; it is not derivable from records. The migration must
extract everything outside the `pm:section` markers before dropping anything.
Dry-run it and print what would be kept and dropped per project before writing.

**Verify:** for Projects 1 and 2, rendered index + concepts reproduce today's
scratchpad content; no manual prose lost.

## Phase 2 — Facts

- New collection `project_facts`, one document per fact:
  `{project_id, text, sources: [{contract_id, quote}], tags, origin, learned_at,
  superseded_by, needs_review}`.
- `origin: "contract" | "user"`. A user-stated fact has no quote to verify
  against and must not be cited like an extracted one.
- Provenance required on write: either a source quote or `origin: "user"`.
- Staleness: when a document gains an `amends` relation, flag facts sourced from
  the amended document `needs_review`. A confidently-stated stale contract term
  is worse than no memory.
- One vector per fact — the fact is its own natural boundary, so no splitter is
  involved.
- `render_facts(project_id)` emits `facts.md`, one `##` block per fact.

**Verify:** facts survive supersede/amend cycles; retrieval never returns
another project's facts (assert on a two-project fixture, mirroring the bug).

## Phase 3 — Events (provisional)

Least settled phase. Nothing in Phases 0–2 depends on its shape, so it stays
open until the KPI tracking work firms up.

Open question — **should event entries be editable?** Recommended: no. This is
a log of what happened during tracking, potentially the record you would point
at in a dispute, and `audit_logs` already exists on the same principle.
Append-only, corrections layered as new entries rather than rewrites. That makes
events the one concept type rendering read-only in the UI, while documents and
facts stay editable — an asymmetry worth building in from the start rather than
retrofitting once the memory page treats all concepts alike.

Sketch, to be revised against whatever KPI tracking actually emits:

- New collection `project_events`: `{project_id, type, ts, contract_id, payload,
  severity}`.
- Emit on: document ingested, overview generated, fact recorded, KPI breach
  detected, tracking configured.
- Render `events/log.md` as a recent-N window.
- **Raw KPI series stays in the KPI collections.** A poll every few minutes is
  thousands of rows a month per contract; only notable events belong here.

## Phase 4 — Agent tools

Replace the single `get_project_timeline` with:

| Tool | Risk | Purpose |
|---|---|---|
| `read_project_index` | read_only | Complete document list; cheap, always available |
| `read_concept` | read_only | One document / fact concept by id |
| `search_project_memory` | read_only | Filtered + ranked, facts only |
| `remember_fact` | approval_required | Write a fact |

`remember_fact` goes in `APPROVAL_REQUIRED_TOOLS` (`graph/tools/registry.py`) —
it is a write that shapes every future answer, so it belongs with
`create_tabular_review` and `extract_kpis`, not with the read tools.

System prompt: memory is context, never citation evidence; verify a fact against
its source document before citing. This framing already exists in
`build_project_context_for_agent` and should carry over verbatim.

## Phase 5 — UI

Memory page gains tabs: Overview (index), Documents, Facts, Events. Facts need
edit/delete and a visible `needs_review` state. The existing scratchpad editor
becomes the `notes.md` editor.

---

## Decisions needed before Phase 2

1. Should `remember_fact` be approval-gated, or silent-write with review in the
   UI? Plan assumes gated.
2. Does the agent propose facts unprompted, or only when the user says
   "remember this"? Unprompted writes risk memory filling with restatements of
   conversation, which degrades retrieval.
3. Retention on events — window, or forever?

## Sequencing

Phases 0 and 1 are safe and independently shippable. Phase 2 is where the design
earns its keep. Phases 3–5 can follow at whatever pace.

Nothing here is started.
