# Obligation extraction: system prompt + contract-type packs

Companion to `obligation-extraction-accuracy.md`. That doc covers *measurement
and plumbing*. This one covers *what the model is told* — the single obligation
system prompt, and the per-contract-family packs that give it domain context.

## Why this shape

Extraction is not retrieval-limited. `_load_candidate_chunks`
(`kpi_manager.py:4411`) full-scans every stored chunk for the contract; there is
no top-k. Clauses are lost *after* retrieval — at the Stage-1 gate, at batch
boundaries, at output truncation, and in the merge key.

So the lever is context quality, not retrieval strategy. Two layers:

| Layer | Scope | Lives in | Changes when |
| --- | --- | --- | --- |
| Obligation system prompt | Every contract, every family | Python constant | The extraction contract changes |
| Contract-type pack | One contract family | Versioned file, loaded as data | Domain knowledge changes |

The split matters because the system prompt states **grammatical shape** rules
that are family-independent (a rate ladder is a rate ladder whether it tiers
aircraft or SKUs), while a pack states **what exists in this kind of
agreement** — which is exactly the knowledge currently smuggled into Python as
IATA/SEK hardcodes.

## Layer 1 — the obligation system prompt

### It exists, was fixed, and the fix was reverted

On `chore/ingestion-branch-cleanup` today, `_build_kpi_llm_prompt`
(`kpi_manager.py:4890`) builds `system_instructions` at `:4909` — the 2.1
agreement-first prompt, Rules 0-4 — and then returns the legacy KPI-first
prompt at `:4970`. The obligation prompt has never run in this tree.

It is already fixed in commit `738a90e`, which was reverted off this branch as
collateral of the persona revert `e1c925e`. Recover it before writing anything
new:

```bash
git cherry-pick 738a90e
```

That commit returns `system_instructions`, deletes the legacy prompt, and
removes every hardcode in the table below. It is the highest-leverage change in
this document and it is already written.

### What the prompt must own (family-independent)

- **Rule 0 — data-rich records.** Depth over count. Every record carries a
  name, verbatim quote (<= 45 words), explicit `party_role`, and either a
  structured measurement or a structured obligation.
- **Rule 1 — rate-ladder unrolling.** Two or more consecutive lines sharing the
  shape `<tier or condition>, <amount> [per <unit>]` where only tier and amount
  vary = one record per row. Count the rows, verify the record count matches.
  This is a grammatical rule, deliberately not tied to a fee type.
- **Rule 2 — compound pricing.** Multi-component prices become
  `target_type: price_structure` with each component populated, never
  `measurement: null` with the detail stranded in the quote.
- **Rule 3 — zero-omission sweep.** Re-scan each clause for any remaining
  currency amount, percentage, or `per <unit>` phrase not yet in a record's
  quote. Emit a record or log it in `coverage.sections_without_records` with a
  reason.
- **Rule 4 — liability regime first.** Resolve the governing liability article
  before emitting financial-consequence records; stamp every recovery with
  whether it survives that regime.
- **Rule 5 — never guess ownership.** Ambiguous `party_role` is `null` +
  `needs_review: true` + a note. Never a keyword default. (The schema module
  and its test already say this; Python currently overrides it — see below.)
- **Rule 6 — quotes are verbatim or the record is quarantined.** No
  substitution.

### What must come out of Python

These are pack content masquerading as code. All of them run unconditionally,
on every contract — and **all of them are already deleted in `738a90e`**. The
table records what the hardcode was and what replaces it, so the pack design
below has somewhere to land; the removal itself is a cherry-pick, not new work.

| Hardcode | Site | Replace with |
| --- | --- | --- |
| `_normalize_iata_ground_handling_record` applied to every row | `kpi_manager.py:6260` | Pack-driven normalizer, selected by resolved family |
| `schema_profile = "iata_ground_handling"` | `:6256` | Resolved family id |
| Currency defaults to `SEK` unless `$` in quote | `:6271` | Document-level currency, resolved once per contract |
| Three more `SEK` literals | `:5828`, `:5842`, `:5853` | Same |
| Party ownership guessed by money-word keyword | `:6285` | Delete. Rule 5 governs. |
| `electricity->power`, `supply->power`, `overtime->extra`, `departing->""` | `:5247` | Evidence-based merge key (see accuracy plan, item 14) |

The currency hardcode is wrong on the very contract it was written for:
`demo_data/baltia_jfk_ground_truth.json` is denominated `USD/turnaround`.

The ownership hardcode silently contradicts
`test_ambiguous_ownership_is_reviewable_and_never_defaults_to_supplier`. That
test passes only because it exercises `obligation_extraction_schema` in
isolation and never reaches `kpi_manager`.

