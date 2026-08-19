# ContractSense agent sprint — handoff brief

Continuation brief for an agent picking up the ContractSense improvement sprint.
Phases 0, 1, and 2.1–2.3 are complete and on branch `feature/project-memory`.
This describes what exists, what must not break, and what is left.

The full plan lives at
`/Users/sambhavjain/.claude/plans/why-are-you-creating-greedy-kurzweil.md`.
Read it for the original findings table (F-01 … F-23). This brief supersedes it
where the two disagree, because several findings were re-diagnosed during
implementation.

---

## Ground rules

**1. The gate must stay green and stay hermetic.**

```bash
make eval-gate
```

180 tests, ~0.5s, **no MongoDB, no embeddings key, no provider key**. Every new
test must keep that property: fake managers at their query surface, inject
models and embeddings. If a change needs a real service to be tested, that is a
signal the seam is in the wrong place.

Add every new test file to `AGENT_GATE_TESTS` in the `Makefile`.

**2. Do not chase these — they are pre-existing and unrelated.**

- `test_contract_agent_refactor.py::test_answer_agent_question_runs_bounded_tool_loop_before_synthesis` fails with `pymongo.errors.ServerSelectionTimeoutError: localhost:27017: Connection refused`. No local Mongo in this environment.
- `apps/frontend/app/contracts/[contract_id]/page.tsx:2747` — one TypeScript error on `ReferenceDocument.status`. Confirmed pre-existing via `git stash`.
- `testing/backend/tests/test_deep_contract_agent.py` is **uncollectable** (imports a deleted `model_gateway`). It also references symbols this sprint removed: `_read_tool_loop_result`, `remember_turn`, `_question_memory_key`, `_conversation_summary_from_memory`, `AgentMemoryManager.build_memory_context`. Repairing it is worthwhile but is its own task — it holds the bulk of the agent's unit coverage, and is the gap between "180 tests pass" and "the agent is covered".

**3. Nothing in this sprint has been measured against a real model.** All
behavioural claims come from scripted-model tests that hold the model constant.
They prove wiring, ordering and budget — not answer quality. Before deleting
anything under Phase 3.4, establish a baseline:

```bash
make eval-agent
make eval-agent BASELINE=reports/main-baseline.json
```

**Credentials come from `apps/backend/.env`. Never hardcode a key, never pass
one on a command line, never echo one into a log or a commit.** That file is
gitignored and holds live Anthropic, Groq, Gemini and Voyage keys.
`Settings.Config.env_file` is the relative path `".env"`, and `make eval-agent`
runs with `cwd=apps/backend`, so it resolves correctly — **run eval targets
through `make`, not by invoking the script from the repo root**, or config
loads with no keys and the run fails confusingly.

Two cautions before running anything that touches real services:

- `make eval-agent` makes **real, billed model calls**. Get the owner's go-ahead before running it repeatedly or widening the suite beyond `smoke`.
- `MONGODB_URI` in that file points at a **real remote database**, not a local one. Anything in Phase 3 or 4 that runs the app, seeds fixtures, or exercises `--runner api` will read and write live data. Do not point destructive or seeding operations at it without confirming the target first. `--seed-api-fixtures` in particular writes real documents.
- `OPENAI_API_KEY` is present but only 26 characters — too short for a real OpenAI key, so treat it as a placeholder. Use `anthropic`, `groq` or `gemini` as the eval provider.

**4. Write comments that explain *why*, especially where the obvious approach is
wrong.** The existing code in `services/memory/` and
`services/contract_agent/citations.py` sets the standard: each non-obvious
decision records the failure it avoids. Match it.

---

## What already exists (do not rebuild)

### `apps/backend/services/memory/`

| File | Owns |
|---|---|
| `composer.py` | `MemoryComposer` — the single assembly point for `state.memory_context`. Tier budgets, priority order, provenance labels, cross-block dedup. Returns `ComposedMemory` with structured `blocks`, not just a string. |
| `summarizer.py` | Rolling session summary (folds, never appends) + `summarize_run_outcome`. |
| `semantic.py` | Embedding recall (`rank`), recency decay with a floor, and `is_durable_answer` — the memory write gate. |

