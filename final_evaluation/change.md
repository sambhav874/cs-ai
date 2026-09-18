# ContractSense Final Evaluation Change Log

## Purpose

This folder contains a new independent final evaluation suite. It is intentionally separate from existing repository evals, tests, fixtures, scorers, and benchmark reports.

## Non-Negotiables

- Real end-agent only through product-level APIs.
- Groq provider for official runs.
- CUAD contracts/annotations and ACORD clause-retrieval qrels as supported gold sources.
- Default size: 10 contracts. Supported scale: 25, 50, 100.
- Three layers only: PAC-1 inspired reliability, RAG quality, tools-based workflows.
- KPI extraction, table reviews, and every ContractSense tool category are evaluated.

## Implementation Log

- Created `final_evaluation/` structure.
- Added default configuration in `config/eval_config.yaml`.
- Added standalone schemas, scorers, report generation, CUAD preparation, and end-agent runner.
- Added ACORD preparation and ACORD-specific retrieval cases using BEIR `corpus.jsonl`, `queries.jsonl`, and `qrels/*.tsv`.
- Added direct GitHub fetch support for `TheAtticusProject/cuad` and `TheAtticusProject/acord`.

## Commands

Prepare CUAD manifest:

```bash
python3 final_evaluation/scripts/prepare_cuad.py \
  --fetch-github \
  --output final_evaluation/datasets/cuad_manifest.jsonl \
  --contract-count 10
```

Prepare ACORD manifest from GitHub:

```bash
python3 final_evaluation/scripts/prepare_acord.py \
  --fetch-github \
  --output final_evaluation/datasets/acord_manifest.jsonl \
  --contract-count 10
```

Prepare ACORD manifest from downloaded zip:

```bash
python3 final_evaluation/scripts/prepare_acord.py \
  --acord-zip "/path/to/ACORD Dataset & ReadMe.zip" \
  --output final_evaluation/datasets/acord_manifest.jsonl \
  --contract-count 10
```

Run a dry-run plan/report without calling the API:

```bash
python3 final_evaluation/scripts/run_final_eval.py --dry-run
```

Run against a live ContractSense API:

```bash
CONTRACTSENSE_FINAL_EVAL_AUTH_TOKEN=<token> \
python3 final_evaluation/scripts/run_final_eval.py \
  --dataset cuad \
  --api-base-url http://127.0.0.1:8000/api/v1 \
  --contract-count 10
```

Run against ACORD:

```bash
CONTRACTSENSE_FINAL_EVAL_AUTH_TOKEN=<token> \
python3 final_evaluation/scripts/run_final_eval.py \
  --dataset acord \
  --api-base-url http://127.0.0.1:8000/api/v1 \
  --contract-count 10 \
  --output-dir final_evaluation/reports/acord
```

## Results

- GitHub fetch completed for `TheAtticusProject/cuad`; wrote 10 CUAD manifest rows to `final_evaluation/datasets/cuad_manifest.jsonl`.
- GitHub fetch completed for `TheAtticusProject/acord`; wrote 10 ACORD manifest rows to `final_evaluation/datasets/acord_manifest.jsonl`.
- Live one-contract/one-query shakedowns have been recorded for CUAD and ACORD. Full 10-document runs are blocked by missing citations/tool execution in the global end-agent path.

## Blockers

- CUAD and ACORD source files are not committed in this repository; run the prep scripts with `--fetch-github` or local dataset paths.
- Live runs require a ContractSense backend, authentication token, credits/ingestion capacity, and Groq API configuration.

## Verification Run dry-run-final-shakedown
- Timestamp UTC: 2026-06-07T19:12:00.313250+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --max-cases-per-layer 2 --run-id dry-run-final-shakedown --output-dir final_evaluation/reports/dry_run_shakedown`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `final_evaluation/reports/dry_run_shakedown`
- Overall score: `0.9007`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1003.0`

## Verification Run dry-run-acord-shakedown-final
- Timestamp UTC: 2026-06-07T20:01:29.445573+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset acord --dry-run --max-cases-per-layer 2 --run-id dry-run-acord-shakedown-final --output-dir final_evaluation/reports/acord_dry_run_shakedown`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `final_evaluation/reports/acord_dry_run_shakedown`
- Overall score: `0.8998`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1003.0`

## Run live-cuad-shakedown-1
- Timestamp UTC: 2026-06-07T21:20:59.634012+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset cuad --contract-count 1 --max-cases-per-layer 1 --keep-fixtures --run-id live-cuad-shakedown-1 --output-dir final_evaluation/reports/cuad_live_shakedown`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `final_evaluation/reports/cuad_live_shakedown`
- Overall score: `0.6595`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `10838.0`

## Run live-acord-shakedown-1
- Timestamp UTC: 2026-06-07T21:25:30.758987+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset acord --contract-count 1 --max-cases-per-layer 1 --keep-fixtures --run-id live-acord-shakedown-1 --output-dir final_evaluation/reports/acord_live_shakedown`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `final_evaluation/reports/acord_live_shakedown`
- Overall score: `0.6589`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `11949.0`

## Owner Approval Package
- Timestamp local: 2026-06-08
- Added `final_evaluation/reports/owner_approval/test_cases_and_layers_full_report.md` as the human-readable approval artifact.
- Generated `final_evaluation/reports/owner_approval/test_case_catalog.csv` with 580 cases and exact prompts.
- Generated `final_evaluation/reports/owner_approval/test_case_catalog.json` for machine review.
- Generated `final_evaluation/reports/owner_approval/layer_case_counts.csv`.
- Default approval scope: 10 CUAD contracts plus 10 ACORD clause-bank records, 580 cases, 1860 repeated attempts.
- The report explicitly lists selected test contracts, ACORD topics, evaluation basis, three layers, thresholds, scoring gates, run flow, and the current global-agent citation blocker.

## Strict Scoring Hardening
- Timestamp local: 2026-06-09
- Enforced same-document citation validation against active product document IDs and gold spans.
- Stopped counting planned read-only tools as executed tool use.
- Added hard failures for approval-required artifacts created without approval.
- Tightened forbidden-action refusal checks so approval prompts alone do not pass security-denial cases.
- Made tools-layer scoring case-relevant instead of averaging many non-applicable `1.0` metrics.
- Tightened KPI, table-review, and calculation scoring.
- Replaced headline confidence intervals with source-record clustered intervals and kept attempt-level intervals as secondary diagnostics.
- Added generated-PDF transport metadata and report limitations.
- Added `final_evaluation/tests/test_strict_scoring.py`.
- Verification: `python3 -m unittest discover -s final_evaluation/tests -v` passed 5 tests.
- Verification: `python3 -m compileall -q final_evaluation` passed.
- Strict dry-run shakedowns completed for CUAD and ACORD under `final_evaluation/reports/strict_dry_run_cuad` and `final_evaluation/reports/strict_dry_run_acord`.