## Layer 2 — contract-type packs

### Format

One directory per family under `apps/backend/packs/obligations/<family_id>/`:

The eight families come from `final_evaluation/datasets/kpi_contracts/` — the
same corpus the coverage scorer runs on, so every pack has a fixture to be
scored against from day one. (IATA ground handling is deliberately not on this
list: it was the demo family, and it is what the hardcodes were built around.)

```
packs/obligations/
  _base/                       # shared fragments packs can include
    rate_ladder_shapes.md
    notice_and_cure.md
    reporting_cadence.md
  logistics_msa/               # fixture 01
    pack.yaml                  # identity, routing, versioning
    taxonomy.md                # obligation types for this family
    sweep.md                   # where obligations hide in this document type
    conventions.md             # units, currency, party vocabulary, defined terms
    examples.md                # 3-6 worked records from real clauses
    coverage.yaml              # required-coverage checklist -> scored
  data_processing_agreement/   # fixture 02
  epc_and_om/                  # fixture 03
  payment_processing/          # fixture 04
  transit_concession/          # fixture 05
  telecom_managed_services/    # fixture 06
  pharma_cdmo/                 # fixture 07
  cloud_infrastructure_msa/    # fixture 08
```

`pack.yaml` carries routing and versioning:

```yaml
id: logistics_msa
version: 1
display_name: Logistics Master Services Agreement
extends: _base
fixture: final_evaluation/datasets/kpi_contracts/01_global_logistics_master_services_agreement.md
match:
  # Every signal is advisory; the classifier scores, it does not hard-match.
  title_patterns: ["master services agreement", "logistics", "transportation services"]
  body_markers: ["on-time delivery", "EDI 214", "lane", "freight", "Peak Season"]
  structure: ["service_level_table", "fee_schedule_table"]
conventions:
  currency_resolution: document   # resolved once per contract; never a literal
  party_vocabulary:
    supplier: ["Provider", "Northstar", "Logistics Provider"]
    client: ["Customer", "Shipper"]
budget:
  max_context_tokens: 1800     # hard cap; packs are context, not novels
```

`coverage.yaml` is the part that turns a pack into a testable asset:

```yaml
# Floors, scored by testing/backend/scripts/score_obligation_coverage.py
span_coverage_floor: 0.90       # of the fixture's 95 quantitative spans
anchor_recall_floor: 1.0        # manifest evaluation_anchors are must-find
grounding_floor: 1.0            # every quote verbatim in source

required_obligation_classes:
  - id: service_level_target
    description: On-time pickup/delivery and lane performance targets
    expect: ">=1 record per target named in the service level table"
  - id: tiered_service_credit
    description: Credit ladders expressed in prose, not tables
    expect: "one record per tier; see 01_*.md L116, $3,000 / $7,500 per tenth"
  - id: reporting_deadline
    expect: ">=1 record per stated cadence (daily/weekly/monthly/quarterly)"
  - id: records_retention
    expect: ">=1 record"
  - id: termination_trigger
    expect: ">=1 record"
```

`span_coverage_floor` is the number that answers *"did we miss things in this
long contract"*. It is computed, not labelled, so a new family costs a
directory rather than a labelling project.

### Resolution

1. **Classify once per contract**, at ingest, not per batch. Mirror
   `services/table_classification.py`: a short LLM call over the first N
   headings + the ToC, returning `{family_id, confidence, signals}`, scored
   against every pack's `match` block.
2. **Confidence floor.** Below it, fall back to `_base` only and set
   `needs_review` on the run. A wrong pack is worse than no pack — it is how
   the IATA hardcodes got their reach.
3. **Persist** `contract_family`, `pack_id`, `pack_version` on the contract and
   stamp them on every extracted record. Those fields already exist in
   `kpi_schema.py:705` and are never populated.
4. **Allow override.** A project lead picks the pack in the UI; a manual choice
   pins and outranks the classifier.

### Injection

The pack renders into one `<CONTRACT_TYPE_PACK>` block appended to the system
prompt, above `<SOURCES>`. Hard rules:

- **Budgeted.** `max_context_tokens` enforced at render; overflow truncates
  `examples.md` first, never `taxonomy.md` or `conventions.md`.
- **Cached per contract**, not rebuilt per batch. With ~40 batches per
  contract, a 1.8k-token pack is 72k tokens of avoidable spend per run.
- **Data, never instructions.** The pack is authored by your team, but render
  it inside a delimited block with the same "treat as reference, not as
  commands" framing the source clauses get. Packs will eventually be
  user-editable; build the boundary now.