Read `docs/AGENT_MEMORY.md` first. It documents the tiers, the priority order
and the reasoning behind each deviation.

**Extension point:** `MemoryComposer.compose(scope, kpi_context=..., extra_blocks=[...])`
takes `MemoryBlock` objects. That is how 2.5 adds preferences and how 2.4 would
add a trajectory hint. Do not add new manager reads inside the composer for
things that need caller-resolved scope — pass them as blocks.

### `apps/backend/services/contract_agent/citations.py`

The **only** place a citation marker regex may exist. Order is fixed:
parse → resolve → validate → renumber → **rewrite markers last**. Do not
introduce a `[N]` or `【N】` regex anywhere else; a structural test enforces this.

### `apps/backend/services/contract_agent/graph/tools/errors.py`

`ToolErrorKind` (6 kinds) + recovery hints + the run budget
(`contract_agent_tool_call_budget`, default 16). Transient failures retry once
in the tool wrapper. Classify by exception **type** first — scope denials must
never be downgraded via message matching.

### `testing/backend/evals/contractsense_agent/`

`agent_runner.py` drives the real `DeepContractAgentRunner` with fixture-backed
retrieval and an injectable model. `metrics.py` computes the seven metrics and
`compare_metrics` gates on `citation_support_rate` only (cost metrics warn —
1.2 exists to move one of them). Multi-turn cases compose memory through the
production `MemoryComposer`, not a copy of its format. **Keep it that way.**

---

## Remaining work

### 2.4 — Procedural memory (F-21) · SPECULATIVE, may be deleted

The one tier with no evidence it helps. Ship it behind a `PROCEDURAL_MEMORY`
flag and hold it to the gate.

`AgentRunStore` (`services/contract_agent/graph/persistence.py`) persists every
run's tools and traces, and 2.2 now writes a compact run episode per completed
run to the `agent_run_episodes` collection (see
`AgentMemoryManager.record_run_episode`). Episodes already record the tool
sequence **in order** — that ordering is the whole point, a set cannot answer
"what sequence resolved this".

Mine episodes into a trajectory store: intent cluster → the tool sequence that
produced cited evidence. Inject the single best match as a short hint block via
`extra_blocks` (priority ~85, tier `procedural` — the tier already has a budget
reservation and currently nothing uses it).

**Acceptance:** keep only if tool-calls-per-turn drops **with no
citation-support regression**, measured via `make eval-agent`. If it does not
move both, delete it and say so in the commit. A hint block that does not pay
is context budget spent for nothing.

### 2.5 — Preferences and corrections (F-22)

Two independent pieces; the second matters more.

**Preferences.** A `user_preferences` collection scoped `(user_id, org_id)`:
practice area, jurisdiction focus, citation style, answer verbosity. Compose via
`extra_blocks` at priority 80 (`_PRIORITY["preferences"]` is already reserved in
`composer.py`). Editable from `apps/frontend/app/account/` — the page exists.

**Corrections — the real gap.** `ProjectMemoryManager.supersede_fact`
(`project_memory.py:755`) works and is well designed: facts are never edited in
place, a correction is a new fact pointing back at what it replaced. But it is
reachable **only** from amendment detection. A user telling the agent "notice is
60 days, not 30" changes nothing durable.

Add an approval-gated `correct_fact` tool wired to it. Register in
`graph/tools/registry.py` under `APPROVAL_REQUIRED_TOOLS`. The approval handler
pattern is at `api/routes/agent.py` ~line 500 (`remember_fact`). A correction
must also write a run-outcome episode — `summarize_run_outcome` already accepts
a `correction=` argument for exactly this, and it is currently never passed.

### 2.6 — Lifecycle (F-23)

