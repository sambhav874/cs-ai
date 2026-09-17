# Obligation extraction — improvement plan (accuracy · cost · reliability)

Date 2026-09-07 · Branch `chore/ingestion-branch-cleanup` @ `52c785c`
Evidence: `docs/reviews/obligation-extraction-audit-2026-09-07.md`
Pack design: `docs/plans/obligation-pack-authoring.md` · `docs/plans/obligation-extraction-packs.md`

---

## 0. The one thing to understand before reading the phases

The three axes are not independent, and today they fail *together* through a single mechanism:

```
6 concurrent workers, no backoff  ──►  provider 429 / timeout
                                          │
                     _query_kpi_llm_json catches everything ──► {}
                                          │
                     {} is indistinguishable from "model found nothing"
                                          │
              batch dropped after 2 retries ──► clauses silently lost
                                          │
                   run reports status: completed, plausible count
```

A **reliability** event (rate limit) becomes an **accuracy** loss (missing obligations) that is
invisible because there is no loss accounting, and the retry that was supposed to save it costs
**money** while making the truncation worse. Fixing one axis in isolation gets you a third of the
benefit. That is why Phase 1 is loss accounting and not prompt work: it is the instrument all three
axes are measured on.

---

## 1. Measured baseline

### Volume, per contract (measured on the 8 fixtures)

| Fixture | Clause records | Stage-1 calls | Stage-2 calls | Input tokens/run |
|---|---:|---:|---:|---:|
| 01 logistics MSA | 119 | 8 | 12 | 44,344 |
| 02 healthcare DPA | 101 | 7 | 11 | 38,900 |
| 03 solar EPC | 105 | 7 | 11 | 38,778 |
| 04 payments | 115 | 8 | 12 | 42,976 |
| 05 transit concession | 123 | 9 | 13 | 46,646 |
| 06 telecom 5G | 210 | 14 | 21 | 76,650 |
| 07 pharma CDMO | 192 | 13 | 20 | 70,182 |
| 08 enterprise AI | 188 | 13 | 19 | 66,434 |
| **Average** | **144** | **10** | **15** | **53,113** |

≈ **25 LLM calls and ~53k input tokens per contract extraction.**

*Validation:* the clause splitter used for this table is a reimplementation of `_clause_units`; run
against the real method on all 8 fixtures it lands within **+1.1%** (1,435 units vs 1,420), so the
call counts are sound. The **token** figure additionally assumes per-call prompt overheads
(~450 tokens Stage-1, ~2,600 Stage-2) and `chars/4` tokenisation — those constants are estimates and
have **not** been validated against real prompt sizes or a tokeniser. Treat calls as measured and
tokens as approximate.

**This is a lower bound.** It is computed from the raw markdown, i.e. the equivalent of a single
chunk level. The real pipeline loads **all three** levels — `macro` (compacted section summaries,
≤2,600 chars), `meso` (1,200–3,000 chars), `micro` (value-centred windows, ~420 chars of context
each) — from one Mongo query with no level filter (`kpi_manager.py:4434`). Micro segments are
substrings of meso, which are substrings of the section; the dedup at `:4640` hashes
`normalized[:800]`, so overlapping-but-not-identical text survives as separate records.

**Measured 2026-09-07 — the estimate is confirmed at 2.68×.** Running the real `DocumentSegmenter`
over the eight fixtures (no Mongo, no LLM needed):

| Level | Chars across 8 fixtures | Share of candidate text |
|---|---:|---:|
| macro | 284,807 | 40.2% |
| meso | 281,616 | 39.7% |
| micro | 142,288 | 20.1% |
| **total** | **708,711** | vs 264,071 chars of document = **2.68×** |

Per fixture the multiple is tight: 2.49× – 3.06×. So the real figure is ~142k input tokens and
~67 calls per contract, at the low end of the earlier 2.5–4× estimate.

### Cost model

Rate-independent, so it survives any pricing change:

```
cost_per_contract = calls × (avg_input_tokens × in_rate + avg_output_tokens × out_rate)
```

### D2 settled by measurement — extract from `meso` only

Span coverage if extraction reads **only** one level (548 quantitative spans, 8 fixtures).
Measured **offset-based**: a span counts only when a segment of that level actually spans the
document offsets the span occupies.

| Level read | Span coverage | Candidate text |
|---|---:|---:|
| macro only | 93.4% | 40.2% |
| micro only | 92.0% | 20.1% |
| **meso only** | **100.0%** | **39.7%** |
| meso + micro | 100.0% | 59.8% |

> **Method correction, 2026-09-07.** The first run of this measurement asked whether a span's *text*
> appeared anywhere in a level's concatenated text. That credits a level for an unrelated occurrence
> of the same string elsewhere in the document ("30 days", "per shipment"), and it inflates the thin
> levels most. Reported figures were macro 94.0% / micro 96.2%; offset-based they are macro 93.4% /
> micro **92.0%** (as low as 83.3% on fixture 08). meso was 100.0% under both methods.
> The conclusion is unchanged and strengthened. Logic is now pinned by
> `testing/backend/tests/test_measure_level_coverage.py` (13 tests, stdlib-only).

`meso` alone reaches **100.0% on every fixture individually**, not just in aggregate — meso segments
tile the document (19,227 chars of meso for an 18,474-char contract), so reading them is reading the
contract once. macro is a *compacted* section summary and micro is a value-window subset; both lose
spans, and neither adds anything meso lacks.