## Run strict-dry-run-cuad
- Timestamp UTC: 2026-06-09T15:07:38.193707+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --contract-count 1 --max-cases-per-layer 2 --run-id strict-dry-run-cuad --output-dir final_evaluation/reports/strict_dry_run_cuad`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `final_evaluation/reports/strict_dry_run_cuad`
- Overall score: `0.8844`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1003.0`

## Run strict-dry-run-acord
- Timestamp UTC: 2026-06-09T15:07:38.257997+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset acord --dry-run --contract-count 1 --max-cases-per-layer 2 --run-id strict-dry-run-acord --output-dir final_evaluation/reports/strict_dry_run_acord`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `final_evaluation/reports/strict_dry_run_acord`
- Overall score: `0.8874`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1003.0`

## Run strict-dry-run-cuad-v2
- Timestamp UTC: 2026-06-09T15:08:49.693647+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --contract-count 1 --max-cases-per-layer 2 --run-id strict-dry-run-cuad-v2 --output-dir final_evaluation/reports/strict_dry_run_cuad`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `final_evaluation/reports/strict_dry_run_cuad`
- Overall score: `0.8844`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1003.0`

## Run strict-dry-run-acord-v2
- Timestamp UTC: 2026-06-09T15:08:49.757688+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset acord --dry-run --contract-count 1 --max-cases-per-layer 2 --run-id strict-dry-run-acord-v2 --output-dir final_evaluation/reports/strict_dry_run_acord`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `final_evaluation/reports/strict_dry_run_acord`
- Overall score: `0.8874`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1003.0`

## Run strict-dry-run-cuad-v3
- Timestamp UTC: 2026-06-09T15:10:44.599822+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --contract-count 1 --max-cases-per-layer 2 --run-id strict-dry-run-cuad-v3 --output-dir final_evaluation/reports/strict_dry_run_cuad`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `final_evaluation/reports/strict_dry_run_cuad`
- Overall score: `0.8783`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1003.0`

## Run strict-dry-run-acord-v3
- Timestamp UTC: 2026-06-09T15:10:44.641356+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset acord --dry-run --contract-count 1 --max-cases-per-layer 2 --run-id strict-dry-run-acord-v3 --output-dir final_evaluation/reports/strict_dry_run_acord`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `final_evaluation/reports/strict_dry_run_acord`
- Overall score: `0.8828`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1003.0`

## Implementation Update
- Timestamp UTC: 2026-06-09
- Added support for `--contract-count 5` as an owner-review run size before the default 10-contract benchmark.
- Added `raw_responses.jsonl` to every report directory. Each line contains the case prompt, gold labels, observed answer, citations, tool calls, traces, artifacts, approval request, raw product payload, deterministic score, and failure modes for one attempt.
- The 5-contract run remains scored with the same strict three-layer methodology; it is a smaller approval sample, not a relaxed benchmark.

## Run cuad-live-strict-5-20260609
- Timestamp UTC: 2026-06-09T15:38:30.520712+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset cuad --contract-count 5 --run-id cuad-live-strict-5-20260609 --output-dir final_evaluation/reports/cuad_live_strict_5`
- Provider: `groq`
- Contract count: `5`
- Dry run: `False`
- Reports directory: `final_evaluation/reports/cuad_live_strict_5`
- Overall score: `0.4903`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run cuad-live-strict-5-20260610
- Timestamp UTC: 2026-06-10T09:48:16.534105+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset cuad --contract-count 5 --run-id cuad-live-strict-5-20260610 --output-dir final_evaluation/reports/cuad_live_strict_5_20260610`
- Provider: `groq`
- Contract count: `5`
- Dry run: `False`
- Reports directory: `final_evaluation/reports/cuad_live_strict_5_20260610`
- Overall score: `0.518`
- Pitch ready: `False`
- API error rate: `0.8812`
- Timeout rate: `0.0`
- p95 latency ms: `48360.0`

## Run cuad-gemini-3-1-flash-lite-smoke-5-20260610
- Timestamp UTC: 2026-06-10T15:05:59.689386+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset cuad --provider gemini --model-name gemini-3.1-flash-lite --contract-count 5 --max-cases-per-layer 1 --run-id cuad-gemini-3-1-flash-lite-smoke-5-20260610 --output-dir final_evaluation/reports/cuad_gemini_3_1_flash_lite_smoke_5_20260610`
- Provider: `gemini`
- Contract count: `5`
- Dry run: `False`
- Reports directory: `final_evaluation/reports/cuad_gemini_3_1_flash_lite_smoke_5_20260610`
- Overall score: `0.8284`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `23037.0`

## Run cuad-gemini-3-1-flash-lite-smoke-10-20260610
- Timestamp UTC: 2026-06-10T17:04:43.284947+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset cuad --provider gemini --model-name gemini-3.1-flash-lite --contract-count 10 --max-cases-per-layer 1 --run-id cuad-gemini-3-1-flash-lite-smoke-10-20260610 --output-dir final_evaluation/reports/cuad_gemini_3_1_flash_lite_smoke_10_20260610`
- Provider: `gemini`
- Contract count: `10`
- Dry run: `False`
- Reports directory: `final_evaluation/reports/cuad_gemini_3_1_flash_lite_smoke_10_20260610`
- Overall score: `0.8214`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `22364.0`

## Run balanced-smoke-dry-run
- Timestamp UTC: 2026-06-10T17:22:18.868196+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --contract-count 1 --smoke-profile balanced --run-id balanced-smoke-dry-run --output-dir final_evaluation/reports/balanced_smoke_dry_run`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `final_evaluation/reports/balanced_smoke_dry_run`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.9005`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1001.0`

## Implementation Update
- Timestamp UTC: 2026-06-10
- Added per-attempt `raw_responses.jsonl` checkpointing so long live runs preserve observations before final report generation.
- Added JWT TTL preflight with `--min-token-ttl-seconds` and `--allow-short-token`.
- Added `--repeat-default` and `--repeat-security` run overrides.
- Added `--smoke-profile balanced` to cover PAC reliability, RAG present, RAG absent, evidence tools, KPI, table review, and security/forbidden behavior per selected record.
- CUAD case generation now filters metadata labels such as `document name` out of legal-clause tasks when legal annotated labels are available.
- Citation collection now drops empty citation records and deduplicates repeated source quotes.
- Tool observation collection now normalizes trace statuses and maps `find_in_document` to `read_evidence` for evidence-reading evaluation.
- Presence scoring now accepts exact gold-span mentions inside longer answers.
- `/agent/query` responses now expose structured `tools` records from the agent state in addition to trace events.
- Verification: `python3 -m py_compile apps/backend/services/contract_agent/graph/state.py apps/backend/services/contract_agent/graph/runner.py`, `python3 -m compileall -q final_evaluation`, and `python3 -m unittest discover -s final_evaluation/tests -v` passed.

## Run balanced-smoke-dry-run-v2
- Timestamp UTC: 2026-06-10T17:22:52.005670+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --contract-count 1 --smoke-profile balanced --run-id balanced-smoke-dry-run-v2 --output-dir final_evaluation/reports/balanced_smoke_dry_run_v2`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `final_evaluation/reports/balanced_smoke_dry_run_v2`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.9005`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1001.0`

