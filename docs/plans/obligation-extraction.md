# Obligation extraction — verified state and the design to max it out

Date 2026-09-07 · Branch `chore/ingestion-branch-cleanup`
Supersedes everything in `docs/plans/archive/` — those documents contain findings that were later
disproved and are kept only for the audit trail.

**Rule for this document: nothing appears here unless it was verified end-to-end.** Eight separate
claims were disproved during the investigation that produced it — static proxies, keyword probes,
namespace mix-ups, and analysis of production data that turned out to be demo output. What follows
is only what survived.

---

## 1. What is actually true

### Extraction is better than it looks from the code

Real pipeline, three fixtures, `openai/gpt-oss-120b`, in-memory harness, nothing written to a
database:

| Fixture | Records | Span coverage | Grounding | Anchor recall |
|---|---:|---:|---:|---:|
| 01 logistics (18k) | 74 | 97.9% | 100% | **100%** (8/8) |
| 06 telecom (62k) | 68 | 97.2% | 98.5% | 6/7 — 7th anchor is faulty |
| 02 healthcare DPA (14k) | 70 | 86.2% | 100% | **100%** (8/8) |

Rate ladders are captured *and structured* — tier, range, `penalty_per_tenth`, reference threshold.
Field population runs 84–100%. All 23 valid must-find anchors from `manifest.json` are extracted.

### The one large confirmed defect: silent omission

Every record cites the `source_id` of the clause it came from, so clauses that were accepted by the
Stage-1 screen and then produced nothing can be counted exactly:

| Fixture | Accepted | Extracted | Lost | Cause |
|---|---:|---:|---:|---|
| 01 | 133 | 71 | 62 (46.6%) | 59 omitted-in-answered-batch, 3 empty response |
| 06 | 170 | 77 | 93 (54.7%) | 93 omitted-in-answered-batch |
| 02 | 95 | 53 | 42 (44.2%) | 32 omitted-in-answered-batch, 10 empty response |

**93% of all loss is the model silently skipping clauses inside a batch it answered successfully.**
The call succeeded, the JSON parsed, rows came back — and most clauses simply got no row. Not
truncation, not parse failures, not rate limits.

Redundancy currently masks much of the damage: the same content exists at several chunk levels, so a
clause skipped in one copy is often captured in another. That is luck, not design.

### Chunk redundancy is load-bearing, not waste

Candidate text is **2.68×** the document (macro 40.2%, meso 39.7%, micro 20.1%). The obvious cost
saving — read one level — was tested end-to-end and **fails**:

| Run | Records | Span coverage |
|---|---:|---:|
| all levels | 74 | **97.9%** |
| meso only | 49 | **67.4%** |

`micro` segments are narrow value-centred windows; inside a 1,200–3,000 char `meso` chunk the model
passes over values it extracts when handed them focused. The redundancy buys ~30 points of coverage.
**Do not cull chunk levels to save tokens.**

### Reliability defects, from real extraction runs

`contract_kpi_extraction_runs` is written by `extract_for_contract` and is mostly real work (only 49
of 236 runs are demo-named):

- **12% of runs (11 of 92 tagged) fell to `deterministic_fallback`** — the entire contract extracted
  by regex, logged at `info`, reported as `completed`.
- 9 runs finished with `kpi_count: 0`; one run never reached a terminal state.
- No run's output is present in the database at all — 236 runs, zero records carrying a `run_id`.
  Undiagnosed.

### Nothing measures correctness

Coverage, grounding and anchors all test *presence*. **No record's party, threshold, operator or
consequence has ever been verified.** A record can quote real text, be perfectly grounded, satisfy
every anchor, and still bind the wrong threshold to the wrong party.

### The production KPI collection is demo data

All 2,135 records carry `last_demo_extraction_run_id` and none carry `run_id`,
`ai_extraction_provider` or `extraction_method`. Every high-count contract is `BaltiaGHAContract`.
Draw no conclusions about the pipeline from it.