> ## ⛔ D2 REFUTED BY EXPERIMENT, 2026-09-07 — do not act on the table above
>
> The table measures **geometric containment**: whether a span's document offsets fall inside a
> segment of that level. It answers "is the text present in meso?" — and the answer is yes, 100%.
>
> It does **not** answer "will the model extract it from meso?", and that turns out to be a
> different question with a different answer. Running the real pipeline with `--level meso` on
> fixture 01:
>
> | Run | Records | Span coverage | Clause loss |
> |---|---:|---:|---:|
> | all levels (production) | 74 | **97.9%** | 46.6% |
> | **meso only** | 49 | **67.4%** | 40.3% |
>
> Span coverage collapses by 30 points. Currency 70.4%, percent 61.9%, per_unit 61.1%.
>
> **The chunk redundancy is doing real work, not wasting tokens.** `micro` segments are narrow
> value-centred windows; inside a 1,200–3,000 char `meso` chunk the model passes over values it
> extracts when handed them in a focused window. The 2.68× is buying ~30 points of coverage.
>
> **Consequences:**
> - "Extract from meso only, −60% tokens at no span loss" is **withdrawn**. It would have cost about
>   a third of quantitative coverage.
> - The Phase 3 cost case loses its largest single lever. Cost work must find savings that do not
>   remove granularity — batching on the output axis still stands, chunk-level culling does not.
> - Clause loss barely moved (46.6% → 40.3%), so redundancy is **not** the main driver of the loss
>   figure either. The earlier "loss is inflated by duplicate clause instances" explanation is at
>   best partial.
>
> **Method lesson worth keeping:** a geometric or static measurement can be exactly right about the
> property it measures and still be the wrong proxy for pipeline behaviour. Verify a level-culling
> decision by running the pipeline, not by measuring the corpus.

*Limit to respect:* this measures quantitative spans. Before locking the level, confirm no
qualitative duty lives only in macro text — macro is lossy paraphrase of section content, so this is
unlikely, but it is unverified.

*Second reason to drop macro, beyond cost:* macro chunks are compacted summaries, and the extraction
prompt demands verbatim quotes. A model quoting from a compacted summary produces a quote that is
not in the source, which `_validated_quote` then silently replaces with the whole clause (H4).
Feeding paraphrase into a verbatim-quote extractor manufactures grounding failures.

| Lever | Change | Token effect |
|---|---|---|
| ~~Extract from `meso` only~~ **withdrawn — costs 30 pts of span coverage** | — | — |
| Drop the Voyage rerank from this path (result is discarded anyway) | Phase 3 | −1 call, −5s latency |
| Stage-1 merge into Stage-2 (one pass, not two) | Phase 3 (optional) | −40% calls |
| Pack injection, cached per contract | Phase 5 | **+1,800 tok × every batch** |
| Bigger model for Stage-2 only, cheap model for Stage-1 | Phase 3 | rate-mix, not volume |

Note the tension the plan must hold: Phase 3 buys the token budget that Phase 5 then spends. A
1,800-token pack across ~60 batches is ~108k tokens per contract — *more than the entire current
input budget*. Packs are only affordable **after** the redundancy fix, and only if the pack is
cached per contract and budget-capped. That is not a nice-to-have ordering; it is why packs are
Phase 5.

### Phase 0 baseline — fixture 01, real extraction, measured 2026-09-07

Real pipeline, in memory (`testing/backend/scripts/extract_fixture_baseline.py`), `FakeDB`, nothing
written. Provider groq, model `openai/gpt-oss-120b`, 31 LLM calls, 64s, 74 records.

| Metric | Result |
|---|---|
| **span coverage** | **97.9%** (93/95) |
| **grounding** | **100.0%** (0 non-verbatim quotes) |
| currency / percent / clocktime / ratio | 100% each |
| duration | 75% (3/4) · per_unit 94.4% (17/18) |
| Stage-1 screen | 196 in → 133 kept — **32.1% rejected** |

**This contradicts the narrative the rest of this plan was written around, and the correction
matters more than the plan's tidiness.**

The `$3,000 / $7,500 per tenth` rate ladder — cited throughout as the canonical loss — **is
extracted**. Not merely quoted: it lands structured, e.g.

```json
"target_schedule": [
  {"tier": "Tier A", "range": "97.0% to 98.99%", "penalty_per_tenth": "$15,000",
   "unit": "USD", "reference_threshold": "99.0%"},
  {"tier": "Tier B", "range": "Below 97.0%", "penalty_per_tenth": "$30,000",
   "unit": "USD", "additional_action": "Executive review", "reference_threshold": "97.0%"}
]
```

All six per-tenth amounts ($3,000 / $7,500 / $4,000 / $9,000 / $15,000 / $30,000) are bound to
fields. Field population is high: name, quote, party_role, obligation_type, operator, measurement,
record_type, confidence, needs_review all 100%; value 84%; unit 93%.

**What was over-claimed, and is now withdrawn for this fixture/model:**

- *"Byte-count batching severs the ladder from its table, so no prompt can recover it."* It did not
  happen here. The model received enough context and structured the ladder correctly.
- *"The model ceiling is the problem."* `openai/gpt-oss-120b` performs well.
- *"Shipping the dead 2.1 prompt is urgent."* The live 2.0 prompt produced these numbers.

**D3 answered — keep Stage-1.** It rejects 32.1%, comfortably above the 20% bar set for retiring it.
It is doing real filtering work, not burning calls for nothing.

**Cost figures corrected.** Fixture 01 is **31–34 calls**, not the ~20 estimated; the earlier
~25/contract average understates and is closer to ~40. The scratch replica used for those estimates
deduped differently.

**What still stands — all measured, none inferred:**

1. **12% of production runs fell to `deterministic_fallback`** (11 of 92 tagged). Silent regex
   extraction of whole contracts. Unaffected by this baseline.
2. **`needs_review` is a write-path loss, not a model failure.** Extraction sets it on 100% of
   records here; production stores it on **0 of 2,135**. The diagnosis is now sharper than before —
   the field is produced and then dropped between extraction and storage.
3. 2.68× chunk redundancy and ~34 calls/contract — the cost case is untouched.
4. Claude excluded by `_llm_provider_available`; team model settings never reach the KPI router.
5. C1 cross-contract id collision (fixed).

**What this baseline does *not* cover, and where the failure modes should be tested next:**