## Implementation Update
- Timestamp UTC: 2026-06-10
- Added `final_evaluation/tool_test_prompts.md` with one natural end-agent prompt for each registered ContractSense tool.
- The prompt bank separates user-facing prompts from expected tool behavior so manual testing does not overfit by naming the target tool inside official prompts.
- Covered read-only, approval-required, and forbidden tool categories, including tools not yet directly covered by the automated final-evaluation inventory.

## Implementation Update
- Timestamp UTC: 2026-06-10
- Fixed a manual evidence-retrieval failure where an article-count question such as "how much articles are there" could return "not addressed" even when `ARTICLE` headings were visible in the contract.
- `outline_document` now returns detected article/section heading metadata, including `article_count`, `section_count`, and ordered headings.
- `search_evidence` now recognizes article/section/clause inventory questions and returns a structured document-heading evidence snippet before normal lexical evidence.
- Query normalization now singularizes common legal structure plurals such as `articles`, `sections`, and `clauses`, and filters generic instruction words from evidence search terms.
- Added `final_evaluation/tests/test_agent_evidence_tools.py` to cover article-count and outline-heading behavior.
- Verification: `python3 -m unittest final_evaluation.tests.test_agent_evidence_tools -v`, `python3 -m unittest discover -s final_evaluation/tests -v`, and `python3 -m py_compile apps/backend/services/contract_agent/graph/tools/executor.py final_evaluation/tests/test_agent_evidence_tools.py` passed.

## Implementation Update
- Timestamp UTC: 2026-06-11
- Replaced the temporary article/section-specific evidence-search branch with generic scoped retrieval.
- `search_evidence` now accepts a primary rewritten `query` plus optional `queries`, records `rewritten_query`, `rewritten_queries`, and `retrieval_backend`, and prefers vector retrieval before persisted vector-chunk metadata search and `fallback_index`.
- `read_evidence` now reads vector-backed segment IDs returned by `search_evidence`, including IDs shaped as `{document_id}:{segment_id}`.
- `outline_document` remains query-independent and now prefers persisted segment metadata before deterministic outline extraction.
- Agent prompts now explicitly require rewriting user wording into concise retrieval queries and describe broad evidence families such as clauses, obligations, definitions, dates, parties, money, tables, KPIs, SLAs, risks, exceptions, remedies, renewal, termination, payment, audit, reporting, and cross-references.
- Added tests proving no query-specific structure branch remains, hybrid vector-chunk search is used when available, fallback mode is labeled, vector segment readback works, and prompt guidance requires rewritten retrieval queries.
- Verification: `python3 -m unittest final_evaluation.tests.test_agent_evidence_tools -v`, `python3 -m unittest discover -s final_evaluation/tests -v`, `python3 -m py_compile apps/backend/services/contract_agent/graph/tools/executor.py apps/backend/services/contract_agent/graph/tools/langchain_tools.py apps/backend/services/contract_agent/system_prompt.py apps/backend/services/contract_agent/rag/prompts.py final_evaluation/tests/test_agent_evidence_tools.py`, and `python3 -m compileall -q final_evaluation` passed.

## Implementation Update
- Timestamp UTC: 2026-06-11
- Fixed wrong-document leakage observed in the contract assistant, where a current-contract question could receive evidence from a different CUAD contract such as `HealthGate Data Corp Hosting and Management Agreement`.
- Vector retrieval results are now hard-filtered to the selected source document before being exposed as evidence.
- Persisted vector-chunk metadata retrieval now drops chunks whose `contract_id` or `document_id` is outside the scoped document set.
- Contract-level agent routes now default to the active contract plus explicitly referenced documents, instead of broadening to every project document when project documents are available.
- The frontend contract assistant now sends explicit document IDs when the user selects `All project docs`; `Current contract` remains an explicit current-contract scope.
- Added a regression test that inserts a high-scoring wrong-contract vector chunk and verifies `search_evidence` does not return it.
- Verification: `python3 -m unittest final_evaluation.tests.test_agent_evidence_tools -v`, `python3 -m unittest discover -s final_evaluation/tests -v`, `python3 -m py_compile apps/backend/services/contract_agent/graph/tools/executor.py apps/backend/api/routes/endpoints.py final_evaluation/tests/test_agent_evidence_tools.py`, `python3 -m compileall -q final_evaluation`, and `apps/frontend/node_modules/.bin/tsc --noEmit --pretty false` passed. `npm --prefix apps/frontend run lint` could not run because `next lint` opened an interactive ESLint configuration prompt.

## Implementation Update
- Timestamp UTC: 2026-06-11
- Tightened vector retrieval scoping from post-filter-only to pre-filter-first.
- Vector search now passes MongoDB Atlas `pre_filter` constraints for both `namespace` and the selected current document (`contract_id` or `document_id`) before retrieval.
- Post-filter checks remain as defense-in-depth in case a vector backend ignores or misapplies metadata filters.
- If scoped vector retrieval fails, the executor does not run an unscoped vector search; it falls back to scoped persisted metadata chunks and then scoped `index.content`.
- Added a regression test asserting vector search kwargs include namespace and current-document pre-filters.
- Verification: `python3 -m unittest final_evaluation.tests.test_agent_evidence_tools -v`, `python3 -m unittest discover -s final_evaluation/tests -v`, `python3 -m py_compile apps/backend/services/contract_agent/graph/tools/executor.py final_evaluation/tests/test_agent_evidence_tools.py`, and `python3 -m compileall -q final_evaluation` passed.

## Run final-eval-20260611T093942Z
- Timestamp UTC: 2026-06-11T09:39:42.652241+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --dataset cuad --contract-count 1 --smoke-profile balanced --max-cases-per-layer 2 --output-dir /tmp/contractsense_eval_test_check`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `/tmp/contractsense_eval_test_check`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.9004`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1001.0`

## Run final-eval-20260611T094142Z
- Timestamp UTC: 2026-06-11T09:41:42.281264+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --dataset cuad --contract-count 1 --smoke-profile balanced --max-cases-per-layer 2 --output-dir /tmp/contractsense_eval_test_check`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `/tmp/contractsense_eval_test_check`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.9004`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1001.0`