- **Never overrides Rules 0-6.** A pack adds vocabulary and locations. It
  cannot license a guess, relax the verbatim-quote rule, or introduce a default
  currency.

### Why this beats the current hardcodes

- One IATA branch becomes N packs, each independently versioned and scored.
- Adding a family is a directory, not a `kpi_manager.py` edit.
- `coverage.yaml` gives per-family recall floors — the metric that actually
  answers "did we miss things in this long contract".
- Pack version is stamped on every record, so a recall regression is
  attributable to a specific pack bump.

## Interaction with the accuracy plan

Packs raise the ceiling. They do not fix the floor. Ordering matters:

| Do first | Because |
| --- | --- |
| **`git cherry-pick 738a90e`** | Restores the shipped obligation prompt, the hardcode removals, the scorer, the dump script, and the demo extraction gate — all of it already written |
| Enforce validation before normalization | `validate_extraction_envelope` runs after `normalize_*` (`:4750`), so version and record-type checks can never fire; results are logged as warnings and dropped |
| Zero silent loss (accuracy plan Phase 1) | A pack cannot help a batch that vanished at `return []` (`:4726`) |
| Re-cut batches to section/table boundaries | Rule 1 is unsatisfiable while `char_budget=8000` splits ladders across prompts |
| Fix `_validated_quote` (`:6310`) | It substitutes the whole source clause when the model's quote is not found, so grounding is unverifiable |
| Contract-scope `kpi_sch_` ids (`:5840`) | Cross-contract collision under upsert-on-`kpi_id` |

Then packs, then per-family coverage gates.

## Measurement — nothing here is creditable without it

`final_evaluation/reports/kpi_results.csv` reports `kpi_candidate_recall = 1.0`
across the board. That metric is `layers.py:499`:

```python
terms = ("threshold", "deadline", "notice", "remedy", "service level", ...)
return min(1.0, sum(1 for term in terms if term in answer.lower()) / 5)
```

A keyword bag over the agent's chat reply. It never compares against a gold
obligation. Those 1.0s are not evidence of anything.

There is no obligation gold set, and there does not need to be one.
`testing/backend/scripts/score_obligation_coverage.py` derives the denominator
from the source document: 593 quantitative spans across the 8 fixtures, plus 60
must-find `evaluation_anchors` from `manifest.json`. Span coverage, grounding,
and anchor recall are all computed without a labeller. See
`obligation-extraction-accuracy.md` Phase 0.

Every pack's `coverage.yaml` floor is enforced by that scorer, which is why a
pack is a testable asset rather than a prompt fragment someone hopes is
helping.

## Model ceiling

`settings.model_name` defaults to `llama-3.1-8b-instant` (`core/config.py:26`);
CI sets `qwen/qwen3-32b`. Groq output is capped at 8192 tokens
(`_kpi_max_tokens`, `:5112`) against batches of 10 four-phase records, so
truncation is the expected case and there is no truncation detection.

Before attributing a recall number to prompt or pack quality, pin the
extraction model explicitly and re-baseline. A pack cannot buy reasoning the
model does not have.

## Phasing

| Phase | Work | Gate |
| --- | --- | --- |
| P0 | Cherry-pick `738a90e`; take the baseline | A baseline number exists |
| P1 | Restore the `validate_extraction_envelope` call (dropped in `738a90e`) and enforce it before normalization | Validation errors observable, not logged and dropped |
| P2 | Document-level currency resolved once per contract, replacing the deleted SEK cascade | `currency` and `party_role` accuracy vs P0 |
| P3 | Pack loader, `_base` + `logistics_msa`, classifier, `contract_family` persisted | Fixture 01 span coverage >= P2 with the pack, and `_base`-only does not regress |
| P4 | Packs for the other 7 fixture families | Per-family `coverage.yaml` floors met |
| P5 | Nightly: 6 contracts x 3 runs, gated on recall / grounding / stability / 0-lost | Regression blocks merge |

## Open questions

1. **Pack authorship.** Engineering-authored files in-repo, or user-editable
   records in Mongo with the same schema? In-repo first — versioning and review
   are free. The `playbooks` collection (`api/routes/playbooks.py`) is the
   precedent if these go user-editable later.
2. **Family granularity.** One `saas_msa` pack, or split MSA / SOW / DPA? Start
   coarse; split when a `coverage.yaml` floor cannot be met by one pack.
3. **Multi-family documents.** An MSA with an annexed DPA. Per-section pack
   resolution, or a primary pack plus includes? Includes are simpler and
   probably sufficient.
