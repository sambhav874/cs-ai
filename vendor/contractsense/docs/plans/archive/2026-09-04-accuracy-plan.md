# Obligation extraction accuracy

Goal: take obligation extraction from "unmeasured" to a number we defend, then
raise that number and hold it.

## What "100%" means here

Four things can be driven to 100% and enforced:

| Target | Enforced by |
| --- | --- |
| Zero silent loss — every clause has a terminal state | clause ledger, run fails on `lost` |
| Citation grounding — every quote verbatim in source | `_validated_quote` stops substituting |
| Determinism — same input, same register | ordered merge, stability gate |
| Quantitative coverage — every amount/rate/deadline in the source is quoted by some record | label-free coverage scorer, per-contract floor |

A fifth — accuracy on *unseen* contracts — cannot be guaranteed by an LLM
extractor. What replaces the guarantee is a calibrated review queue: records
flagged for a named missing field, with the field-level numbers to back the
flag.

## Status

- [ ] Phase 0 — measurement (**designed, not implemented** — see below)
- [ ] Phase 1 — zero silent loss
- [ ] Phase 2 — ship the right prompt, enforce the schema
- [ ] Phase 3 — re-cut the unit of work
- [ ] Phase 4 — deterministic post-processing
- [ ] Phase 5 — drive coverage up on the 8 fixtures, hold it
- [ ] Companion: system prompt + contract-type packs — `obligation-extraction-packs.md`

Baseline number: **not yet taken** — needs the backend stack (see below).

## Phase 0 — measurement (built, then reverted off this branch)

**Audit 2026-09-04.** Phase 0 — and most of Phase 2 — shipped as commit
`738a90e` *"feat: industry-neutral obligation extraction, scored against ground
truth"* (10 files, +1624/-176). It was then reverted off
`chore/ingestion-branch-cleanup` as collateral of the persona-system revert
`e1c925e`, not because anything was wrong with it.

It is intact and recoverable:

```bash
git cherry-pick 738a90e
```

Also present on `feat/personas-owner-only-contract-access` and at the tag
`backup/before-persona-revert`.

**First action on this plan is that cherry-pick, not new code.** Take the
pipeline half; the demo half is dead now that Baltia is out of scope.