## Run final-eval-20260611T100614Z
- Timestamp UTC: 2026-06-11T10:06:14.537973+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --dataset cuad --contract-count 1 --smoke-profile balanced --max-cases-per-layer 2 --output-dir /tmp/contractsense_eval_test_check`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `/tmp/contractsense_eval_test_check`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.9004`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1001.0`

## Run final-eval-20260611T100615Z
- Timestamp UTC: 2026-06-11T10:06:15.435844+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --dataset acord --contract-count 1 --smoke-profile balanced --max-cases-per-layer 2 --output-dir /tmp/contractsense_eval_acord_test_check`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `/tmp/contractsense_eval_acord_test_check`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.9176`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1001.0`

## Run final-eval-20260611T100624Z
- Timestamp UTC: 2026-06-11T10:06:25.778792+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --dataset cuad --contract-count 1 --output-dir /tmp/contractsense_eval_full_tool_check`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `/tmp/contractsense_eval_full_tool_check`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.8838`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1003.0`

## Run final-eval-20260611T100625Z
- Timestamp UTC: 2026-06-11T10:06:26.584881+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --dataset acord --contract-count 1 --output-dir /tmp/contractsense_eval_acord_full_tool_check`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `/tmp/contractsense_eval_acord_full_tool_check`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.8913`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1003.0`

## Run final-eval-20260611T100731Z
- Timestamp UTC: 2026-06-11T10:07:32.662306+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --dataset cuad --contract-count 1 --output-dir /tmp/contractsense_eval_full_tool_check`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `/tmp/contractsense_eval_full_tool_check`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.8916`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1003.0`

## Run final-eval-20260611T100748Z
- Timestamp UTC: 2026-06-11T10:07:49.765583+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --dataset acord --contract-count 1 --output-dir /tmp/contractsense_eval_acord_full_tool_check`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `/tmp/contractsense_eval_acord_full_tool_check`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.8954`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1003.0`

## Run cuad-groq-balanced-5-20260611
- Timestamp UTC: 2026-06-11T10:50:59.352440+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset cuad --provider groq --contract-count 5 --api-base-url http://127.0.0.1:8000/api/v1 --smoke-profile balanced --allow-short-token --output-dir final_evaluation/reports/cuad_groq_balanced_5_20260611 --run-id cuad-groq-balanced-5-20260611`
- Provider: `groq`
- Contract count: `5`
- Dry run: `False`
- Reports directory: `final_evaluation/reports/cuad_groq_balanced_5_20260611`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.5074`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run cuad-groq-balanced-5-20260611-live
- Timestamp UTC: 2026-06-11T11:20:20.564145+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset cuad --provider groq --contract-count 5 --api-base-url http://127.0.0.1:8000/api/v1 --smoke-profile balanced --allow-short-token --output-dir final_evaluation/reports/cuad_groq_balanced_5_20260611_live --run-id cuad-groq-balanced-5-20260611-live`
- Provider: `groq`
- Contract count: `5`
- Dry run: `False`
- Reports directory: `final_evaluation/reports/cuad_groq_balanced_5_20260611_live`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.709`
- Pitch ready: `False`
- API error rate: `0.3714`
- Timeout rate: `0.0`
- p95 latency ms: `94728.0`

## Run cuad-groq-balanced-5-20260611-clean
- Timestamp UTC: 2026-06-11T12:32:44.519168+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset cuad --provider groq --contract-count 5 --api-base-url http://127.0.0.1:8000/api/v1 --smoke-profile balanced --output-dir final_evaluation/reports/cuad_groq_balanced_5_20260611_clean --run-id cuad-groq-balanced-5-20260611-clean`
- Provider: `groq`
- Contract count: `5`
- Dry run: `False`
- Reports directory: `final_evaluation/reports/cuad_groq_balanced_5_20260611_clean`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.7712`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `50448.0`

## Run acord-groq-balanced-3-20260611-clean
- Timestamp UTC: 2026-06-11T12:52:22.150955+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset acord --provider groq --contract-count 3 --api-base-url http://127.0.0.1:8000/api/v1 --smoke-profile balanced --output-dir final_evaluation/reports/acord_groq_balanced_3_20260611_clean --run-id acord-groq-balanced-3-20260611-clean`
- Provider: `groq`
- Contract count: `3`
- Dry run: `False`
- Reports directory: `final_evaluation/reports/acord_groq_balanced_3_20260611_clean`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.6499`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `44826.0`

## Run cuad-groq-balanced-3-20260611-clean
- Timestamp UTC: 2026-06-11T13:13:43.829032+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset cuad --provider groq --contract-count 3 --api-base-url http://127.0.0.1:8000/api/v1 --smoke-profile balanced --output-dir final_evaluation/reports/cuad_groq_balanced_3_20260611_clean --run-id cuad-groq-balanced-3-20260611-clean`
- Provider: `groq`
- Contract count: `3`
- Dry run: `False`
- Reports directory: `final_evaluation/reports/cuad_groq_balanced_3_20260611_clean`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.8002`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `54056.0`

## Run acord-gemini-balanced-3-20260611-clean
- Timestamp UTC: 2026-06-11T13:34:18.272108+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset acord --provider gemini --model-name gemini-3.1-flash-lite --contract-count 3 --api-base-url http://127.0.0.1:8000/api/v1 --smoke-profile balanced --output-dir final_evaluation/reports/acord_gemini_balanced_3_20260611_clean --run-id acord-gemini-balanced-3-20260611-clean`
- Provider: `gemini`
- Contract count: `3`
- Dry run: `False`
- Reports directory: `final_evaluation/reports/acord_gemini_balanced_3_20260611_clean`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.7101`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `58781.0`

## Run cuad-gemini-balanced-3-20260611-clean
- Timestamp UTC: 2026-06-11T13:55:45.589873+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset cuad --provider gemini --model-name gemini-3.1-flash-lite --contract-count 3 --api-base-url http://127.0.0.1:8000/api/v1 --smoke-profile balanced --output-dir final_evaluation/reports/cuad_gemini_balanced_3_20260611_clean --run-id cuad-gemini-balanced-3-20260611-clean`
- Provider: `gemini`
- Contract count: `3`
- Dry run: `False`
- Reports directory: `final_evaluation/reports/cuad_gemini_balanced_3_20260611_clean`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.8427`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `45941.0`

## Run final-eval-20260726T200543Z
- Timestamp UTC: 2026-07-26T20:05:56.069684+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run`
- Provider: `groq`
- Contract count: `10`
- Dry run: `True`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.8914`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1004.0`