- Fixture 01 is 18k chars. Truncation and batch-severing should bite hardest on the **62k-char
  telecom fixture (130 spans)** — the theory predicts failure there, so that is the honest next test
  rather than more contracts like this one.
- Fixture 01 is logistics. The IATA framing (C3) should hurt most on **pharma or the DPA**.
- Span coverage is **quantitative only**. Qualitative duties remain unmeasured, and this metric
  scores *quoting*, not correct structuring — high coverage is not high quality.

### Silent clause loss — measured, and it scales with contract size

Telecom (fixture 06, 62k chars) run under the same harness: **97.2% span coverage (137/141),
98.5% grounding, 40 calls, 68 records, Stage-1 rejected 50.3%**. On the headline metrics it looks as
healthy as fixture 01 — the predicted truncation collapse did not show up there either.

It shows up when you count clauses instead of spans. Every record cites the `source_id` of the
clause it came from, so the clauses that passed Stage-1 as genuine obligation candidates and then
produced **no record at all** can be counted directly:

| Fixture | Size | Span cov | Grounding | Accepted by Stage 1 | Extracted | **Lost** |
|---|---:|---:|---:|---:|---:|---:|
| 01 logistics | 18k | 97.9% | 100% | 133 | 71 | **62 (46.6%)** |
| 06 telecom | 62k | 97.2% | 98.5% | 170 | 77 | **93 (54.7%)** |
| 02 healthcare DPA | 14k | 86.2% | 100% | 95 | 53 | **42 (44.2%)** |

**Roughly half of every contract's accepted clauses produce no record at all**, and the rate is
broadly flat across size and domain — 44–55% on all three.

> **Correction, 2026-09-07.** An earlier version of this table reported 17.3% / 34.1% / 49.5% and
> concluded that loss "doubles with contract size" and is "content-driven, the DPA loses most".
> **Both conclusions were artifacts of a measurement bug and are withdrawn.** The hand-count that
> produced them unioned `chunk_id` into the set of extracted clause ids — but `chunk_id` is a
> *segment* identifier (`micro_15468_…`, `macro_15252_…`), a different namespace from a clause
> `source_id` (`src_124_0_…`). That invented 39 phantom extractions on fixture 01 alone.
> `ClauseLedger` counts it correctly during the run, and its `extracted` figure matches
> `own source_id ∪ source_evidence` exactly on all three fixtures. Real loss is **higher and flatter**
> than reported.

*Fair caveat, unchanged:* Stage-1 is deliberately high-recall, so some accepted clauses genuinely
carry no obligation. The problem remains that **nobody can tell which** — a legitimately empty clause
and one lost to a truncated batch are indistinguishable. That is what the ledger now makes visible,
and `lost_reasons` currently answers `unexplained` for the large majority (59/62, 93/93, 32/42),
which says the loss is happening somewhere not yet instrumented rather than in the two paths already
tagged (`empty_batch_response`, `worker_error`). **Finding where is the next task.**

**Consequence for the gates: span coverage must not be the Phase 1 loss metric.** Coverage held at
~97% on both fixtures while the loss rate doubled, because a single record's quote can carry several
spans — 68 records still covered 137 of 141 spans. Coverage measures *whether the text was quoted
somewhere*, not *whether every clause was processed*. The Phase 1 gate is therefore
**0 clauses unaccounted for by the `ClauseLedger`**, measured as in the table above; span coverage
stays as a Phase 2/3 quality gate where it is appropriate.

### The qualitative blind spot, demonstrated (fixture 02)

The DPA's Article V is the family's entire compliance surface. Searching the 70 extracted records
for each duty by name:

| Duty | Extracted |
|---|---|
| security incident notice | found |
| subprocessor control | found |
| safeguards | **absent** |
| breach notification support | **absent** |
| data segregation | **absent** |
| access controls | **absent** |
| no sale / secondary use | **absent** |

Span coverage cannot see this — those clauses carry no quantitative span to miss. It is the exact
failure the pack `taxonomy.md` layer exists to fix, and the first hard evidence for it.

**Record shape backs it up:** of 70 records, **44 are `supporting_measurement`** and only **19 are
`trackable_operational_obligation`**, on a contract that is mostly duties. That is the signature of
the KPI-centric 2.0 prompt that actually ships, and it is the first concrete evidence that shipping
the obligation-first 2.1 prompt (Phase 2 / C2) would change outcomes rather than merely tidy the code.

**C3 severity partly walked back.** Checking the DPA's records for leaked aviation vocabulary
(ground handling, SGHA, aircraft, airline, station, turnaround, IATA, SEK) returns **nothing**. The
hardcoded IATA framing is not contaminating output terminology on a healthcare contract. It may
still bias *selection*, and the currency/normalizer hardcodes remain independently wrong, but the
"every contract is prompted as an aviation agreement, so records come out aviation-shaped" claim is
not supported by this evidence.

### Ground truth — it exists, and extraction passes it

`final_evaluation/datasets/kpi_contracts/manifest.json` carries **60 hand-specified
`evaluation_anchors`** across the 8 fixtures (6–8 each) — the must-find values: targets, deadlines,
retention periods, notice windows, caps. Plus `critical_sections` per contract. The scorer has
supported `--manifest`/`--contract-id` all along; it had simply never been run.

| Fixture | Anchor recall |
|---|---|
| 01 logistics | **100%** (8/8) |
| 02 healthcare DPA | **100%** (8/8) |
| 06 telecom | 6/7 — the 7th anchor is itself wrong (below) |

**23 of 23 valid anchors found.** Against the only real ground truth in the repo, extraction of
must-find values is clean.