| Item in `738a90e` | Keep? |
| --- | --- |
| **Phase 2 item 6** — returns `system_instructions`, legacy prompt deleted | **keep — the single highest-leverage change** |
| **Phase 2 item 8** — every `SEK` literal and `electricity->power` hack removed | **keep** |
| **Phase 2 item 9** — `_normalize_iata_ground_handling_record` and the party-ownership guess deleted; hardcoded `schema_profile` gone | **keep** |
| `_resolve_contract_currency` — document-level currency resolved once | **keep** (this is Phase 2 item 8's replacement, already written) |
| `test_extraction_domain_neutrality.py` — 24 assertions, zero Baltia references | **keep — the industry-neutrality guarantee the packs plan builds on** |
| `apps/backend/scripts/dump_obligation_extraction.py` | keep, retarget `--hint` at the 8 fixtures |
| `use_demo_ground_truth_extraction`, `BALTIA_DEMO_REAL_EXTRACTION`, `test_demo_extraction_gate.py` | **drop** — demo-only |
| `score_obligation_extraction.py`, `test_obligation_extraction_scorer.py` | **drop** — defaults to the Baltia gold file, and no other gold file exists. Replaced by `score_obligation_coverage.py` |

What it does **not** fix — still open after the cherry-pick, verified against
`git show 738a90e:apps/backend/services/kpi_manager.py`:

- Phase 2 item 7 — the `validate_extraction_envelope` call is gone entirely at
  `:4755`; only `normalize_*` runs. Validation is still unenforced.
- Phase 4 item 15 — `kpi_sch_` id still unscoped (`:5782`).
- Phase 4 item 17 — `_validated_quote` still substitutes the source clause
  (`:6339`).
- Phase 4 item 19 — coverage manifest still joins `source_id` against
  `segment_id` (`:5243`).
- All of Phase 1 (zero silent loss).

The uncommitted Phase 1 WIP (`ClauseLedger`, `_looks_truncated`,
`_invoke_kpi_llm`) is in `git stash@{0}` — *"uncommitted kpi_manager.py before
persona revert"*. It was written on top of `738a90e`'s `kpi_manager.py`, so
cherry-pick first, then pop; a plain pop on the current base will conflict.

The design below still stands.

## Phase 0 — measurement (design, re-anchored 2026-09-04)

**Baltia is out.** `demo_data/baltia_jfk_ground_truth.json` and the
Baltia/Swissport JFK GHA were demo assets. They are not the measurement anchor
and nothing in this plan depends on them any more. The demo-gate half of
`738a90e` (`use_demo_ground_truth_extraction`, `BALTIA_DEMO_REAL_EXTRACTION`,
`test_demo_extraction_gate.py`) and the Baltia-defaulted
`score_obligation_extraction.py` are moot — cherry-pick around them or drop
them after.

### The problem hand labels were solving, solved without hand labels

Hand-labelling 8 long contracts is weeks of work, and the result only ever
scores those 8. The concern that actually motivates this plan is *"in a long
contract, things get missed"* — and that is measurable from the source document
alone.

Every currency amount, percentage, `per <unit>` rate basis, duration, and clock
deadline in a contract is a **quantitative span**. A span is covered when some
extracted record quotes it verbatim. Uncovered spans are the miss list.

This is Rule 3 — the zero-omission sweep — computed in Python as a scorer
instead of trusted to the model.

Why it beats a gold set here:

- **No labelling cost**, and it works on every contract the product ever
  ingests, not just fixtures.
- **Runs in production**, so per-contract coverage becomes a shippable number
  in the review queue, not just a CI figure.
- **Directly names the miss.** The output is a line number, the span, and its
  surrounding text — actionable without a labeller in the loop.
- **Cannot be gamed by over-extraction.** Quoting the whole document scores
  100% coverage but craters grounding and record quality, both scored beside it.

Its honest limit: it measures *quantitative* coverage. A purely qualitative
duty ("Supplier shall maintain ISO 27001 certification") carries no span and is
invisible to it. That gap is covered by the manifest anchors below and by
record-quality checks, not by pretending the coverage number is total recall.

### The corpus

`final_evaluation/datasets/kpi_contracts/` — 8 long-form contracts across 8
domains, which are also the first 8 pack families:

| Contract | Domain | Spans |
| --- | --- | ---: |
| `01_global_logistics_master_services_agreement.md` | Logistics | 95 |
| `02_healthcare_cloud_data_processing_agreement.md` | Healthcare / DPA | 58 |
| `03_solar_storage_epc_and_operations_contract.md` | Renewables EPC/O&M | 56 |
| `04_payment_processing_platform_agreement.md` | Payments / fintech | 68 |
| `05_smart_transit_operations_concession.md` | Transit concession | 59 |
| `06_telecom_5g_network_managed_services_agreement.md` | Telecom / 5G | 141 |
| `07_pharmaceutical_contract_development_manufacturing_agreement.md` | Pharma CDMO | 60 |
| `08_enterprise_ai_cloud_infrastructure_master_agreement.md` | Enterprise AI cloud | 56 |
| **Total** | | **593** |

`manifest.json` adds **60 `evaluation_anchors`** — named must-find values
(`on_time_delivery_target: 97.5%`, `security_notice: 4 hours`,
`termination_service_credit_threshold: $300,000`). Those are a hard gate at
100%: an anchor the extractor cannot quote is a defect, not a judgement call.

### The scorer

`testing/backend/scripts/score_obligation_coverage.py` — stdlib only. No Mongo,
no LLM, no backend imports. Reports, per contract:

| Metric | Meaning | Needs labels |
| --- | --- | --- |
| `span_coverage` | fraction of quantitative spans quoted by some record | no |
| `by_kind` | the same, split by currency / percent / per_unit / duration / clocktime / ratio | no |
| `grounding` | fraction of record quotes found verbatim in the source | no |
| `anchor_recall` | manifest must-find values quoted | manifest only |
| `missed_spans` | line, kind, text, surrounding context for every uncovered span | no |

`--min-coverage` and `--min-anchor-recall` make it exit non-zero, so it gates
CI directly.

### Validated, not just written

Scored against a synthetic extractor that quotes every markdown table row of
the logistics MSA and one invented clause:

```
span coverage     49.5%  (47/95)
  currency        33.3%  (9/27)
  percent         61.9%  (26/42)
  duration         0.0%  (0/4)
grounding         93.3%  (1 quote not verbatim in source)
anchor recall     37.5%  (3/8)
  MISSING ANCHOR  daily_report_deadline = 8:00 AM Central Time
  MISSING ANCHOR  security_notice = 4 hours
  MISSING ANCHOR  termination_service_credit_threshold = $300,000
```

Everything behaves: a tables-only extractor lands near half, the hallucinated
quote is caught, the anchor gate fires, and the miss list surfaces
`$3,000 per tenth of a percentage point` / `$7,500 per tenth` at line 116 — a
rate ladder written in prose, which is exactly the Rule 1 case that batch
splitting currently makes unsatisfiable.

### Taking the baseline

Needs the stack — Mongo plus an LLM key — and the 8 fixtures ingested. Dump
stored obligations per contract, then:

```bash
python testing/backend/scripts/score_obligation_coverage.py \
  --contract final_evaluation/datasets/kpi_contracts/01_global_logistics_master_services_agreement.md \
  --pred reports/extraction/full_eval_global_logistics.json \
  --manifest final_evaluation/datasets/kpi_contracts/manifest.json \
  --contract-id full_eval_global_logistics \
  --report reports/coverage/global_logistics.json
```

Three runs per contract give the stability figure. Expect that to be the
ugliest number in the first report — `as_completed` first-wins dedup
(`kpi_manager.py:4851`) currently lets thread finish order pick which duplicate
survives.

## Phase 1 — zero silent loss

Today a batch can vanish with one `logger.warning`, and two opposite failure
modes sit next to each other.

1. **Clause ledger.** Every clause unit gets an id and exactly one terminal
   state: `extracted`, `rejected(reason)`, `lost`. Run fails on any `lost`.
2. Stage-1 non-list/parse failure keeps the batch instead of `return []`
   (`kpi_manager.py:4664`) — matching what the exception path already does.
3. Stage-2 truncation detected explicitly (finish_reason, unbalanced braces)
   → split and retry, never drop (`kpi_manager.py:4728`). Groq caps output at
   8192 tokens against 10 full phase-aware records, so truncation is expected,
   not exceptional.
4. Ordered merge replaces `as_completed` first-wins dedup
   (`kpi_manager.py:4851`) — today thread finish order picks the survivor.
5. Fallback becomes per-clause, not per-run (`kpi_manager.py:2404`), so one bad
   batch can't swap the whole register for keyword-extractor output.

Gate: 0 lost across all 6 fixture contracts, 3 runs each.

## Phase 2 — ship the right prompt, enforce the schema

`_build_kpi_llm_prompt` builds the agreement-first 2.1 prompt at
`kpi_manager.py:4909` — Rules 0–4, rate-ladder unrolling, zero-omission sweep,
liability regime — and then returns the legacy KPI-first prompt at
`kpi_manager.py:4970`. The obligation prompt has never shipped.

6. Return `system_instructions`; delete the legacy prompt. One vocabulary end
   to end.
7. Validation enforces: fail → targeted repair prompt → quarantine with reason.
   Run it *before* normalization, otherwise its version and record-type checks
   can never fire (`obligation_extraction_schema.py:238`, `:253`).
8. Delete the SEK/IATA hardcodes (`kpi_manager.py:6272`, `:5829`, `:5842`,
   `:5853`) and the `electricity→power` key hacks (`:5249`). The gold contract
   is `USD/turnaround` — the SEK cascade is wrong on the contract it was
   written for. Replace with a document-level currency resolved once.
9. Delete the party-ownership guess (`kpi_manager.py:6286`): money-word →
   client, else supplier. The prompt, the normalizer, and
   `test_ambiguous_ownership_is_reviewable_and_never_defaults_to_supplier` all
   already say never guess.

Gate: party_role and currency accuracy vs the Phase 0 baseline.

## Phase 3 — re-cut the unit of work

Batching stays; the boundaries change. Today they are byte counts
(`char_budget=8000, max_records=10`, `kpi_manager.py:4874`), which splits rate
ladders and tables across prompts — making Rule 1 unsatisfiable — and gives 10
unrelated clauses a shared failure fate.

10. Extraction unit = one section or one whole table. Never split a table.
    Oversized sections split at clause boundaries with overlap.
11. A compact document header on every extraction prompt: parties and roles,
    currency, defined terms, liability regime, notice mechanics. Extracted once
    per contract, cached. This is what makes Rules 1 and 4 executable.
12. Two passes per unit. Pass A extracts; pass B is the zero-omission sweep,
    hunting only currency / percent / `per <unit>` tokens pass A missed. Union.
13. A cheap confirmation pass on the two worst fields only — `party_role` and
    `value`+`unit` — one record at a time, quote-only context.

Gate: `per_unit` and `currency` span coverage on the logistics MSA rate ladders
(`01_*.md` line 116, the `$3,000 / $7,500 per tenth of a percentage point`
ladder) and the telecom 5G fixture's 141 spans.

## Phase 4 — deterministic post-processing

14. Rebuild `_extraction_metric_key` with no domain strings. Merges require
    evidence agreement (clause ref + value + unit), never name similarity.
15. Contract-scope every id, including `kpi_sch_` (`kpi_manager.py:5840`),
    which currently collides across contracts — one contract's fee schedule
    overwrites another's, since upsert matches on `kpi_id` alone.
16. Consolidate once, not three times (`:4861`, `:2412`, `:2417`).
17. `_validated_quote` (`:6310`) stops returning the whole source clause when
    the model's quote isn't found. Unmatched → quarantine. Citation grounding
    becomes 100% by construction.
18. Review flag fires on a *named* missing field only. Drop the blanket
    `missing_elements` trigger (`obligation_extraction_schema.py:180`) that
    flags nearly every non-numeric obligation.
19. Fix the coverage manifest join (`:5278`) — records keyed `src_*` against
    candidates keyed `segment_id`, so it never matches and over-credits by page.

## Phase 5 — drive coverage up on the 8 fixtures, hold it

20. Work the miss list one span at a time. Each uncovered span becomes either a
    rule plus a regression test, or a logged non-operative with a reason —
    never a string hack.
21. Per-family coverage floors in each pack's `coverage.yaml`
    (`obligation-extraction-packs.md`). A family whose floor cannot be met by
    one pack is the signal to split it.
22. Nightly: 8 contracts × 3 runs, gated on span coverage / anchor recall
    (100%) / grounding (100%) / stability / 0-lost. Regression blocks merge.