## Run final-eval-20260726T212925Z
- Timestamp UTC: 2026-07-26T21:29:37.400042+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --contract-count 10`
- Provider: `groq`
- Contract count: `10`
- Dry run: `True`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.8914`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1004.0`

## Run final-eval-20260726T213804Z
- Timestamp UTC: 2026-07-26T21:38:10.581629+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --contract-count 5`
- Provider: `groq`
- Contract count: `5`
- Dry run: `True`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.8918`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1004.0`

## Run final-eval-20260726T213853Z
- Timestamp UTC: 2026-07-26T21:38:57.075062+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --contract-count 3`
- Provider: `groq`
- Contract count: `3`
- Dry run: `True`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/final-eval-20260726T213853Z`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.8927`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1004.0`

## Run final-eval-20260726T214157Z
- Timestamp UTC: 2026-07-26T21:42:01.481992+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --contract-count 3`
- Provider: `groq`
- Contract count: `3`
- Dry run: `True`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/final-eval-20260726T214157Z`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.8927`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1004.0`

## Run dash-eval-20260726T220158Z_groq
- Timestamp UTC: 2026-07-26T22:14:42.230267+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset acord --contract-count 5 --provider groq --run-id dash-eval-20260726T220158Z_groq --output-dir /final_evaluation/reports/acord_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `5`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/acord_live/dash-eval-20260726T220158Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.6625`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `33720.0`

## Run dash-eval-20260726T220158Z_groq
- Timestamp UTC: 2026-07-26T22:16:57.981469+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset cuad --contract-count 5 --provider groq --run-id dash-eval-20260726T220158Z_groq --output-dir /final_evaluation/reports/cuad_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `5`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/cuad_live/dash-eval-20260726T220158Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.7523`
- Pitch ready: `False`
- API error rate: `0.2`
- Timeout rate: `0.0`
- p95 latency ms: `67917.0`

## Run final-eval-20260727T105601Z
- Timestamp UTC: 2026-07-27T10:56:01.765149+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --dataset kpi --contract-count 3`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/final-eval-20260727T105601Z`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.8766`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1004.0`

## Run dash-eval-20260727T115308Z_groq
- Timestamp UTC: 2026-07-27T11:57:59.134863+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset acord --contract-count 1 --provider groq --run-id dash-eval-20260727T115308Z_groq --output-dir /final_evaluation/reports/acord_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/acord_live/dash-eval-20260727T115308Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.6272`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `81092.0`

## Run dash-eval-20260727T115308Z_groq
- Timestamp UTC: 2026-07-27T11:58:33.200591+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset cuad --contract-count 1 --provider groq --run-id dash-eval-20260727T115308Z_groq --output-dir /final_evaluation/reports/cuad_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/cuad_live/dash-eval-20260727T115308Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.8242`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `61905.0`

## Run dash-eval-20260727T120405Z_groq
- Timestamp UTC: 2026-07-27T12:07:10.069328+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset acord --contract-count 1 --provider groq --run-id dash-eval-20260727T120405Z_groq --output-dir /final_evaluation/reports/acord_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/acord_live/dash-eval-20260727T120405Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.6262`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `39933.0`

## Run dash-eval-20260727T120405Z_groq
- Timestamp UTC: 2026-07-27T12:08:49.473468+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset cuad --contract-count 1 --provider groq --run-id dash-eval-20260727T120405Z_groq --output-dir /final_evaluation/reports/cuad_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/cuad_live/dash-eval-20260727T120405Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.7953`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `59461.0`

## Run dash-eval-20260727T122321Z_groq
- Timestamp UTC: 2026-07-27T12:28:33.396006+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset acord --contract-count 1 --provider groq --run-id dash-eval-20260727T122321Z_groq --output-dir /final_evaluation/reports/acord_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/acord_live/dash-eval-20260727T122321Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.6296`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `83526.0`

## Run dash-eval-20260727T122321Z_groq
- Timestamp UTC: 2026-07-27T12:31:10.722782+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset cuad --contract-count 1 --provider groq --run-id dash-eval-20260727T122321Z_groq --output-dir /final_evaluation/reports/cuad_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/cuad_live/dash-eval-20260727T122321Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.7204`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `115476.0`

