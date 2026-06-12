# ContractSense Executive Evaluation Report

Date: 2026-06-11

## Executive Verdict

ContractSense is showing real end-agent capability, especially on CUAD full-contract workflows, but the current benchmark results are not pitch-ready. The product completed all recent runs without API errors or timeouts, and it reliably protected source contracts and blocked forbidden external/source-mutation tools. However, the final evaluation still fails the pitch thresholds because evidence grounding, citation quality, KPI extraction, table-review grounding, and approval/security workflow behavior are not yet consistent enough.

The strongest observed run was CUAD with Gemini, scoring `0.8427`, but even that did not reach the required `0.90` overall score and still failed key hard gates. The official provider policy currently treats Groq as the pitch-ready provider, and the Groq results remain below threshold on both CUAD and ACORD.

## Evaluation Scope

The latest comparison used:

- 3 CUAD contracts and 3 ACORD contracts.
- Real ContractSense product APIs only.
- Real end agent only; no direct component/retriever/chunker calls.
- Balanced smoke profile for owner review.
- Saved raw responses, scorecards, KPI reports, table-review reports, and failure taxonomies.
- Groq as the official provider basis.
- Gemini `gemini-3.1-flash-lite` as a comparison provider.

## Scorecard

| Dataset | Provider | Official Basis | Contracts | Overall | PAC-1 | RAG | Tools | API Errors | p95 Latency | Pitch Ready |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ACORD | Groq | Yes | 3 | `0.6499` | `0.5417` | `0.5645` | `0.8759` | `0.0` | `44.8s` | No |
| CUAD | Groq | Yes | 3 | `0.8002` | `0.8345` | `0.6834` | `0.8966` | `0.0` | `54.1s` | No |
| ACORD | Gemini | Comparison | 3 | `0.7101` | `0.7083` | `0.5527` | `0.8960` | `0.0` | `58.8s` | No |
| CUAD | Gemini | Comparison | 3 | `0.8427` | `0.8524` | `0.8165` | `0.8619` | `0.0` | `45.9s` | No |

## What Is Working

1. API/runtime stability was good in the clean runs.
   - All four 3-contract runs had `0.0` API error rate.
   - All four had `0.0` timeout rate.

2. Source contract safety is strong.
   - `source_contract_immutability = 1.0` across the runs.
   - `forbidden_tool_block_rate = 1.0` across the runs.

3. CUAD full-contract performance is materially stronger than ACORD.
   - CUAD Groq scored `0.8002`; ACORD Groq scored `0.6499`.
   - CUAD Gemini scored `0.8427`; ACORD Gemini scored `0.7101`.

4. Gemini improved some CUAD grounding metrics.
   - CUAD Gemini citation precision reached `0.8625`, close to the `0.90` threshold.
   - CUAD Gemini gold span recall reached `0.8381`, close to the `0.85` threshold.
   - CUAD Gemini table cell accuracy reached `1.0`.

## Primary Bottlenecks

### 1. Citation And Evidence Grounding

This is the largest cross-cutting blocker.

Observed failures:

- ACORD citation precision was `0.0` for both Groq and Gemini.
- CUAD Groq citation precision was `0.5`, below the `0.90` threshold.
- CUAD Gemini citation precision improved to `0.8625`, but still missed `0.90`.
- Missing or invalid citations appeared repeatedly in failure taxonomies.

Business impact:

ContractSense cannot be positioned as a trusted legal/procurement evidence system until every material claim is backed by a valid citation to the correct document region. This directly affects buyer confidence.

Required fix:

- Treat citations as a product contract, not model prose.
- Require every answer claim to reference structured evidence IDs returned by retrieval.
- Block or downgrade answers when citations are missing or do not overlap the retrieved/gold span.
- Preserve document ID, segment ID, page, section, snippet, and score through the agent response.

### 2. ACORD Clause Retrieval Is Weak

ACORD is currently the weakest dataset basis.

Observed failures:

- ACORD Groq gold span recall: `0.3333`.
- ACORD Gemini gold span recall: `0.3333`.
- ACORD clause presence accuracy: `0.3333` for both providers.
- ACORD relevant clause recall: `0.3333` for both providers.

Business impact:

ACORD-style clause bank evaluation should be a strong test of focused clause retrieval. Current results suggest the system often does not retrieve or cite the right clause even when the task is narrow.

Required fix:

- Improve ACORD normalization and indexing so each clause has stable title/category metadata.
- Add metadata-aware retrieval for clause family, agreement type, clause title, and source record.
- Ensure retrieval is hard-scoped to the selected ACORD record.
- Add retrieval diagnostics showing top-k evidence before final agent answer.

### 3. KPI Extraction Is Not Ready For The Prime Use Case

KPI management is the prime business need, and it is not yet passing.

Observed failures:

- CUAD Groq `kpi_field_f1 = 0.75`, below the `0.85` threshold.
- CUAD Gemini `kpi_field_f1 = 0.0`.
- KPI citation precision was `0.0` in both CUAD Groq and CUAD Gemini.

Business impact:

Even when the agent can discuss a contract, the KPI workflow must turn contract language into reliable tracked obligations, dates, notices, SLAs, payment windows, audit rights, cure periods, and remedies. The current KPI layer is not evidence-backed enough for owners to sell as a workflow system.

Required fix:

- Build a dedicated KPI extraction path that outputs structured fields plus citations.
- Enforce schema fields such as obligation, owner/party, trigger, due date/window, frequency, metric, remedy, exception, and evidence ID.
- Reject KPI candidates without cited evidence.
- Score KPI extraction before artifact/table generation so weak evidence does not propagate.

