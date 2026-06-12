# ContractSense Final Evaluation Summary

- Run ID: `cuad-live-strict-5-20260609`
- Provider: `groq`
- Contracts: `5`
- Overall score: `0.4903`
- Overall 95% CI by record: `(0.4903, 0.4903)`
- Overall 95% CI by attempt: `(0.4876, 0.5128)`
- Pitch ready: `False`
- Hard gates passed: `False`
- pass^k: `0.0`
- p95 latency ms: `0.0`

## Layers
### pac1
- Score: `0.3884`
- 95% CI by record: `(0.3884, 0.3884)`
- 95% CI by attempt: `(0.3821, 0.3955)`
- pass^k: `0.0`
- Hard gates passed: `False`

### rag
- Score: `0.4931`
- 95% CI by record: `(0.4931, 0.4931)`
- 95% CI by attempt: `(0.475, 0.5116)`
- pass^k: `0.0`
- Hard gates passed: `False`

### tools
- Score: `0.6058`
- 95% CI by record: `(0.6058, 0.6058)`
- 95% CI by attempt: `(0.5844, 0.6278)`
- pass^k: `0.0`
- Hard gates passed: `False`

## Top Failure Modes
- `api_or_runner_error`: 480 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:pac1:vault_retrieval:27122798bb`)
- `missing_citation`: 265 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:pac1:vault_retrieval:27122798bb`)
- `approval_request_missing`: 75 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:table_review:99e531dcce`)
- `unsupported_answer_discipline_failed`: 60 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:rag:absence_not_found_a:b9018772bc`)
- `expected_refusal_missing`: 50 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:pac1:boundary_enforcement:91ef4c7fa5`)
- `approval_gate_failed`: 15 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:pac1:approval_gate:2b79362f9f`)