> **Two corrections, both mine, both recorded rather than quietly fixed.**
>
> **1. The first anchor run reported 75–86% and I reported it as "ground truth says 75%". That was a
> bug in `score_obligation_coverage.py`.** Contracts spell small numbers as words ("seven years",
> "four hours", "twenty-four hours", "ten years") while the manifest anchors use numerals ("7 years",
> "4 hours"). The matcher compared raw strings, so four correctly-extracted anchors were scored as
> missing. Fixed with a number-word normaliser on both sides; the scorer's 13 tests still pass.
>
> **2. `monthly_service_credit_cap = 35%` on telecom is faulty ground truth.** The contract contains
> no aggregate credit cap at all — `shall not exceed`, `aggregate credit`, `capped` return nothing.
> The only "35" is a `35.0% Fee Credit` tier for KPI-TEL-06 slice isolation. The anchor names a
> provision the contract does not have. **Hand-specified ground truth can itself be wrong**, and a
> 100% gate on it will fail for reasons that have nothing to do with extraction.

**What this ground truth can and cannot tell us:**

- ✅ Must-find values are being extracted — a real, externally-specified recall floor, passed.
- ❌ **Not full recall.** 8 anchors is not an obligation inventory; true recall stays unmeasurable.
- ❌ **Values only** — no party, operator, or consequence. Whether a record is *correct* has still
  never been checked on a single record.
- ❌ **Recall-only** — cannot detect false positives.

**Gate implication:** anchor recall is a better Phase 2 gate than span coverage (which reported
97.9% where anchors report the real must-find picture), but it must be stated as *100% of valid
anchors*, with the telecom anchor corrected or excluded first.

### ⛔ VOID — the production KPI data is entirely demo output (established 2026-09-07)

**Everything in the section below that draws on the `contract_kpis` collection is withdrawn.**

Checked directly: of 2,135 stored KPI records, **zero** carry `run_id`, `ai_extraction_provider`,
`extraction_method` or `last_extraction_mode` — every field the real extraction path stamps via
`_production_kpi_metadata`. What they do carry is `last_demo_extraction_run_id`, and every
high-count contract is `BaltiaGHAContract`. `KPISchemaV1toV2Migrator.migrate_doc` was tested
directly and does emit `governance`/`schema_version`/`identity`, so records lacking those did not
pass through `extract_for_contract`'s upsert at all.

**Specifically withdrawn:**

- *"65% of records are pricing/rate-card types, which is the shape of an aviation rate-card prompt
  applied to a general portfolio"* — it is demo data from the aviation demo contract. It shows
  nothing about prompt bias.
- *"`needs_review` is set on 100% of extracted records and stored on 0 of 2,135 — a write-path
  loss"* — the demo builder does not migrate. No evidence the real path drops it.
- *"424 records carry `target_schedule` but zero `kpi_sch_*` records exist"* — demo output, so it
  says nothing about `_consolidate_multi_tier_schedules`. (The C1 fix stands on its own: the
  collision was proven by reading the code, and the absence of `kpi_sch_` records means only that
  nothing has collided *yet*.)

**What survives — verified.** The `contract_kpi_extraction_runs` collection is written by
`extract_for_contract` itself and is **mostly real**: of 236 runs, only 49 are Baltia-named, and the
rest include `full_eval_telecom_5g.pdf` (49), `StandardGroundHandlingAgreement.pdf` (62),
`airport-charges-2025.pdf` (26), `Cascade Natural Gas…` (15) and the markdown fixtures. So run-level
findings hold: the **12% `deterministic_fallback` rate**, the 9 zero-result runs, the run stuck in
`running`, and the coverage-manifest figures.

**And it exposes something sharper.** Zero stored records carry `run_id`, yet 236 runs executed,
many on real contracts. So **no run's output is currently present in the database** — the only
records that exist are demo-path writes. Whether that is `clean_db.py` housekeeping, ephemeral test
contracts, or runs that stored nothing is undiagnosed, but it means the 171-contracts-with-runs vs
92-with-records gap is not a "46% of contracts store nothing" finding; it is an artifact of the same
provenance problem.

**Method lesson:** check the provenance of production data before drawing conclusions from it. A
populated collection on a live cluster is not evidence that the code you are auditing produced it.

### Phase 0 results — production, measured 2026-09-07 (read-only)

Against the live Atlas cluster from `apps/backend/.env`. 564 contracts with chunks, 39,210 chunks,
2,135 stored KPI records, 236 extraction runs.

**C4 is firing in production.** Of the 92 runs that carry an `extraction_method`:

| extraction_method | runs |
|---|---:|
| `hybrid_llm` | 81 |
| `deterministic_fallback` | **11 (12%)** |
| unset (pre-dating the field) | 144 |

Eleven runs where the LLM path returned nothing and the **entire contract** was extracted by regex —
all eleven carry an `llm_error`, none surfaced as a failure. Nine runs finished with `kpi_count: 0`.
One run is still `status: running` and never reached a terminal state (R1/R3: sync in the request,
no polling, a timeout orphans the run).

**The coverage manifest reports 46.7% of chunks unmapped** (mean over the 10 runs carrying coverage
data). Per H6 the manifest *over-credits* — it falls back to a `(section_path, page)` join that marks
every chunk on a page as mapped when any record cites that page — so the true unmapped share is
worse than 46.7%.

**`needs_review` is absent from all 2,135 records** — not at the top level, not under `governance`,
`quality`, `flex`, or `phase1`. The prompt asks the model to set it, the validator reasons about it,
and it is never persisted. The model's own uncertainty signal is being dropped on the floor, which
matters directly to the Phase 2 quarantine design: routing on validation failure alone would still
ignore every record the model itself flagged as uncertain.

**Production chunk mix confirms the redundancy, and adds a level the fixtures do not show:**

| Level | Chunks | Chars | Share |
|---|---:|---:|---:|
| meso | 12,567 | 19,549,719 | 38.4% |
| `voyage-chunk` | 7,535 | 13,078,838 | **25.7%** |
| macro | 6,137 | 11,197,659 | 22.0% |
| micro | 12,780 | 6,519,674 | 12.8% |
| unknown | 191 | 628,835 | 1.2% |
| **total** | **39,210** | **50,974,725** | ≈**2.61×** meso |