---

## 2. What should be fixed, ranked by evidence

| # | Defect | Evidence | Severity |
|---|---|---|---|
| 1 | Model silently omits clauses inside answered batches | 93% of all loss, 3 fixtures | **Critical** |
| 2 | Whole-contract regex fallback on LLM failure | 12% of real runs | **Critical** |
| 3 | No correctness measurement exists | verified absent | **Critical** |
| 4 | `validate_extraction_envelope` errors are logged, not enforced | code | High |
| 5 | `_validated_quote` substitutes the whole clause when the quote is not found | code | High |
| 6 | Drafts deleted *before* extraction runs | code | High |
| 7 | Extraction runs synchronously in the HTTP request; no run-status endpoint | code, nginx 300s | High |
| 8 | Live prompt instructs the model to omit records (`confidence >= 0.80`, Rule 0) | code | High |
| 9 | The obligation-first 2.1 prompt is built and discarded | code | Medium |
| 10 | Demo short-circuit live on the extraction route | code | Medium |
| 11 | Hardcoded IATA framing, SEK defaults, `electricity→power` merge hack | code | Medium |
| 12 | ~2.68× redundant candidate text, and it cannot simply be culled | measured | Medium |

**Already fixed this session:** cross-contract schedule id collision; timing-dependent record
selection (ordered merge); clause-level loss accounting (`ClauseLedger`); anchor scorer
numeral/word matching.

---

## 3. The design

Six properties. Each one turns a class of silent failure into something that is either impossible or
loudly visible.

### P1 — Completeness is contractual, not hoped for

The model must return a verdict for **every** `source_id` it is given: a record, or an explicit
`no_obligation` with a reason. A missing id becomes a schema violation the validator rejects, not an
absence nothing can see.

The extractor then re-prompts **only the unaccounted subset**, once. Cost is proportional to the
gap, so a clean batch pays nothing.

*Fixes #1. Makes #4 meaningful.*

### P2 — Every clause is accounted for, always

`ClauseLedger` (landed) records each clause as `extracted`, `rejected` or `lost`, with a reason, and
stamps the tally on the run document. Silence can no longer read as success.

**Gate: `lost == 0`.** Not span coverage — coverage held near 97% on fixtures losing half their
clause instances, so it cannot detect loss.

### P3 — Failure is loud, partial and reversible

