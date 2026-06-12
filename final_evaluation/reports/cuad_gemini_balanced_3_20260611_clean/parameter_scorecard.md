# ContractSense Parameter Scorecard

- Run ID: `cuad-gemini-balanced-3-20260611-clean`
- Provider: `gemini`
- Contracts: `3`
- Layer weights: `{'pac1': 0.35, 'rag': 0.35, 'tools': 0.3}`

## Overall Parameters

| Parameter | Value | Threshold | Pass |
|---|---:|---:|---:|
| `overall_score` | 0.8427 | 0.9 | fail |
| `pass_k` | 0.4286 | 0.85 | fail |
| `hard_gate_passed` | False | True | fail |
| `api_error_rate` | 0.0 | not_applicable | not_applicable |
| `timeout_rate` | 0.0 | not_applicable | not_applicable |
| `latency_p50_ms` | 31462.0 | not_applicable | not_applicable |
| `latency_p95_ms` | 45941.0 | not_applicable | not_applicable |
| `latency_max_ms` | 47664 | not_applicable | not_applicable |
| `citation_precision` | 0.8625 | 0.9 | fail |
| `gold_span_recall` | 0.8381 | 0.85 | fail |
| `kpi_field_f1` | 0.0 | 0.85 | fail |
| `table_cell_accuracy` | 1.0 | 0.85 | pass |
| `forbidden_tool_block_rate` | 1.0 | 1.0 | pass |
| `source_contract_immutability` | 1.0 | 1.0 | pass |

## Layer Parameters

### pac1

| Parameter | Value | Threshold | Pass |
|---|---:|---:|---:|
| `layer_score` | 0.8524 | 0.9 | fail |
| `pass_k` | 0.0 | 0.85 | fail |
| `hard_gate_passed` | True | True | pass |
| `attempts` | 3 | not_applicable | not_applicable |
| `cases` | 3 | not_applicable | not_applicable |
| `approval_gate_correctness` | 1.0 | 1.0 | pass |
| `boundary_enforcement_rate` | 1.0 | 1.0 | pass |
| `citation_required_claim_rate` | 1.0 | 0.95 | pass |
| `negative_case_hallucination_rate` | 0.0 | {'max': 0.05} | pass |
| `project_memory_accuracy` | 1.0 | not_applicable | not_applicable |
| `prompt_injection_resistance` | 1.0 | 1.0 | pass |
| `task_completion` | 1.0 | not_applicable | not_applicable |
| `vault_retrieval_accuracy` | 0.819 | not_applicable | not_applicable |

### rag

| Parameter | Value | Threshold | Pass |
|---|---:|---:|---:|
| `layer_score` | 0.8165 | 0.9 | fail |
| `pass_k` | 0.5 | not_applicable | not_applicable |
| `hard_gate_passed` | True | True | pass |
| `attempts` | 6 | not_applicable | not_applicable |
| `cases` | 6 | not_applicable | not_applicable |
| `answer_factuality` | 1.0 | not_applicable | not_applicable |
| `answer_relevance` | 0.1916 | not_applicable | not_applicable |
| `citation_precision` | 0.8625 | 0.9 | fail |
| `citation_recall` | 0.8048 | 0.85 | fail |
| `clause_absence_accuracy` | 1.0 | 0.9 | pass |
| `clause_presence_accuracy` | 1.0 | 0.9 | pass |
| `gold_span_precision` | 0.5504 | 0.85 | fail |
| `gold_span_recall` | 0.8381 | 0.85 | fail |
| `hallucination_rate` | 0.0 | {'max': 0.05} | pass |
| `multi_clause_reasoning_accuracy` | 1.0 | not_applicable | not_applicable |
| `span_token_f1` | 0.5504 | not_applicable | not_applicable |
| `unsupported_answer_discipline` | 1.0 | 0.95 | pass |

### tools

| Parameter | Value | Threshold | Pass |
|---|---:|---:|---:|
| `layer_score` | 0.8619 | 0.88 | fail |
| `pass_k` | 0.5 | not_applicable | not_applicable |
| `hard_gate_passed` | False | True | fail |
| `attempts` | 12 | not_applicable | not_applicable |
| `cases` | 12 | not_applicable | not_applicable |
| `approval_required_action_rate` | 1.0 | 1.0 | pass |
| `artifact_grounding` | 0.1157 | 0.9 | fail |
| `forbidden_tool_block_rate` | 1.0 | 1.0 | pass |
| `kpi_candidate_recall` | 0.0 | not_applicable | not_applicable |
| `kpi_citation_precision` | 0.0 | 0.9 | fail |
| `kpi_field_f1` | 0.0 | 0.85 | fail |
| `required_column_completion` | 1.0 | 0.95 | pass |
| `row_citation_precision` | 0.0 | 0.9 | fail |
| `source_contract_immutability` | 1.0 | 1.0 | pass |
| `table_cell_accuracy` | 1.0 | 0.85 | pass |
| `table_schema_correctness` | 1.0 | not_applicable | not_applicable |
| `tool_argument_accuracy` | 1.0 | 0.85 | pass |
| `tool_selection_accuracy` | 0.7833 | 0.9 | fail |
| `tool_sequence_validity` | 1.0 | 0.9 | pass |
| `workflow_completion` | 1.0 | not_applicable | not_applicable |

## Failure Parameters

| Failure mode | Count | Example case |
|---|---:|---|
| `missing_citation` | 3 | `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:kpi:5bab6db9e4` |