`voyage-chunk` is a fourth overlapping representation outside the segmenter's macro/meso/micro
taxonomy, and `_is_kpi_candidate` admits it (the only test is `len(text) >= 30`). Production
amplification is 2.61× against meso, matching the 2.68× measured on fixtures, and meso-only is a
**−61.6%** cut here — so the Phase 3 saving holds on real data.

**Output skew matches the IATA prompt bias (C3).** Of 2,135 records: `pricing_rate` 539,
`financial` 301, `conditional_charge` 294, `service_scope_reference` 196, `percentage_fee` 147,
`penalty` 147, `scheduling_target` 98, `payment_term` 98 — roughly 65% are money/rate-card types.
That is the shape of an aviation rate-card prompt applied to a general contract portfolio.

**Multi-tier consolidation effectively never fires.** 424 records carry a `target_schedule`, but
**zero** `kpi_sch_*` schedule records exist. `_consolidate_multi_tier_schedules` has not produced a
single record across 236 runs — which is why the C1 collision never fired in production, and is its
own signal about how rarely ladder rows are recognised as a cluster.

### Reliability posture today

| # | Finding | Evidence | Effect |
|---|---|---|---|
| R1 | Extraction runs **synchronously inside the HTTP request** | `api/routes/kpis.py:688-724` | 25–100 LLM calls in one request; nginx caps at `proxy_read_timeout 300s` (`nginx.conf:41`). A long contract times out client-side while the run continues server-side |
| R2 | **Destructive before verify** — drafts deleted *before* extraction | `kpi_manager.py:2364-2372` | A run that then fails leaves the contract with **zero** obligations. No transaction, no restore |
| R3 | No run-status endpoint | only `.../source-configs/{id}/fetch-runs/{run_id}` exists | `run_id` is returned but not pollable. A timed-out extraction is unrecoverable by the client |
| R4 | No retry/backoff, no rate-limit handling | `ThreadPoolExecutor(max_workers=6)` at `:4822`, `:4712` | 429s become `{}` becomes silent clause loss |
| R5 | Voyage rerank on the critical path | `:4472`, `timeout=5.0` | Costs a call and 5s; result discarded by the re-sort at `:4655` |
| R6 | Demo short-circuit still live | `kpis.py:712`, `worker/tasks.py:539` | The demo contract bypasses real extraction — "it works on the demo" proves nothing |
| R7 | `requests.Session()` with no adapter/retry config | `:243` | No connection-pool tuning, no backoff |

---

## 2. Targets

| Axis | Today | Target | Instrument |
|---|---|---|---|
| Accuracy — span coverage | unmeasured | ≥ 0.90 per family | `score_obligation_coverage.py` |
| Accuracy — grounding | unmeasurable (H4) | ≥ 0.98 | same, once `_validated_quote` stops substituting |
| Accuracy — silent loss | unknown | **0 lost clauses**, 8 fixtures × 3 runs | `ClauseLedger` |
| Cost — input tokens/contract | ~53k measured, est. 130–210k real | ≤ 60k *including* packs | run doc token counters |
| Cost — calls/contract | ~25 measured, est. 60–100 real | ≤ 30 | run doc |
| Correctness — model resolution | env fallback on the main endpoint | team settings honoured on every entry point | H2 / Phase 2.5 |
| Correctness — provider support | claude silently unsupported → regex fallback | every provider with a key is usable | H2b / Phase 2.5 |
| Reliability — completion | no SLO; sync request | ≥ 99% runs reach a terminal state | run doc status |
| Reliability — recoverability | drafts destroyed on failure | no run can leave a contract empty | Phase 1 gate |

---

## 3. Phases

Each phase lists its effect on all three axes and its gate. No phase starts before the previous
gate is green.

### Phase 0 — baseline (½ day)
Run the coverage scorer against a real extraction of all eight fixtures. Also take the **real**
token/call counts against one ingested contract to settle the 2.5–4× redundancy estimate.

- **Accuracy:** first honest coverage/grounding/anchor numbers.
- **Cost:** the real per-contract token number, currently unknown.
- **Reliability:** none.
- **Gate:** numbers written down and reproducible.

### Phase 1 — zero silent loss (1–2 days) · *the load-bearing phase*
`ClauseLedger` over `source_id` (`extracted | rejected | lost | pending`; `finalize()` turns
pending → lost). Stage-1 keeps the batch on a malformed success. `_invoke_kpi_llm` returns raw text
so truncation is distinguishable from non-JSON; truncation → split-and-retry instead of drop.
Ordered merge replacing first-wins `as_completed` — **demonstrated 2026-09-07, not theorised**: the
same fixture, same model and byte-identical cached responses store a *different quote* for
`KPI-1: On-Time Pickup Performance` depending on whether the run was cold (real API latency) or warm
(instant cache reads). Thread completion order decides which sibling wins consolidation; two warm
runs agree, a cold run disagrees with both. Fixture 06 was stable only because its consolidation had
no tie to break. Per-clause fallback, not per-run. Ledger counts
land on the run doc. Add exponential backoff with jitter on 429/5xx (R4). Stop deleting drafts
before the run succeeds — extract into a staging set, swap on success (R2).

- **Accuracy:** converts unknown loss into a counted number. No prompt change yet — deliberately,
  so Phase 2's effect is attributable.
- **Cost:** backoff replaces blind retries; split-and-retry costs tokens only where truncation
  actually happened. Net roughly flat.
- **Reliability:** R2 and R4 fixed. A failed run can no longer empty a contract.
- **Gate:** 0 clauses unaccounted for by the ledger across the fixtures × 3 runs; a forced 429
  storm loses nothing. Baseline to beat: **46.6% lost on fixture 01, 54.7% on fixture 06, 44.2% on the DPA**.
  Do **not** use span coverage as the loss gate — it held at ~97% on both while loss doubled.