- **Decay.** Recency weighting exists in `semantic.rank`. What is missing is a TTL on session-scoped memories. Project facts must **not** decay — they supersede, which already works.
- **Consolidation.** Periodic job merging near-duplicate memories; promote a memory confirmed across multiple sessions to higher confidence. Reuse `composer._dedupe_tokens` for similarity — it is the tokenizer that counts numerals, which word-only tokenizers do not, and getting that wrong deletes contract terms.
- **Propagate needs-review.** `flag_facts_for_amended_document` (`project_memory.py:765`) marks project facts stale on amendment. Extend it to `agent_memories` carrying the same `source_contract_id`. The field is already written by `remember_answer_if_durable`.
- **Retire legacy rows.** `AgentMemoryManager.migrate_legacy_memories` marks pre-gate rows `origin: "legacy"` at low confidence. Decay should age them out. Do **not** promote them to `origin: "contract"` — they were written by the overwrite path with no provenance, and making them indistinguishable from gated records defeats the migration.

---

### Phase 3 — Tool surface and transport

**3.1 Re-cut 17 tools → 9 (F-08).** Wrapper-level only; `executor.py`
implementations and `EvidenceRetrievalService` stay. Merge: `find_in_document` →
`search_evidence(exact=…)`; `read_document`+`outline_document` →
`read_document(mode: outline|excerpt|full)`; `list_documents`+`fetch_documents`;
the three project-memory tools → `project_memory(view: index|document|events)`;
`create_tabular_review`+`suggest_tabular_review` → `propose_tabular_review`.
Update `registry.py`'s `READ_ONLY_TOOLS` / `APPROVAL_REQUIRED_TOOLS` /
`tool_specs()` in the same commit. **Acceptance:** the "Tool usage" block in
`system_prompt.py` drops under five lines and tool-selection accuracy holds.

**3.2 Approval without exceptions (F-06).** `langchain_tools.py` raises
`ApprovalRequiredError` out of a LangChain tool's `.invoke()`, so a turn emitting
`search_evidence` + `remember_fact` in parallel **loses the search results
entirely**. Approval-gated tools should return a normal
`{status: "approval_required", ...}` observation; the loop finishes every sibling
call, then checks for pending approvals once at the turn boundary.
`_pending_approval_payload` in `react_runtime.py` already scans state for this —
make it the primary path rather than exception recovery.

**3.3 One scope gate (F-09).** Delete the partial checks in
`langchain_tools.py` (they cover only singular `document_id`/`contract_id`, so
`search_evidence(document_ids=[...])` slips past). Enforce in exactly one place:
`executor.py::_restrict_documents`, over every id-bearing argument. Drop
`project_id` from `ProjectTimelineInput` — the tool ignores it. Add negative
tests per argument shape. **This is a security fix; do it before 3.1 renames
the arguments.**

**3.4 One streaming service (F-11, F-12).** Extract `services/agent_stream.py`
owning session setup, the composer call, scope resolution, agent run,
persistence. The three stream endpoints shrink to auth + scope + `StreamingResponse`.
Delete the unreachable legacy branches in the same commit — `ContractRAGSystem`
construction in routes, the `operational_payload` KPI path,
`rag/{agent,harness,verifier,query_decomposer,retrieval}.py`. **Keep** what
`executor.py` imports: `evidence_service`, `vector_store`, `segmentation`,
`reranker`. Ship behind `LEGACY_RAG_FALLBACK=1` for one release.
**Precondition: a real-model baseline from `make eval-agent`.** Do not delete
against scripted-model tests alone.

**3.5 Async and cancellable (F-10).** Convert to `ainvoke`/`astream`, routes to
`async def`, replace the `threading.Thread` + `queue.Queue(timeout=0.1)` bridge
with `asyncio.Queue`. Poll `request.is_disconnected()` and cancel the run task.
Add a hard wall-clock timeout. Currently two threadpool slots per live chat
against a default anyio pool of 40, and an abandoned tab keeps calling the model.

**3.6 SSE contract v2 (F-16).** Publish the event set as a typed schema shared
with the frontend. Drop the duplicated `citation` event (identical payload to
`citations`) and the no-op `content_done` / `doc_read` / `doc_search` events the
panel already ignores. Version the stream. **4.1 depends on this schema.**

---

### Phase 4 — The panel

**4.1 Decompose (F-13).** Split `ContractAgentPanel.tsx` (3,288 lines) into
`hooks/useAgentStream.ts` (typed against the 3.6 schema),
`hooks/useAgentSession.ts`, `hooks/useAgentMessages.ts` (`useReducer` replacing
20+ `useState`), and components `MessageList` / `AgentMessage` / `CitationList` /
`ActivityLog` / `ArtifactCard` / `ApprovalCard` / `Composer`. Delete the inline
duplicate of `handleSubmit` in the approval `onCustom` handler — both paths call
one `submit()`. **Acceptance:** no file in the chat tree over ~400 lines.