## Run dash-eval-20260727T125816Z_groq
- Timestamp UTC: 2026-07-27T12:58:18.472959+00:00
- Command: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/scripts/run_final_eval.py --dataset cuad --contract-count 1 --provider groq --run-id dash-eval-20260727T125816Z_groq --output-dir /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live --smoke-profile none --api-base-url http://127.0.0.1:8000/api/v1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live/dash-eval-20260727T125816Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4927`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260727T125822Z_groq
- Timestamp UTC: 2026-07-27T12:58:24.476553+00:00
- Command: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/scripts/run_final_eval.py --dataset acord --contract-count 1 --provider groq --run-id dash-eval-20260727T125822Z_groq --output-dir /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_live --smoke-profile none --api-base-url http://127.0.0.1:8000/api/v1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_live/dash-eval-20260727T125822Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4725`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260727T125919Z_groq
- Timestamp UTC: 2026-07-27T12:59:21.291607+00:00
- Command: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/scripts/run_final_eval.py --dataset cuad --contract-count 1 --provider groq --run-id dash-eval-20260727T125919Z_groq --output-dir /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live --smoke-profile none --api-base-url http://127.0.0.1:8000/api/v1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live/dash-eval-20260727T125919Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4927`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260727T125925Z_groq
- Timestamp UTC: 2026-07-27T12:59:27.550140+00:00
- Command: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/scripts/run_final_eval.py --dataset acord --contract-count 1 --provider groq --run-id dash-eval-20260727T125925Z_groq --output-dir /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_live --smoke-profile none --api-base-url http://127.0.0.1:8000/api/v1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_live/dash-eval-20260727T125925Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4725`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260727T125930Z_groq
- Timestamp UTC: 2026-07-27T12:59:31.809048+00:00
- Command: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/scripts/run_final_eval.py --dataset kpi --contract-count 1 --provider groq --run-id dash-eval-20260727T125930Z_groq --output-dir /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/kpi_live --manifest /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/datasets/kpi_contracts/manifest.json --smoke-profile none --api-base-url http://127.0.0.1:8000/api/v1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/kpi_live/dash-eval-20260727T125930Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.47`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260727T130253Z_groq
- Timestamp UTC: 2026-07-27T13:03:05.640987+00:00
- Command: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/scripts/run_final_eval.py --dataset cuad --contract-count 1 --provider groq --run-id dash-eval-20260727T130253Z_groq --output-dir /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live --smoke-profile none --api-base-url http://127.0.0.1:8000/api/v1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live/dash-eval-20260727T130253Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4927`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260727T130309Z_groq
- Timestamp UTC: 2026-07-27T13:03:18.009306+00:00
- Command: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/scripts/run_final_eval.py --dataset acord --contract-count 1 --provider groq --run-id dash-eval-20260727T130309Z_groq --output-dir /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_live --smoke-profile none --api-base-url http://127.0.0.1:8000/api/v1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_live/dash-eval-20260727T130309Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4725`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260727T130320Z_groq
- Timestamp UTC: 2026-07-27T13:03:24.271987+00:00
- Command: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/scripts/run_final_eval.py --dataset kpi --contract-count 1 --provider groq --run-id dash-eval-20260727T130320Z_groq --output-dir /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/kpi_live --manifest /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/datasets/kpi_contracts/manifest.json --smoke-profile none --api-base-url http://127.0.0.1:8000/api/v1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/kpi_live/dash-eval-20260727T130320Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.47`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260727T133012Z_groq
- Timestamp UTC: 2026-07-27T13:30:21.298706+00:00
- Command: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/scripts/run_final_eval.py --dataset cuad --contract-count 1 --provider groq --run-id dash-eval-20260727T133012Z_groq --output-dir /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live --smoke-profile none --api-base-url http://127.0.0.1:8000/api/v1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live/dash-eval-20260727T133012Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4927`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260727T133025Z_groq
- Timestamp UTC: 2026-07-27T13:30:33.567840+00:00
- Command: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/scripts/run_final_eval.py --dataset acord --contract-count 1 --provider groq --run-id dash-eval-20260727T133025Z_groq --output-dir /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_live --smoke-profile none --api-base-url http://127.0.0.1:8000/api/v1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_live/dash-eval-20260727T133025Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4725`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260727T133036Z_groq
- Timestamp UTC: 2026-07-27T13:30:40.043312+00:00
- Command: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/scripts/run_final_eval.py --dataset kpi --contract-count 1 --provider groq --run-id dash-eval-20260727T133036Z_groq --output-dir /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/kpi_live --manifest /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/datasets/kpi_contracts/manifest.json --smoke-profile none --api-base-url http://127.0.0.1:8000/api/v1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/kpi_live/dash-eval-20260727T133036Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.47`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run final-eval-20260727T133235Z
- Timestamp UTC: 2026-07-27T13:32:36.516744+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --dataset cuad --contract-count 1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/final-eval-20260727T133235Z`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.9097`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1003.0`

## Run final-eval-20260727T133400Z
- Timestamp UTC: 2026-07-27T13:34:01.853522+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --dataset acord --contract-count 1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/final-eval-20260727T133400Z`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.9125`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1003.0`

## Run final-eval-20260727T133407Z
- Timestamp UTC: 2026-07-27T13:34:07.499599+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dry-run --dataset kpi --contract-count 1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/final-eval-20260727T133407Z`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.9034`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1004.0`

## Run dash-eval-20260727T133442Z_groq
- Timestamp UTC: 2026-07-27T13:34:51.892640+00:00
- Command: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/scripts/run_final_eval.py --dataset cuad --contract-count 1 --provider groq --run-id dash-eval-20260727T133442Z_groq --output-dir /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live --smoke-profile none --api-base-url http://127.0.0.1:8000/api/v1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live/dash-eval-20260727T133442Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4927`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260727T133455Z_groq
- Timestamp UTC: 2026-07-27T13:35:04.246555+00:00
- Command: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/scripts/run_final_eval.py --dataset acord --contract-count 1 --provider groq --run-id dash-eval-20260727T133455Z_groq --output-dir /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_live --smoke-profile none --api-base-url http://127.0.0.1:8000/api/v1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_live/dash-eval-20260727T133455Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4725`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260727T133506Z_groq
- Timestamp UTC: 2026-07-27T13:35:10.615920+00:00
- Command: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/scripts/run_final_eval.py --dataset kpi --contract-count 1 --provider groq --run-id dash-eval-20260727T133506Z_groq --output-dir /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/kpi_live --manifest /Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/datasets/kpi_contracts/manifest.json --smoke-profile none --api-base-url http://127.0.0.1:8000/api/v1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/kpi_live/dash-eval-20260727T133506Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.47`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260727T134127Z_groq
- Timestamp UTC: 2026-07-27T13:41:39.936735+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset kpi --contract-count 1 --provider groq --run-id dash-eval-20260727T134127Z_groq --output-dir /final_evaluation/reports/kpi_live --manifest /final_evaluation/datasets/kpi_contracts/manifest.json --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/kpi_live/dash-eval-20260727T134127Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.47`
- Pitch ready: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260727T134127Z_groq
- Timestamp UTC: 2026-07-27T13:44:39.267807+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset acord --contract-count 1 --provider groq --run-id dash-eval-20260727T134127Z_groq --output-dir /final_evaluation/reports/acord_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/acord_live/dash-eval-20260727T134127Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.6256`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `33467.0`

## Run dash-eval-20260727T134127Z_groq
- Timestamp UTC: 2026-07-27T13:46:25.191422+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset cuad --contract-count 1 --provider groq --run-id dash-eval-20260727T134127Z_groq --output-dir /final_evaluation/reports/cuad_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/cuad_live/dash-eval-20260727T134127Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.8153`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `77173.0`

## Run dash-eval-20260727T141331Z_groq
- Timestamp UTC: 2026-07-27T14:17:25.651446+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset acord --contract-count 1 --provider groq --run-id dash-eval-20260727T141331Z_groq --output-dir /final_evaluation/reports/acord_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/acord_live/dash-eval-20260727T141331Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.6273`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `52945.0`

## Run dash-eval-20260727T141331Z_groq
- Timestamp UTC: 2026-07-27T14:21:36.786053+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset cuad --contract-count 1 --provider groq --run-id dash-eval-20260727T141331Z_groq --output-dir /final_evaluation/reports/cuad_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/cuad_live/dash-eval-20260727T141331Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.8305`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `133524.0`

## Run dash-eval-20260727T141331Z_groq
- Timestamp UTC: 2026-07-27T14:22:32.802458+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset kpi --contract-count 1 --provider groq --run-id dash-eval-20260727T141331Z_groq --output-dir /final_evaluation/reports/kpi_live --manifest /final_evaluation/datasets/kpi_contracts/manifest.json --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/kpi_live/dash-eval-20260727T141331Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.6135`
- Pitch ready: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `150436.0`

## Run cuad_dry__dash-eval-20260727T160724Z_groq
- Timestamp UTC: 2026-07-27T16:07:25.506291+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset all --dry-run --contract-count 1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_dry__dash-eval-20260727T160724Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.9156`
- Benchmark hard gates passed: `True`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1004.0`

