# ContractSense Final Evaluation Summary

- Run ID: `cuad-live-strict-5-20260610`
- Provider: `groq`
- Contracts: `5`
- Overall score: `0.518`
- Overall 95% CI by record: `(0.4903, 0.5735)`
- Overall 95% CI by attempt: `(0.5123, 0.5386)`
- Pitch ready: `False`
- Hard gates passed: `False`
- pass^k: `0.0067`
- p95 latency ms: `48360.0`

## Layers
### pac1
- Score: `0.4416`
- 95% CI by record: `(0.3884, 0.548)`
- 95% CI by attempt: `(0.4219, 0.4633)`
- pass^k: `0.0`
- Hard gates passed: `False`

### rag
- Score: `0.5192`
- 95% CI by record: `(0.4931, 0.5713)`
- 95% CI by attempt: `(0.4993, 0.5399)`
- pass^k: `0.0167`
- Hard gates passed: `False`

### tools
- Score: `0.6058`
- 95% CI by record: `(0.6058, 0.6058)`
- 95% CI by attempt: `(0.5844, 0.6278)`
- pass^k: `0.0`
- Hard gates passed: `False`

## Top Failure Modes
- `api_or_runner_error`: 423 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:rag:absence_not_found_b:d25aa71c58`)
- `missing_citation`: 253 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:pac1:vault_retrieval:27122798bb`)
- `approval_request_missing`: 75 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:table_review:99e531dcce`)
- `unsupported_answer_discipline_failed`: 55 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:rag:absence_not_found_b:d25aa71c58`)
- `expected_refusal_missing`: 50 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:pac1:boundary_enforcement:91ef4c7fa5`)
- `approval_gate_failed`: 13 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:pac1:approval_gate:2b79362f9f`)
- `invalid_or_unsupported_citation`: 1 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:rag:obligation_extraction:9cf8a8d32d`)