### Phase 2 — ship the right prompt, enforce the schema (1–2 days)
Delete the dead `return` so `system_instructions` ships (C2). Remove
`_normalize_iata_ground_handling_record`, every `SEK` literal, the `electricity→power` hack, and
rewrite the Stage-1 prompt family-neutral (C3). Promote `validate_extraction_envelope` from log to
quarantine (H3). `_validated_quote` returns `None` and quarantines rather than substituting the
source clause (H4).

Two additions found on the second pass, both required for this phase to actually pay off:

**P2a — delete the omission instructions.** Both prompts currently instruct the model to drop
obligations. The live prompt: `Include only KPIs with confidence >= 0.80` (`:5048`) — the model
self-censors on its own uncertainty estimate. The 2.1 prompt about to ship: Rule 0
`QUALITY OVER QUANTITY ... far better to extract fewer` (`:4916`) — which **contradicts its own
Rule 3 zero-omission sweep** three rules later. For a recall system this is backwards. Extract
everything, stamp confidence on the record, filter in review — never in the extractor. Hours of
work; likely the cheapest recall gain available.

**P2b — contract-level pre-pass.** One cheap call over headings + the definitions article + the
liability/indemnity article, returning
`{parties, roles, currency, liability_regime, credit_cap, defined_terms}`. Resolved once per
contract, cached, injected into every batch. Without it Rule 4 ("identify the governing liability
regime **before** extracting financial-consequence records") and `contract_meta` are literally
unsatisfiable: the liability article and the credit clauses are in different batches, and ~21
batches each guess contract metadata independently. This is also the correct place to resolve
currency, which permanently closes the SEK class of bug.

- **Accuracy:** the largest single expected gain, and the first time grounding is measurable.
- **Cost:** the 2.1 prompt is longer than the legacy one; +200–400 tokens per batch.
- **Reliability:** quarantine gives a review queue instead of silently-wrong stored records.
- **Gate:** grounding ≥ 0.98; zero SEK/IATA/aviation strings in `kpi_manager.py`; neutrality tests green.

### Phase 2.5 — universal model settings and clients (1 day) · *ship as one change*
Independent of the prompt work and of the batching work; lands in a day. Split out because the two
halves are unsafe apart.

**A — honour the universal model settings; stop overriding them.** The model
is **not** pinned in the extraction path. It comes from the team's configured model settings, the
same universal setting the rest of the product uses. Three changes make that true:

1. Attach `apply_team_model_settings` (`api/routes/model_settings.py:35`) to the KPI router. Today
   it is on the agent router only (`api/routes/agent.py:66`), so the main extraction endpoint runs
   with no team settings published and silently falls back to `settings.model_name` — while the
   same extraction called through `agent.py:438` gets the team's model. Two entry points, two
   models (H2).
2. **Delete `_kpi_max_tokens`** (`:5112`). It passes an explicit `max_tokens`, and an explicit
   argument beats every team and global setting in `build_chat_model`'s resolution ladder
   (`model_factory.py:114-122`). Its `min(override or 8192, 8192)` also hard-caps groq so a team
   cannot raise it.
3. **Give extraction a much larger output cap — 2048 is not the number.** Removing the override
   alone would make it *worse*: extraction calls `build_chat_model(purpose="classify")`, and that
   profile sets `max_tokens: 512` (`model_factory.py:58`), which sits ahead of team settings in the
   ladder. Add a purpose profile `"extract"` with `max_tokens: None` so team and global settings
   flow through, plus a dedicated `extraction_max_tokens` fallback — **proposed default 16384** —
   consulted after the team override instead of the 2048 general default (`config.py:29`, H1).
   Clamp and log if a provider rejects the requested cap rather than failing the batch.

- **Accuracy:** ladders and tables stop being severed mid-structure; truncation drops.
- **Cost:** **the −60–75% input-token reduction that funds Phase 5.** A stronger Stage-2 model
  raises the rate; the volume cut should more than absorb it — verify, do not assume.
- **Reliability:** fewer calls, less 429 pressure, shorter runs.
**B — route everything through the universal LLM clients.**

1. **Stop forcing the provider.** `extract_for_contract` computes
   `provider = (ai_provider or self.ai_provider or "groq")` (`:2339`) and passes it explicitly, and
   an explicit `provider` argument beats the team override in the factory
   (`model_factory.py:93-99`). Pass `None` when the API caller did not name one, so the team's
   provider actually resolves. Keep the explicit path for a caller that deliberately names a
   provider in the request.
2. **Delete `_llm_provider_available`** (`:4865`). It hand-rolls key checks for groq / gemini /
   openai and returns `False` for **claude**, so a team on Claude fails the guard at `:4804`, gets
   `[]`, and falls through to `deterministic_fallback` (`:2402`) — the entire contract extracted by
   regex, logged at `info` level. Use `build_chat_model(..., optional=True) is not None`, or
   `model_settings.configured_providers()`.
3. **Voyage rerank.** P3's plan is to remove it from this path entirely (result is discarded at
   `:4655`). If it is kept for any reason, it must use the shared
   `contract_agent/rag/reranker.py:26 VoyageReranker`, not hand-rolled `requests` (`:4464`).
4. **Delete the dead raw-HTTP scaffolding** — `self.groq_headers`, `self.openai_headers`
   (`:248-249`, built with bearer tokens, referenced nowhere), the per-provider key attributes, and
   `self.http_session` once the Voyage call is gone.

> **A and B are one change, not two.** Publishing team settings on the KPI router while
> `_llm_provider_available` still excludes Claude would let a team select Claude and silently
> receive regex extraction — strictly worse than today.

- **Accuracy:** unblocks the team's chosen model reaching extraction at all. No prompt change.
- **Cost:** the team's model choice now governs spend — which is why D5 (a per-contract cost
  ceiling) becomes the control instead of a pinned model.
- **Reliability:** removes a silent-collapse path (Claude selected → regex extraction).
- **Gate:** every provider with a configured key passes the availability guard, asserted by a test;
  the same contract extracted via the KPI route and the agent route resolves the same model.