### 4. Table Reviews Need Better Grounding

Table workflows are close in shape but weak in evidence traceability.

Observed failures:

- CUAD Gemini table cell accuracy reached `1.0`, but row citation precision was `0.0`.
- CUAD Groq table cell accuracy was `0.6667`.
- ACORD Groq table cell accuracy was `0.0`.
- ACORD Gemini table cell accuracy was `0.6667`.
- Row citation precision was `0.0` where reported.

Business impact:

Tables are reusable legal/procurement artifacts. They need correct cells and row-level citations. Without row citations, users cannot audit or trust the table.

Required fix:

- Require every generated row to carry evidence IDs.
- Validate table rows against retrieved spans before returning the artifact.
- Separate "proposed schema" from "filled table" and score both.
- Ensure approval-gated table creation produces an approval request every time.

### 5. Approval And Security Behavior Is Incomplete

The product protects source contracts, but approval/refusal behavior is not fully consistent.

Observed failures:

- CUAD Groq had `expected_refusal_missing = 3`.
- ACORD Groq had `expected_refusal_missing = 2`.
- ACORD Gemini still had `approval_request_missing = 1`.
- CUAD Groq had `approval_request_missing = 1`.

Business impact:

Workflow automation is a buying point only if risky actions are predictably approval-gated and unsafe requests are refused. Inconsistent approval/refusal behavior creates governance risk.

Required fix:

- Centralize approval policy outside model discretion.
- Make approval requirements deterministic by tool category.
- Add a refusal policy wrapper for external sends, source-contract mutation, and unsupported actions.
- Return explicit approval-request objects for all approval-required workflows.

### 6. Repeat Reliability Is Far Below The Pitch Threshold

Observed failures:

- ACORD Groq `pass^k = 0.0476`.
- CUAD Groq `pass^k = 0.1905`.
- ACORD Gemini `pass^k = 0.1429`.
- CUAD Gemini `pass^k = 0.4286`.
- Required threshold is `0.85`.

Business impact:

One good answer is not enough for enterprise trust. Buyers need the agent to repeat good behavior reliably across similar contracts and prompts.

Required fix:

- Reduce model discretion in evidence selection.
- Add deterministic post-checks for citations, approval gates, refusal conditions, and output schemas.
- Make failed citation/tool checks trigger repair or safe refusal before returning to the user.

### 7. Latency Is High

Observed p95 latency:

- ACORD Groq: `44.8s`.
- CUAD Groq: `54.1s`.
- ACORD Gemini: `58.8s`.
- CUAD Gemini: `45.9s`.

Business impact:

The latency may be tolerable for deep contract analysis, but it is high for interactive chat, table review iteration, or sales demos.

Required fix:

- Cache document outlines and retrieval results.
- Reduce repeated tool calls.
- Stream intermediate status clearly.
- Add fast paths for narrow clause/table/KPI questions.

## Provider Comparison

Gemini outperformed Groq on this 3+3 sample:

- ACORD: Gemini `0.7101` vs Groq `0.6499`.
- CUAD: Gemini `0.8427` vs Groq `0.8002`.

However, Gemini is currently a comparison run, not the official pitch basis. If ContractSense wants to use Gemini in the pitch, the evaluation policy should be updated explicitly and rerun at larger scale. If Groq remains the required official provider, the Groq agent path needs targeted improvements before publication.

## Go / No-Go

Current recommendation: No-go for an external "final proof" pitch claim.

Recommended internal message:

ContractSense has credible product foundations: end-agent execution works, API stability is good, forbidden actions are blocked, and CUAD workflows show meaningful progress. But the system is not yet reliable enough to publish as a pitch-grade benchmark. The next milestone should be a focused reliability sprint on citations, KPI extraction, table grounding, ACORD retrieval, and approval/refusal determinism.

## Priority Fix Plan

### P0: Evidence And Citation Contract

- Make citations mandatory for all material claims.
- Carry structured evidence IDs through search, read, answer, KPI, table, and artifact workflows.
- Add a deterministic citation validator before final answer emission.

### P0: KPI Extraction Reliability

- Build KPI extraction around structured evidence-backed fields.
- Require citation-backed KPI rows.
- Fail closed when a KPI candidate lacks evidence.

### P1: Table Review Grounding

- Require row-level citations.
- Validate table cells against source snippets.
- Ensure table proposal/create/generate paths produce approval requests when required.

### P1: ACORD Retrieval

- Improve clause-bank ingestion and metadata.
- Add clause-family/title-aware retrieval.
- Hard-scope every ACORD query to the selected record.

### P1: Approval And Refusal Policy

- Move approval/refusal gating into deterministic policy code.
- Ensure forbidden tools and unsupported actions produce explicit denials.
- Require approval objects for all approval-required tools.

### P2: Latency

- Cache outlines and retrieval.
- Add narrower retrieval/query planning.
- Report latency visibly in future owner-facing summaries.

## Next Evaluation Gate

Do not scale to a full 25/50/100-contract owner run until the following are true on a 3 CUAD + 3 ACORD shakedown:

- Overall score at least `0.85`.
- Citation precision at least `0.90`.
- Gold span recall at least `0.85`.
- KPI field F1 at least `0.85`.
- KPI citation precision at least `0.90`.
- Table cell accuracy at least `0.85`.
- Row citation precision at least `0.90`.
- Approval-required action rate equals `1.0`.
- Forbidden tool block rate equals `1.0`.
- Source contract immutability equals `1.0`.

Only after that should ContractSense run the official 10-contract benchmark and then scale to 25, 50, and 100 contracts.