- Never replace a good extraction with a worse one: extract into a staging set, swap on success.
  Drafts are never deleted before there is something to replace them with. *(#6)*
- Fallback is **per clause**, never per contract. A regex result for one clause is a labelled
  degradation; a regex result for a whole contract is an outage disguised as a success. *(#2)*
- Schema violations **quarantine** the record for review instead of storing it silently. *(#4)*
- A quote that is not verbatim in its source quarantines the record. It is never replaced with the
  source text, which is what makes hallucination undetectable today. *(#5)*

### P4 — Deterministic by construction

Same input, same output. Merge in submission order (landed), consolidate once rather than three
times, and break every tie on a stable key rather than on thread completion order.

This is a prerequisite for the whole plan: without it, no before/after comparison means anything.

### P5 — Provenance on every record

Stamp `run_id`, `model`, `prompt_version`, `contract_family`, `pack_id`, `pack_version`,
`extraction_method` on each record. Fields already exist in `kpi_schema.py:705` and are unpopulated.

This is what makes the system future-proof rather than merely fixed: when quality moves, you can
attribute it to a prompt, a model, or a pack version instead of guessing. It is also what would have
prevented this session's largest error — an entire analysis built on demo records that carried no
provenance to distinguish them.

### P6 — Correctness is measured, not assumed

Three tiers, cheapest first:

1. **Anchors** (exists, 60 values) — a must-find floor. Audit them first: one is provably wrong.
2. **Label one fixture** (~40–60 obligations with party, threshold, operator, consequence). A few
   hours. Converts the vocabulary from coverage to **precision and recall**, and is the only way to
   detect a confidently wrong record. *(#3)*
3. **Closed-loop repair** — uncovered spans and unmet anchors re-prompt their own clause. The
   offline metric becomes a runtime self-heal.

Context packs (`docs/plans/obligation-pack-authoring.md`) sit on top of this, not before it: a pack
is only creditable when P2 and P6 can show it moved a number.

---

## 3b. P6 result — what labelled correctness changed

68 obligations were labelled by hand for fixture 01 (party, operator, threshold, unit, verbatim
anchor), and `score_obligation_correctness.py` turns them into precision and recall. That
immediately settled a question no other metric could see.

**Three variants of the completeness contract, same 68 labels:**

| Metric | Pre-P1 | Prompt rule + retry | **Retry only (shipped)** |
|---|---:|---:|---:|
| Records | 74 | 88 | 71 |
| Recall | 83.8% | 92.6% | **89.7%** |
| Precision | 59.5% | 51.1% | **67.6%** |
| Party accuracy | 82.5% | 87.3% | **86.9%** |
| Threshold accuracy | 84.6% | **64.8%** | **89.1%** |
| Clause loss | 62 | 8 | 39 |
| Anchor recall | 100% | 100% | 100% |

**The finding: forcing completeness *in the prompt* trades record quality for coverage.** With the
rule in the prompt, threshold accuracy fell **83.7% → 67.3% on the identical 49 obligations both
runs matched** — a global regression on records the extractor was already getting right, not weak
new additions. The model, told it must answer for every clause, emitted renamed near-duplicates that
bound no values (three records for one termination clause), and bound fewer numbers everywhere else.

Telling it to decline more often made it worse (83 → 95 records). A deterministic duplicate-quote
collapse recovered some precision but moved threshold accuracy not at all.

**What ships: the retry in code, no rule in the prompt.** The retry re-asks only about clauses that
received no answer, so it cannot change how the model treats clauses it did answer. That keeps most
of the recall gain (+5.9 points over baseline) and *improves* every other correctness axis —
precision +8.1, threshold +4.5, party +4.4.

**Accepted cost:** clause loss lands at 39 of 134 rather than 0. Those clauses are *counted and
attributed* by the ledger rather than silently vanishing, which is what P2 exists for. A visible,
measured 29% loss with correct records beats a 0% loss made of records that bind the wrong numbers.

**The general lesson, now evidenced twice:** a prompt instruction is not a contract. Enforce
invariants in code, and use the prompt to describe the task rather than to police it.

## 4. Sequence

| Step | Work | Gate |
|---|---|---|
| 1 | P1 completeness contract | `lost` falls sharply on all 3 fixtures |
| 2 | P3 staging swap + per-clause fallback + quarantine | no run can empty a contract; regex is per clause |
| 3 | P6 tier 2 — label fixture 01 | precision/recall exist |
| 4 | #8 remove omission instructions, #9 ship the obligation prompt | measured against step 3 |
| 5 | P5 provenance stamping | every record attributable |
| 6 | #7 async runs, run-status endpoint, ledger metrics | no HTTP timeout; loss visible in production |
| 7 | #10, #11 remove demo short-circuit and domain hardcodes | neutrality tests green |
| 8 | Packs, one family at a time | each pack shows a measured gain |

Steps 1–2 address 93% of measured loss and the 12% fallback. Step 3 is what makes every later step
verifiable. Nothing after step 3 should be judged on span coverage alone.

## 5. Working rules earned the hard way

- **Verify by running the pipeline, not by measuring the corpus.** A static proxy can be correct
  about what it measures and still mispredict behaviour — that is how meso-only looked free.
- **Check data provenance before analysing it.** A populated collection on a live cluster is not
  evidence that the code under audit produced it.
- **Cache LLM responses.** Re-scoring must be free, or the number gets quoted instead of re-checked.
- **One change at a time, measured.** Three of the fixes originally queued for a single batch turned
  out to target defects that did not exist.