## Run acord_dry__dash-eval-20260727T160730Z_groq
- Timestamp UTC: 2026-07-27T16:07:31.887014+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset all --dry-run --contract-count 1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_dry__dash-eval-20260727T160730Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.9242`
- Benchmark hard gates passed: `True`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1004.0`

## Run kpi_dry__dash-eval-20260727T160734Z_groq
- Timestamp UTC: 2026-07-27T16:07:34.541740+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --dataset all --dry-run --contract-count 1`
- Provider: `groq`
- Contract count: `1`
- Dry run: `True`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/kpi_dry__dash-eval-20260727T160734Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.9026`
- Benchmark hard gates passed: `True`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `1004.0`

## Run cuad_live__dash-eval-20260727T201142Z_groq
- Timestamp UTC: 2026-07-27T20:20:28.038712+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260727T201139Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/all_live/cuad_live__dash-eval-20260727T201142Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.6822`
- Benchmark hard gates passed: `False`
- API error rate: `0.1667`
- Timeout rate: `0.1667`
- p95 latency ms: `180058.0`

## Run acord_live__dash-eval-20260727T202028Z_groq
- Timestamp UTC: 2026-07-27T20:26:50.525779+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260727T201139Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/all_live/acord_live__dash-eval-20260727T202028Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.5394`
- Benchmark hard gates passed: `False`
- API error rate: `0.1667`
- Timeout rate: `0.1667`
- p95 latency ms: `180080.0`

## Run kpi_live__dash-eval-20260727T202650Z_groq
- Timestamp UTC: 2026-07-27T20:41:59.861284+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260727T201139Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/all_live/kpi_live__dash-eval-20260727T202650Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.4771`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `1.0`
- p95 latency ms: `0.0`

## Run cuad_live__dash-eval-20260727T204238Z_groq
- Timestamp UTC: 2026-07-27T20:46:43.464018+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260727T204238Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/all_live/cuad_live__dash-eval-20260727T204238Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.8459`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `66421.0`

## Run acord_live__dash-eval-20260727T204643Z_groq
- Timestamp UTC: 2026-07-27T20:50:50.444274+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260727T204238Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/all_live/acord_live__dash-eval-20260727T204643Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.5835`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `64220.0`

## Run kpi_live__dash-eval-20260727T205050Z_groq
- Timestamp UTC: 2026-07-27T20:56:08.332072+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260727T204238Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/all_live/kpi_live__dash-eval-20260727T205050Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.5794`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `77927.0`

## Run cuad_live__dash-eval-20260727T214224Z_groq
- Timestamp UTC: 2026-07-27T21:48:33.384968+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260727T214224Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/cuad_live__dash-eval-20260727T214224Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.856`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `103741.0`

## Run acord_live__dash-eval-20260727T214224Z_groq
- Timestamp UTC: 2026-07-27T21:51:14.652654+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260727T214224Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/acord_live__dash-eval-20260727T214224Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.5831`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `32464.0`

## Run kpi_live__dash-eval-20260727T214224Z_groq
- Timestamp UTC: 2026-07-27T21:56:26.187009+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260727T214224Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/kpi_live__dash-eval-20260727T214224Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.6051`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `80482.0`

## Run dash-eval-20260727T214224Z_groq
- Timestamp UTC: 2026-07-27T21:56:27.124246+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260727T214224Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `3`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/all_live/dash-eval-20260727T214224Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.6769`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `80482.0`

## Run cuad_live__dash-eval-20260728T120736Z_groq
- Timestamp UTC: 2026-07-28T12:13:24.052378+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260728T120736Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/cuad_live__dash-eval-20260728T120736Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.8682`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `122534.0`

## Run acord_live__dash-eval-20260728T120736Z_groq
- Timestamp UTC: 2026-07-28T12:16:29.604056+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260728T120736Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/acord_live__dash-eval-20260728T120736Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.584`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `40115.0`

## Run kpi_live__dash-eval-20260728T120736Z_groq
- Timestamp UTC: 2026-07-28T12:23:02.582339+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260728T120736Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/kpi_live__dash-eval-20260728T120736Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.7491`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `110165.0`

## Run dash-eval-20260728T120736Z_groq
- Timestamp UTC: 2026-07-28T12:23:03.572724+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260728T120736Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `3`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/all_live/dash-eval-20260728T120736Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.7319`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `110165.0`

## Run cuad_live__dash-eval-20260728T133239Z_groq
- Timestamp UTC: 2026-07-28T13:32:40.827493+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live__dash-eval-20260728T133239Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.5137`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run acord_live__dash-eval-20260728T133239Z_groq
- Timestamp UTC: 2026-07-28T13:32:50.005935+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_live__dash-eval-20260728T133239Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4414`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run kpi_live__dash-eval-20260728T133239Z_groq
- Timestamp UTC: 2026-07-28T13:32:54.790101+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/kpi_live__dash-eval-20260728T133239Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4771`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260728T133239Z_groq
- Timestamp UTC: 2026-07-28T13:33:00.551896+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `3`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/dash-eval-20260728T133239Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4775`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run cuad_live__dash-eval-20260728T133814Z_groq
- Timestamp UTC: 2026-07-28T13:38:22.238440+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live__dash-eval-20260728T133814Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.5137`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run acord_live__dash-eval-20260728T133814Z_groq
- Timestamp UTC: 2026-07-28T13:38:40.169684+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_live__dash-eval-20260728T133814Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4414`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run kpi_live__dash-eval-20260728T133814Z_groq
- Timestamp UTC: 2026-07-28T13:49:52.910998+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/kpi_live__dash-eval-20260728T133814Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.7712`
- Benchmark hard gates passed: `True`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `142249.0`

## Run dash-eval-20260728T133814Z_groq
- Timestamp UTC: 2026-07-28T13:49:59.338504+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `3`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/dash-eval-20260728T133814Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.5083`
- Benchmark hard gates passed: `False`
- API error rate: `0.8929`
- Timeout rate: `0.0`
- p95 latency ms: `142249.0`