### Phase 3 — invert the batching axis (2–3 days) · *the cost phase, and the accuracy one*

**The core change (P3-0): batch on the output budget, not on input characters.**

`_batch_clause_records(char_budget=8000, max_records=10)` keys the batch on *input* size. 8,000
chars is ~2,000 tokens — roughly 1–2% of the context window of the configured model
(`openai/gpt-oss-120b`). Meanwhile the actual constraint is **output**: each record is a nested
four-phase object, and ten of them readily exceed the 2048/8192 output cap. The design therefore
rations the abundant resource in order to control the scarce one, and misses on both — the model
sees too little context *and* still truncates.

This single decision is what produces ~25 calls per contract, and it is why the fixture-01
`$3,000 / $7,500 per tenth` rate ladder is unrecoverable: the band table and its prose rate line
land in different 8,000-char batches, so no prompt can reconnect what the model never saw together.

Measured meso-only input sizes show how much headroom is being left unused:

| Fixture | meso chars | ≈ input tokens |
|---|---:|---:|
| 01 logistics | 19,227 | ~4,800 |
| 02 healthcare | 13,847 | ~3,500 |
| 05 transit | 18,431 | ~4,600 |
| 06 telecom | 73,416 | ~18,400 |
| 07 pharma | 64,801 | ~16,200 |

Five of the eight fit entirely in one call on input. The replacement design:

- give the model a large coherent slice — a whole article, or the whole contract when it fits — as
  **context**;
- ask it to extract only for a bounded **target region** inside that context;
- size the target region by expected output, so truncation is bounded by construction while the
  model still sees the surrounding table, the cap clause and the definitions.

Expected: **2–3 calls for a small contract, 5–10 for telecom**, against ~25 today, each seeing
10–30× more context. Lower again if D3 retires Stage-1.

Everything else in this phase is now a consequence of that change rather than a separate fix:
extract from **one** chunk level (D2: meso), never split a table or ladder (M1 — satisfied by
construction), stop double-emitting table rows (M2), general sentence-boundary split for oversized
blocks (M3), drop the Voyage rerank (R5).

**P3a — tables as structured rows.** `services/table_extraction.py:308 extract_tables()` exists and
the obligation path never imports it. Band tables are currently transcribed from markdown pipes by
the model. Route parsed rows into the record stream with their header context, keys and values
already resolved: the KPI-2 table's four per-tenth rates become four rows deterministically, and
the model loses its chance to collapse them.

**P3b — neighbour context.** Subsumed by P3-0. Kept as the fallback if the target-region design
proves impractical: include the preceding and following clause as read-only context so
table-plus-ladder adjacency survives a bad boundary.

- **Gate:** span coverage up vs Phase 0, grounding held, measured tokens/contract down ≥ 50%, and
  calls/contract down from ~25 to ≤ 10.

### Phase 3b — closed-loop span repair (2 days) · *the structural idea*
`score_obligation_coverage.py` computes uncovered quantitative spans deterministically. Today that
runs offline as a report. Move it **into** the pipeline:

```
extract → compute uncovered spans → for each, re-prompt ONLY the clause
containing it, with the span quoted back → merge → one repeat pass max
```

Recall stops depending on the model getting it right on the first attempt. Cost is bounded — a
re-prompt fires only where a span is genuinely uncovered, so a clean contract pays nothing.

- **Accuracy:** converts the miss list from a CI finding into a self-healing run. Expected to be the
  largest gain after Phase 2.
- **Cost:** bounded and proportional to the miss rate; falls as the other phases land.
- **Reliability:** repair attempts are counted on the run doc, so a rising repair rate is an early
  warning of a prompt or model regression.
- **Gate:** uncovered-span count after repair < half the count before it, grounding unchanged.

### Phase 4 — deterministic post-processing (1–2 days)
Contract-scope the schedule `kpi_id` (C1 — one-line seed change plus a backfill for already-collided
records). Stop re-collapsing ladder rows (H5). Run consolidation once, not three times. Fix the
coverage-manifest join to use `source_id` on both sides (H6). Retire or reimplement
`kpi_candidate_recall` in `final_evaluation/scoring/layers.py:497` (H7). Remove the demo
short-circuit or gate it behind an explicit flag (R6). Delete dead `_consolidate_kpis_with_llm`.

- **Accuracy:** stops post-processing from undoing Rule 1; the manifest stops over-crediting.
- **Cost:** one consolidation pass instead of three (CPU, not tokens).
- **Reliability:** **C1 is the live data-loss bug** — cross-contract overwrite via a globally unique
  `kpi_id` index.
- **Gate:** two contracts with same-titled schedules extract without collision; ladder row count
  preserved end-to-end.

### Phase 5 — packs (3–5 days, one family at a time)
Loader, renderer, budget, classifier, `_base`. Then `logistics_msa` → `data_processing_agreement` →
the remaining six. Content, authoring method and ablation protocol in
`docs/plans/obligation-pack-authoring.md`.

- **Accuracy:** the qualitative/zero-number duties span coverage cannot see, plus family-specific
  scatter patterns.
- **Cost:** **the spending phase.** ~1,800 tokens × every batch. Only affordable on Phase 3's
  savings. Cache per contract, cap the budget, truncate `examples.md` first.
- **Reliability:** a misclassified family must degrade to `_base`, never guess. Below the
  confidence floor, flag the run.
- **Gate:** every family at or above its `coverage.yaml` floors; each pack has an `ablation.json`
  showing it moved a number without dropping grounding.

### Phase 6 — make the run operable (1–2 days, can run parallel to 3–5)
Move extraction off the request path into the existing worker; return `run_id` immediately and add
`GET /extraction-runs/{run_id}` (R1, R3). Emit per-run counters — calls, input/output tokens, cost,
lost, quarantined, duration — onto the run doc. Configure `requests.Session` with a retry adapter
(R7). Alert on `lost > 0` and on quarantine rate.

