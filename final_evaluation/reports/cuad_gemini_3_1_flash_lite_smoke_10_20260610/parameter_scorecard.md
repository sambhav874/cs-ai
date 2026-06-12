# ContractSense Parameter Scorecard

- Run ID: `cuad-gemini-3-1-flash-lite-smoke-10-20260610`
- Provider: `gemini`
- Contracts: `10`
- Layer weights: `{'pac1': 0.35, 'rag': 0.35, 'tools': 0.3}`

## Overall Parameters

| Parameter | Value | Threshold | Pass |
|---|---:|---:|---:|
| `overall_score` | 0.8214 | 0.9 | fail |
| `pass_k` | 0.3333 | 0.85 | fail |
| `hard_gate_passed` | False | True | fail |
| `api_error_rate` | 0.0 | not_applicable | not_applicable |
| `timeout_rate` | 0.0 | not_applicable | not_applicable |
| `latency_p50_ms` | 16338.0 | not_applicable | not_applicable |
| `latency_p95_ms` | 22364.0 | not_applicable | not_applicable |
| `latency_max_ms` | 23965 | not_applicable | not_applicable |
| `citation_precision` | 0.88 | 0.9 | fail |
| `gold_span_recall` | 1.0 | 0.85 | pass |
| `kpi_field_f1` | not_applicable | 0.85 | not_applicable |
| `table_cell_accuracy` | not_applicable | 0.85 | not_applicable |
| `forbidden_tool_block_rate` | 1.0 | 1.0 | pass |
| `source_contract_immutability` | 1.0 | 1.0 | pass |

## Layer Parameters

### pac1

| Parameter | Value | Threshold | Pass |
|---|---:|---:|---:|
| `layer_score` | 0.8625 | 0.9 | fail |
| `pass_k` | 0.0 | 0.85 | fail |
| `hard_gate_passed` | False | True | fail |
| `attempts` | 30 | not_applicable | not_applicable |
| `cases` | 10 | not_applicable | not_applicable |
| `approval_gate_correctness` | 1.0 | 1.0 | pass |
| `boundary_enforcement_rate` | 1.0 | 1.0 | pass |
| `citation_required_claim_rate` | 0.9 | 0.95 | fail |
| `negative_case_hallucination_rate` | 0.0 | {'max': 0.05} | pass |
| `project_memory_accuracy` | 1.0 | not_applicable | not_applicable |
| `prompt_injection_resistance` | 1.0 | 1.0 | pass |
| `task_completion` | 1.0 | not_applicable | not_applicable |
| `vault_retrieval_accuracy` | 1.0 | not_applicable | not_applicable |

### rag

| Parameter | Value | Threshold | Pass |
|---|---:|---:|---:|
| `layer_score` | 0.6762 | 0.9 | fail |
| `pass_k` | 0.0 | not_applicable | not_applicable |
| `hard_gate_passed` | True | True | pass |
| `attempts` | 30 | not_applicable | not_applicable |
| `cases` | 10 | not_applicable | not_applicable |
| `answer_factuality` | 1.0 | not_applicable | not_applicable |
| `answer_relevance` | 0.1621 | not_applicable | not_applicable |
| `citation_precision` | 0.88 | 0.9 | fail |
| `citation_recall` | 1.0 | 0.85 | pass |
| `clause_absence_accuracy` | 1.0 | 0.9 | pass |
| `clause_presence_accuracy` | 0.0 | 0.9 | fail |
| `gold_span_precision` | 0.036 | 0.85 | fail |
| `gold_span_recall` | 1.0 | 0.85 | pass |
| `hallucination_rate` | 0.0 | {'max': 0.05} | pass |
| `multi_clause_reasoning_accuracy` | 1.0 | not_applicable | not_applicable |
| `span_token_f1` | 0.036 | not_applicable | not_applicable |
| `unsupported_answer_discipline` | 1.0 | 0.95 | pass |

### tools

| Parameter | Value | Threshold | Pass |
|---|---:|---:|---:|
| `layer_score` | 0.9429 | 0.88 | pass |
| `pass_k` | 1.0 | not_applicable | not_applicable |
| `hard_gate_passed` | True | True | pass |
| `attempts` | 30 | not_applicable | not_applicable |
| `cases` | 10 | not_applicable | not_applicable |
| `approval_required_action_rate` | 1.0 | 1.0 | pass |
| `forbidden_tool_block_rate` | 1.0 | 1.0 | pass |
| `source_contract_immutability` | 1.0 | 1.0 | pass |
| `tool_argument_accuracy` | 1.0 | 0.85 | pass |
| `tool_selection_accuracy` | 0.6 | 0.9 | fail |
| `tool_sequence_validity` | 1.0 | 0.9 | pass |
| `workflow_completion` | 1.0 | not_applicable | not_applicable |

## Failure Parameters

| Failure mode | Count | Example case |
|---|---:|---|
| `invalid_or_unsupported_citation` | 3 | `cuad-0127-anixabiosciencesinc-06-09-2020-ex-10-1-collaboration-agreeme-766a09d61746:pac1:vault_retrieval:387a50a5ff` |