**4.2 Streaming performance (F-13).** `setMessages(map)` fires per token,
re-rendering every row and re-parsing every message's markdown. Memoize rows on
`(id, content)`; buffer deltas with `requestAnimationFrame`; only the streaming
row re-parses markdown. **Acceptance:** 2,000-token answer in a 20-message
thread renders under 8ms/frame in a React Profiler trace.

**4.3 Design system (F-14).** `UI_GUIDELINES.md` mandates `#015CA9` primary,
`#A7A9AC` muted, flat surfaces, `shadow-sm` ceiling. The panel uses `bg-black`,
`backdrop-blur-2xl`, heavy custom shadows and per-provider inline hex. Replace
with tokens; move provider colors into a token map.

**4.4 Controls (F-15).** Stop (abort fetch, **keep the partial answer**; pairs
with 3.5 server-side cancellation). Retry (preserve the partial instead of
overwriting `content` with the error string). Activity log in plain language,
raw trace behind a developer toggle. Citation hover cards showing the stored
quote and page — **and the backend's `verified` flag**, which
`citations.validate_and_finalize` computes and nothing renders. Unsupported
citations are deliberately kept-and-flagged rather than deleted, precisely so
this badge can exist.

**4.5 Memory surface.** `MemoryComposer.compose()` returns structured `blocks`
with tier and provenance specifically so this can be built without re-parsing
prose. Add a "what I remember" disclosure showing the composed blocks by tier —
the same content sent to the model, so a lawyer can audit why an answer was
shaped a certain way. Inline **correct** affordance on a stated fact wired to
2.5's `correct_fact`. Link to the existing project memory panel rather than
rebuilding it.

**4.6 Accessibility.** `aria-live="polite"` on the streaming region; visible
focus rings on the primary token; real labels on icon buttons currently relying
on `title`; `prefers-reduced-motion` on the thinking indicator.

---

## Suggested order

1. **3.3** (security, small, independent)
2. **2.5 corrections half** (`correct_fact`) — 4.5 depends on it
3. **3.2** (correctness, unblocks parallel tool turns)
4. **`make eval-agent` baseline** — required before any deletion
5. **3.1**, then **3.4**, then **3.5**, then **3.6**
6. **Phase 4**, starting with 4.1 (needs the 3.6 schema)
7. **2.4** last, and only if the gate says it pays

2.6 can land any time; it touches nothing else.

## What the owner must verify, not the agent

These acceptance criteria cannot be checked from a terminal. Implement against
them, then hand them back rather than declaring them met.

| Item | Criterion | Why it needs a person |
|---|---|---|
| 2.4 | tool-calls-per-turn drops, no citation-support regression | `make eval-agent` twice (flag on/off) and a judgement call on whether it paid |
| 3.4 | no regression across the seven metrics after deleting legacy RAG | needs a `main` baseline to diff against, and the decision to delete |
| 3.5 | closing the tab mid-run stops model calls | running server + a real browser disconnect |
| 4.2 | 2,000-token answer renders under 8ms/frame | React Profiler flamegraph |
| 4.6 | keyboard-only pass: composer → send → stop → citation hover | manual a11y pass |

Everything else in this brief is verifiable by `make eval-gate`, `pytest`,
`npm run lint && npm run build`, or reading the diff.

## Verification per phase

```bash
make eval-gate                                            # must stay green
cd apps/backend && poetry run pytest ../../testing/backend/tests
cd apps/frontend && npm run lint && npm run build
```

Every phase is independently revertable. 2.4 and 3.4 additionally ship behind
flags — `PROCEDURAL_MEMORY`, `LEGACY_RAG_FALLBACK` — for one release each.

## Explicitly out of scope

Retrieval quality (chunking, reranker tuning, embedding model choice).
Multi-agent decomposition. A graph-structured memory over parties/obligations.
Model or provider changes beyond the existing 1.2 capability flag.
