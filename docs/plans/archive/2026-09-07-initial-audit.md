# Obligation extraction — quality audit

Date: 2026-09-07 · Branch `chore/ingestion-branch-cleanup` @ `52c785c` · Read-only pass, no code changed.
Scope: the obligation/KPI extraction path only — `apps/backend/services/kpi_manager.py`,
`obligation_extraction_schema.py`, `final_evaluation/`.

## Verdict

**F — not production-grade, and currently unmeasured.** Extraction is not retrieval-limited;
it is losing clauses *after* retrieval, in code paths that report success. The single published
accuracy number (`kpi_candidate_recall = 1.0`) does not measure recall.

The premise correction that matters before any work starts:

> RAG is not the leak. `_load_candidate_chunks` (`kpi_manager.py:4411`) full-scans **every**
> chunk for the contract — there is no top-k retrieval in this path. The conclusion ("don't do
> RAG for obligations") is right; the mechanism is wrong. Every finding below sits downstream
> of retrieval. Redesigning retrieval would fix nothing.

## Readiness scorecard

| Dimension | Rating |
|---|---|
| Correctness of stored records | **F** — cross-contract overwrite |
| Prompt / model contract | **F** — shipped prompt is the wrong one |
| Domain neutrality | **F** — every contract prompted as IATA ground handling |
| Loss accounting | **F** — no ledger; failures are logged, not counted |
| Schema enforcement | **D** — validator runs, errors ignored |
| Citation grounding | **D** — unverifiable by construction |
| Measurement / eval | **F** — the reported recall is a keyword bag |
| Chunking / batching | **C** — byte-budget batching breaks ladders and tables |
| Retrieval | **B** — full scan, correct choice, nothing to fix |

---

## 🔴 Critical

### C1 — Fee-schedule records collide across contracts (data loss)
`kpi_manager.py:5840` — `parent["kpi_id"] = f"kpi_sch_{md5(clean_base_title)}"`. No `contract_id`
in the seed, unlike `_stable_kpi_id` (`:7248`) which does include it. The upsert filter is
`{"kpi_id": item["kpi_id"]}` (`:2440`) and there is a **globally unique** index on `kpi_id`
(`:288`). Two contracts that each produce a "Towing Fee Schedule" hash to the same id; the second
extraction `$set`s the whole document, `contract_id` included, over the first.

*Failure:* extract contract A (fee schedule stored), extract contract B in another project with a
similarly-titled schedule → A's record now belongs to B. A's obligation is gone, silently, across
tenants.

### C2 — The obligation prompt is built, then thrown away
`kpi_manager.py:4909` assigns `system_instructions` — the 2.1 obligation prompt carrying
rate-ladder unrolling, compound pricing, the zero-omission sweep, liability-regime-first,
never-guess-ownership. `grep` finds exactly one occurrence of that name in the file: the
assignment. The function `return`s the legacy KPI-centric prompt at `:4970`.

Compounding it: `_extract_batch_llm_rows` normalizes and validates against the **2.1** envelope
(`records[].phase1`, `:4748-4751`), while the prompt that actually ships asks for
`schema_version 2.0` with a flat `kpis` array. The pipeline validates a shape it never requested.

*Failure:* every extraction quality rule in this repo is dead code. Nothing that is believed to be
running is running.

### C3 — Every contract is told it is an IATA ground-handling agreement
Stage-1 prompt, applied unconditionally: `"# Stage 1 ... — IATA Ground Handling & Commercial
Agreements"` / `"CONTEXT: You are analyzing clauses from an airline ground-handling agreement
(SGHA Main Agreement / Annex A / Annex B / SLA / Rate Cards)"` (`:4692-4694`). Downstream:
`_normalize_iata_ground_handling_record` called for every record (`:6260`), `SEK` as the default
currency in four places (`:5829`, `:5842`, `:5853`, `:6272`), and an `electricity`→`power` merge-key
rewrite (`:5249`).

*Failure:* a pharma CDMO or a payments MSA is screened by an aviation prompt and its fee schedule
is denominated in Swedish krona.

### C4 — Loss is invisible by construction
- `_query_kpi_llm_json` catches every exception and returns `{}` (`:5105-5107`).
- Truncated JSON → `_parse_json_object` → `{}` (`:5125`). Indistinguishable from an empty answer.
- `_extract_batch_llm_rows` retries twice, then returns `[]` — the batch is dropped on a
  `logger.warning` (`:4787`).
- Stage-1 `_verify_batch` returns `[]` when the response parses but has no `candidates` key
  (`:4707`) — 15 clauses vanish. (An *exception* keeps the batch; a malformed *success* does not.)
- The `as_completed` merge (`:4857`) drops failed futures.
- Nothing tracks which `source_id`s never produced a record. The run doc reports `kpi_count`,
  `candidate_count`, `coverage` — never `lost`.

*Failure:* a run that loses 40% of a contract to truncation reports `status: completed` and a
plausible KPI count.

---

## 🟠 High

### H1 — Output cap guarantees truncation
`_kpi_max_tokens` (`:5112`): groq → 8192; every other provider → `max(settings.max_tokens, 1024)`,
and `settings.max_tokens` defaults to **2048** (`core/config.py:29`). The batch is up to 10 records
(`:4874`), each a four-phase nested object. No truncation detection anywhere.

### H2 — Team model settings never reach the KPI extraction endpoint
The model factory resolves a team's chosen model from a context variable published by the
router-level dependency `apply_team_model_settings` (`api/routes/model_settings.py:35`). That
dependency is attached to **exactly one router** — `api/routes/agent.py:66`. The KPI router is not
wired to it.

Consequence: `POST /contracts/{id}/kpis/extract` (`api/routes/kpis.py:688`) runs with
`_active_settings() == {}`, so `_resolve_model_name` falls through to `settings.model_name`. The
*same* extraction reached through `agent.py:438` does pick up the team's model.

**Correction, 2026-09-07:** an earlier draft of this finding called the fallback model
`llama-3.1-8b-instant` and treated the model ceiling as a top concern. That is only the *code*
default in `core/config.py:26`. This deployment's `apps/backend/.env` sets
`MODEL_NAME=openai/gpt-oss-120b`, so the env fallback is a 120B reasoning model and the ceiling
concern is materially weaker than stated. The router-wiring defect below is the real problem: it
means a team's *chosen* model is ignored, not that the fallback is weak. **Two entry points, two different models, same
function** — and the configured universal model setting is silently ignored on the main path.

`_kpi_max_tokens` (`:5112`) compounds it: it passes an explicit `max_tokens`, and an explicit
argument wins over every team and global setting in `build_chat_model`'s ladder (`:114-122`). It
also hard-caps groq at `min(override or 8192, 8192)`, so a team cannot raise it.

The fix is not to pin a model in the extraction path — it is to publish the team settings on the
KPI router and stop overriding the resolved values.

### H2b — The extraction path bypasses the universal LLM clients
`_query_kpi_llm_json` (`:5062`) does route through the shared model factory, but the rest of the
path does not:

- **Provider is always forced.** `extract_for_contract` computes
  `provider = (ai_provider or self.ai_provider or "groq")` (`:2339`) and passes it explicitly into
  `build_chat_model`, where an explicit `provider` argument **beats the team override**
  (`model_factory.py:93-99`). So wiring the router dependency (H2) is necessary but not sufficient —
  the team's chosen *provider* stays ignored until this stops forcing a value.
- **`_llm_provider_available` (`:4865`) hand-rolls a key check for groq / gemini / openai and
  returns `False` for everything else — including `claude`.** A team on Claude therefore fails
  `_extract_kpis_with_llm`'s first guard (`:4804`), which returns `[]`, which makes
  `extract_for_contract` fall through to `deterministic_fallback` (`:2402`) — the whole contract
  extracted by regex, logged at `info`. Silent quality collapse from a supported provider choice.
  The factory already answers this: `build_chat_model(..., optional=True)` returns `None` when a
  provider has no key, and `model_settings.configured_providers()` exposes the same fact.
- **The Voyage rerank is hand-rolled HTTP** (`:4464-4477`) against `requests.Session`, while
  `contract_agent/rag/reranker.py:26 VoyageReranker` is the shared client for exactly this.
- **Dead raw-HTTP scaffolding.** `self.groq_headers` and `self.openai_headers` (`:248-249`) are
  built with bearer tokens on every manager instance and referenced nowhere.

**Sequencing note:** H2 and H2b must land together. Publishing team settings on the KPI router while
`_llm_provider_available` still excludes Claude would let a team select Claude and silently get
regex extraction.

### H3 — Schema validation is advisory
`validate_extraction_envelope` returns real errors — unknown `source_id`, missing `quote`, missing
`party_role` — and `:4752-4757` logs the first eight and stores the records anyway.

### H4 — Citation grounding is unverifiable
`_validated_quote` (`:6310-6320`): if the model's quote is not found in the source clause, it
returns **the entire source clause**. A fabricated citation is silently replaced with something
that looks grounded. There is no way to measure hallucinated quotes from stored data.

### H5 — Post-processing undoes the extraction rules
`_consolidate_multi_tier_schedules` (`:5779`) re-collapses ladder rows into one `lookup_table`
parent — the exact inverse of Rule 1 ("emit one record per row"). `_consolidate_and_group_kpis`
runs three times per run (`:4859`, `:2409`, `:2412`). The merge key `_extraction_metric_key`
(`:5220`) strips `charge/fee/rate/price/daily/minimum/hour` from names, so distinct obligations
converge onto one key.

### H6 — Coverage manifest over-credits
`_build_extraction_coverage` (`:5278`) joins candidate `segment_id` against record `source_id`,
which is `src_<i>_<j>_<hash>` (`:4643`). The keys can never match, so it falls through to the
`(section_path, page_start)` join — one record on a page marks **every** chunk on that page
`mapped`.

### H7 — The published accuracy number measures nothing
`final_evaluation/scoring/layers.py:497` — `kpi_candidate_recall` is
`sum(term in answer.lower() for term in ("threshold","deadline","notice","remedy",...)) / 5`
over the agent's **chat reply**. It never compares against a gold obligation. Hence the wall of
`1.0`s in `final_evaluation/reports/kpi_results.csv`. Do not cite them.

---

## 🟡 Medium

- **M1 — Byte-count batching.** `_batch_clause_records(char_budget=8000, max_records=10)` (`:4874`),
  fed by a sort that groups all `micro` chunks before `meso` before `macro` (`:4655`). A rate ladder
  or table split across a batch boundary cannot be unrolled by any prompt.
- **M2 — Table rows processed twice.** `_clause_units` (`:6541-6545`) emits each table row on its
  own *and* again inside its parent block; the signature dedup does not catch it.
- **M3 — Oversized blocks dropped.** `:6562` keeps only `30 <= len(unit) <= 1400`, and the
  sentence split (`:6560`) only fires before a fixed list of capitalized words
  (`The|If|Where|Upon|Each|Any|A|An|No|Payment|Delivery|Service|Supplier|Contractor|Customer|Company`).
  Prose starting sentences with `Provider`/`Vendor`/`Licensee` never splits. Measured on the eight
  markdown fixtures: 1 dropped block of 1,466 chars out of 1,422 — small here, higher risk on real
  PDF prose.
- **M4 — Voyage rerank is wasted.** `_rerank_candidates_with_voyage` (`:4453`) reorders candidates;
  `_candidate_clause_records` (`:4655`) immediately re-sorts by priority/page, discarding it.
- **M5 — Whole-run fallback.** `:2402` — if the LLM path yields nothing, the *entire contract*
  falls back to regex extraction. There is no per-clause fallback.

---

## What is already good

- Retrieval: full scan, no top-k. Correct for this problem. Leave it.
- `_stable_kpi_id` (`:7235`) is contract-scoped and identity-based. C1 is the one place that
  bypasses it.
- `obligation_extraction_schema.py` — the validator is well-shaped. It is just not enforced.
- `testing/backend/scripts/score_obligation_coverage.py` (untracked) — label-free coverage scorer,
  13 passing tests, stdlib-only. Verified this session: **593 quantitative spans** across the eight
  `final_evaluation/datasets/kpi_contracts/` fixtures (logistics 95, healthcare 58, solar 56,
  payments 68, transit 59, telecom 141, pharma 60, enterprise-AI 56). This is the measurement
  instrument the plan needs, and it already works.

---

# Plan

Two context layers, one measurement instrument, five ordered phases. Companion detail lives in
`docs/plans/obligation-extraction-accuracy.md` and `docs/plans/obligation-extraction-packs.md`
(both untracked on this branch); this section is the version reconciled with today's audit.

## The architecture the request asks for

**Layer 1 — one obligation system prompt, contract-type-neutral.** It owns *grammatical shape*
rules that hold for any family: rate-ladder unrolling, compound pricing, the zero-omission sweep,
liability-regime-first, never-guess-ownership, verbatim-or-quarantine. This prompt already exists
as the dead `system_instructions` at `:4909`. It ships by deleting the `return` below it (C2), not
by writing a new one.

**Layer 2 — contract-type packs, as data.** Versioned directories under
`apps/backend/packs/obligations/<family_id>/`:

```
pack.yaml        routing, version, budget
taxonomy.md      the obligation kinds this family actually has
sweep.md         where they hide in this family's document structure
conventions.md   units, cadences, naming this family uses
examples.md      2-4 shape examples, source-grounded
coverage.yaml    span_coverage_floor / anchor_recall_floor / grounding_floor
```

Rendered into one budgeted `<CONTRACT_TYPE_PACK>` block, cached per contract, resolved by a
classifier at ingest. Hard constraint: **a pack adds vocabulary and clause locations only.** It can
never override a system-prompt rule, license a guess, or introduce a default currency — that
constraint is what stops packs from becoming C3 again with more files.

Eight families, one per existing fixture, so every pack is scorable on day one:
`logistics_msa`, `data_processing_agreement`, `epc_and_om`, `payment_processing`,
`transit_concession`, `telecom_managed_services`, `pharma_cdmo`, `cloud_infrastructure_msa`.
IATA ground handling is deliberately **not** a family — it was the demo domain and is exactly what
the hardcodes were built around.

Stamp `contract_family` / `pack_id` / `pack_version` on every record (the fields exist in
`kpi_schema.py:705` and are never populated) so a recall regression is attributable to a pack bump.

## Phases

Each phase has a gate. No phase starts before the previous gate is green.

**Phase 0 — baseline (½ day).** Run the existing coverage scorer against a real extraction of all
eight fixtures. Produces the first honest span-coverage / grounding / anchor-recall numbers.
Everything below is measured against them. *Gate:* three numbers written down, reproducible.

**Phase 1 — zero silent loss (1–2 days).** A `ClauseLedger` over `source_id`
(`extracted | rejected | lost | pending`; `finalize()` turns pending→lost). Stage-1 keeps the batch
on a malformed success (C4). `_invoke_kpi_llm` returns raw text so truncation is distinguishable
from non-JSON; truncation → split-and-retry rather than drop (C4, H1). Ordered merge replacing
first-wins `as_completed`. Per-clause fallback, not per-run (M5). Ledger counts land on the run doc.
*Gate:* 0 `lost` across 8 fixtures × 3 runs.

**Phase 2 — ship the right prompt, enforce the schema (1 day).** Delete the dead `return` so
`system_instructions` ships (C2). Delete `_normalize_iata_ground_handling_record`, every `SEK`
literal, the `electricity`→`power` hack, and rewrite the Stage-1 prompt family-neutral (C3).
Promote `validate_extraction_envelope` from log to quarantine — invalid records go to a review
queue, not to the KPI collection (H3). `_validated_quote` returns `None` and quarantines instead of
substituting the source clause (H4). *Gate:* grounding ≥ 0.98; zero SEK/IATA/aviation strings in
`kpi_manager.py`; the domain-neutrality test suite green.

**Phase 3 — re-cut the unit of work (2–3 days).** Batch by document structure, not byte count:
never split a table or a rate ladder across batches (M1). Stop double-emitting table rows (M2).
Split oversized blocks on a general sentence boundary (M3). Drop the Voyage rerank from this path
or make it actually order the batches (M4). Pin the model: `llama-3.1-8b-instant` is not a defensible
default for nested legal JSON (H2). *Gate:* span coverage up vs the Phase 0 baseline, grounding
held.

**Phase 4 — deterministic post-processing (1–2 days).** Contract-scope the schedule `kpi_id` (C1) —
this is a one-line seed change plus a backfill for any already-collided records. Stop re-collapsing
ladder rows (H5). Run consolidation once, not three times. Fix the coverage-manifest join to use
`source_id` on both sides (H6). Retire `kpi_candidate_recall` from `layers.py` or reimplement it
against the coverage scorer (H7). *Gate:* two contracts with same-titled schedules extract without
collision; ladder row count preserved end-to-end.

**Phase 5 — packs (3–5 days, one family at a time).** Build the pack loader, renderer, budget, and
classifier. Land `logistics_msa` first, score it, then `data_processing_agreement`, then the
remaining six. Each pack's `coverage.yaml` floors are enforced by the scorer in CI, and no pack
ships without an ablation showing it moved a number. *Gate:* every family at or above its floor;
adding family nine is a directory, not a `kpi_manager.py` edit.

> Pack **content**, authoring method, ablation protocol, and a full worked exemplar grounded in
> fixture 01 live in `docs/plans/obligation-pack-authoring.md`. The format spec (layout, routing,
> injection, budget) is in `docs/plans/obligation-extraction-packs.md`.

## Sequencing note

C1 (data loss) is Critical and its fix is small — it can be pulled forward out of Phase 4 and
landed on its own immediately if you want the bleeding stopped before the rest.

The `738a90e` cherry-pick previously proposed is **superseded**: the parts worth keeping (the
prompt ship, the SEK/IATA/`electricity` removals) are Phase 2 here and are cleaner written fresh
against the current file than merged from a branch that has since diverged.