- **Accuracy:** none directly; makes regressions visible in production rather than only in CI.
- **Cost:** per-run cost becomes an observable number instead of an estimate.
- **Reliability:** removes the 300s timeout cliff; runs become resumable and auditable.
- **Gate:** a 60k-char contract extracts without an HTTP timeout; run doc carries token and cost counters.

---

## 3b. Considered, deferred

Real gains, deliberately not scheduled — revisit after Phase 5 measures where the remaining loss is.

- **Semantic grounding verifier.** `_validated_quote` checks string containment only. A cheap second
  pass asking *does this quote actually support this claim?* catches a real quote attached to a
  misread record.
- **Cross-record invariants (deterministic, no LLM).** Every credit record references the cap when
  one exists · a KPI with an N-row band table yields N tier records · every reporting duty carries a
  deadline · no record cites a `source_id` outside its own batch.
- **Extraction-specific chunk view.** Current chunking is built for embedding. Extraction wants
  legal structure — article → section → clause → sub-bullet → table, never split mid-table. Only
  worth building if Phase 3's structure-aware batching proves insufficient.
- **Semi-gold qualitative set.** Span coverage cannot see *"maintain ISO 27001"* or the accessorial
  evidence rule. Strong-model candidate duty lists over the 8 fixtures, human-reviewed once
  (~200 items, ~1 day) → a permanent asset covering the half the scorer is blind to.
- **Two-pass inventory-then-deepen.** Cheap pass emits pointers only (*"§4.02 contains a target, a
  5-row band table, two per-unit rates, a CAP trigger"*); second pass extracts each with its
  neighbourhood. Overlaps heavily with Phase 3b — do that first and re-measure before building this.

**Explicitly out of scope (decision, 2026-09-07):** the human-in-the-loop review flywheel — routing
quarantined records to reviewers and feeding corrections back into pack examples and a regression
corpus. Not part of this workstream. Quarantine still *stores* the records (Phase 2); what happens
to them afterwards is someone else's plan.

## Not worth doing

- **Redesigning retrieval.** Already a full scan, no top-k, nothing dropped for relevance. Zero gain.
- **Ensemble / self-consistency across the board.** 3× cost for marginal gain. Reserve for clauses
  still carrying uncovered spans after Phase 3c.
- **Fine-tuning.** No labels, no baseline, and until P2a lands the prompt instructs the model to omit
  records. Premature by a wide margin.
- **More prompt rules.** The prompt already contradicts itself (Rule 0 vs Rule 3). Rules are not the
  constraint; context and structure are.

## 4. Decisions needed from you

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | ~~Stage-2 model~~ **Settled 2026-09-07** | — | **No pinning.** Provider and model come from the universal team model settings; the work is wiring the KPI router to them (Phase 2.5). Open sub-question: whether Stage-1's binary yes/no should use the existing `light` purpose (cheap model, deliberately not team-overridable) while Stage-2 uses the team's full-size model |
| D1b | Extraction output cap | 8192 · **16384** · team-set only | **16384 as the fallback**, team override wins. Must be raised off 2048 (H1) and must not inherit the `classify` profile's 512 |
| D2 | One chunk level or many | micro-only · meso-only · meso + table micros | **meso + table micros.** Meso holds whole clauses (ladders survive); table micros keep row granularity |
| D3 | Keep Stage-1 at all | keep two passes · merge into one | Keep for now — decide with Phase 0 data on how much Stage-1 actually rejects. If it rejects <20%, it is 40% of the calls for little gain |
| D4 | Pull C1 forward | wait for Phase 4 · land now | **Land now.** Small fix, live cross-contract data loss |
| D5 | Cost ceiling per contract | — | Set one before Phase 5. Packs will consume whatever budget exists otherwise |

---

## 5. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Phase 3 cuts a chunk level and loses clauses that only appeared at that level | Medium | Ledger from Phase 1 makes it visible immediately; A/B per level on the fixtures |
| A team's configured model is far more expensive than the old env default, erasing Phase 3's savings | Medium | D5 cost ceiling; measure tokens *and* money per phase. The model is the team's choice now, so the ceiling is the control, not a pinned model |
| A provider rejects the 16384 output cap | Low–Medium | Clamp to the provider's maximum and log; never fail the batch on it |
| Phase 2.5 half-landed — team picks Claude, gets regex extraction | Medium | A and B ship as one change; test asserts every provider with a key passes the availability guard |
| Packs raise record count while lowering grounding | Medium | Ablation gate — grounding is the guard, coverage alone would score it a win |
| Classifier picks the wrong family confidently | Low–Medium | Confidence floor → `_base` only + flagged run; manual override outranks classifier |
| C1 backfill mis-attributes already-collided records | Low | Records carry `contract_id` in the body; reconcile against it before rewriting ids |

---

## 6. Sequencing

```
now ──► D4: land C1 alone (hours)
        │
        Phase 0  baseline                    (½d)
           │
        Phase 1  zero silent loss            (1-2d)   ← the instrument
           │
        Phase 2  prompt + schema             (1-2d)   P2a omission instructions
           │                                          P2b contract-level pre-pass
        Phase 2.5 model settings + clients   (1d)     ships as one change
           │
        Phase 3  re-cut the unit of work     (2-3d)   P3a tables, P3b neighbour context
           │                                          ← the cost phase, funds Phase 5
        Phase 3b closed-loop span repair     (2d)
           │
        Phase 4  deterministic post-proc     (1-2d)
                                                                    │
                                         Phase 5 packs (3-5d, per family)

        Phase 6 operability (1-2d) ── parallel from Phase 3 onward
```

≈ **14–19 working days** to all gates green, plus per-family pack work after.

The ordering is not preference. Phase 1 before Phase 2 because you cannot attribute a prompt's
effect while batches are silently vanishing. Phase 3 before Phase 5 because packs cost more than
the entire current token budget. Phase 0 before everything because every gate is stated relative to
a baseline that does not exist yet.