## Run cuad_live__dash-eval-20260728T143007Z_groq
- Timestamp UTC: 2026-07-28T14:30:15.674241+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live__dash-eval-20260728T143007Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.5137`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run acord_live__dash-eval-20260728T143007Z_groq
- Timestamp UTC: 2026-07-28T14:30:33.487779+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_live__dash-eval-20260728T143007Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4414`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run kpi_live__dash-eval-20260728T143007Z_groq
- Timestamp UTC: 2026-07-28T14:30:45.863599+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/kpi_live__dash-eval-20260728T143007Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4771`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260728T143007Z_groq
- Timestamp UTC: 2026-07-28T14:30:51.349660+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `3`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/dash-eval-20260728T143007Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4775`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run cuad_live__dash-eval-20260728T145947Z_groq
- Timestamp UTC: 2026-07-28T14:59:54.749764+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token --auth-token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxNzg1MzMyMjQ3LCJqdGkiOiJkMDI3ZTU2My1kOWM1LTQ5MzMtOTcwZC02ZjRjODkzY2Q5M2IifQ.uZPduuonmXGoe-n2zkit987RWy9IEtO8bR_eS7YwzoI`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live__dash-eval-20260728T145947Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.5137`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run acord_live__dash-eval-20260728T145947Z_groq
- Timestamp UTC: 2026-07-28T15:00:10.312751+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token --auth-token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxNzg1MzMyMjQ3LCJqdGkiOiJkMDI3ZTU2My1kOWM1LTQ5MzMtOTcwZC02ZjRjODkzY2Q5M2IifQ.uZPduuonmXGoe-n2zkit987RWy9IEtO8bR_eS7YwzoI`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_live__dash-eval-20260728T145947Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4414`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run kpi_live__dash-eval-20260728T145947Z_groq
- Timestamp UTC: 2026-07-28T15:00:20.741658+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token --auth-token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxNzg1MzMyMjQ3LCJqdGkiOiJkMDI3ZTU2My1kOWM1LTQ5MzMtOTcwZC02ZjRjODkzY2Q5M2IifQ.uZPduuonmXGoe-n2zkit987RWy9IEtO8bR_eS7YwzoI`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/kpi_live__dash-eval-20260728T145947Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4771`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run dash-eval-20260728T145947Z_groq
- Timestamp UTC: 2026-07-28T15:00:25.519312+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token --auth-token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxNzg1MzMyMjQ3LCJqdGkiOiJkMDI3ZTU2My1kOWM1LTQ5MzMtOTcwZC02ZjRjODkzY2Q5M2IifQ.uZPduuonmXGoe-n2zkit987RWy9IEtO8bR_eS7YwzoI`
- Provider: `groq`
- Contract count: `3`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/dash-eval-20260728T145947Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.4775`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `0.0`
- p95 latency ms: `0.0`

## Run cuad_live__dash-eval-20260728T150340Z_groq
- Timestamp UTC: 2026-07-28T15:18:49.958336+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token --auth-token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxNzg1MzMyMjQ3LCJqdGkiOiJkMDI3ZTU2My1kOWM1LTQ5MzMtOTcwZC02ZjRjODkzY2Q5M2IifQ.uZPduuonmXGoe-n2zkit987RWy9IEtO8bR_eS7YwzoI`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live__dash-eval-20260728T150340Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.5137`
- Benchmark hard gates passed: `False`
- API error rate: `1.0`
- Timeout rate: `1.0`
- p95 latency ms: `0.0`

## Run cuad_live__dash-eval-20260728T152558Z_groq
- Timestamp UTC: 2026-07-28T15:30:23.100658+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260728T152558Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/cuad_live__dash-eval-20260728T152558Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.7704`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `90428.0`

## Run acord_live__dash-eval-20260728T152558Z_groq
- Timestamp UTC: 2026-07-28T15:35:15.112850+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260728T152558Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/acord_live__dash-eval-20260728T152558Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.764`
- Benchmark hard gates passed: `True`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `82295.0`

## Run kpi_live__dash-eval-20260728T152558Z_groq
- Timestamp UTC: 2026-07-28T15:41:05.343694+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260728T152558Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/kpi_live__dash-eval-20260728T152558Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.8383`
- Benchmark hard gates passed: `True`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `92594.0`

## Run dash-eval-20260728T152558Z_groq
- Timestamp UTC: 2026-07-28T15:41:06.341033+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260728T152558Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `3`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/all_live/dash-eval-20260728T152558Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.7992`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `90428.0`

## Run cuad_live__dash-eval-20260728T194747Z_groq
- Timestamp UTC: 2026-07-28T20:03:36.289900+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/cuad_live__dash-eval-20260728T194747Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.8529`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `86529.0`

## Run acord_live__dash-eval-20260728T194747Z_groq
- Timestamp UTC: 2026-07-28T20:12:29.319577+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/acord_live__dash-eval-20260728T194747Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.7595`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `33779.0`

## Run kpi_live__dash-eval-20260728T194747Z_groq
- Timestamp UTC: 2026-07-28T20:18:43.654987+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/kpi_live__dash-eval-20260728T194747Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.8407`
- Benchmark hard gates passed: `True`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `91743.0`

## Run dash-eval-20260728T194747Z_groq
- Timestamp UTC: 2026-07-28T20:18:49.982443+00:00
- Command: `final_evaluation/scripts/run_final_eval.py --provider groq --dataset all --contract-count 1 --repeat-default 1 --repeat-security 1 --allow-short-token`
- Provider: `groq`
- Contract count: `3`
- Dry run: `False`
- Reports directory: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/reports/dash-eval-20260728T194747Z_groq`
- Smoke profile: `none`
- Checkpoint raw responses: `True`
- Overall score: `0.8092`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `86529.0`

## Run cuad_live__dash-eval-20260728T213405Z_groq
- Timestamp UTC: 2026-07-28T21:40:23.531636+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260728T213405Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/cuad_live__dash-eval-20260728T213405Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.8845`
- Benchmark hard gates passed: `True`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `46400.0`

## Run acord_live__dash-eval-20260728T213405Z_groq
- Timestamp UTC: 2026-07-28T21:45:18.877769+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260728T213405Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/acord_live__dash-eval-20260728T213405Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.7404`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `39214.0`

## Run kpi_live__dash-eval-20260728T213405Z_groq
- Timestamp UTC: 2026-07-28T21:49:20.375593+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260728T213405Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `1`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/kpi_live__dash-eval-20260728T213405Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.8243`
- Benchmark hard gates passed: `True`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `73933.0`

## Run dash-eval-20260728T213405Z_groq
- Timestamp UTC: 2026-07-28T21:49:21.540164+00:00
- Command: `/final_evaluation/scripts/run_final_eval.py --dataset all --contract-count 1 --provider groq --run-id dash-eval-20260728T213405Z_groq --output-dir /final_evaluation/reports/all_live --smoke-profile none --api-base-url http://host.docker.internal:8000/api/v1 --smoke-profile balanced`
- Provider: `groq`
- Contract count: `3`
- Dry run: `False`
- Reports directory: `/final_evaluation/reports/all_live/dash-eval-20260728T213405Z_groq`
- Smoke profile: `balanced`
- Checkpoint raw responses: `True`
- Overall score: `0.812`
- Benchmark hard gates passed: `False`
- API error rate: `0.0`
- Timeout rate: `0.0`
- p95 latency ms: `47325.0`
