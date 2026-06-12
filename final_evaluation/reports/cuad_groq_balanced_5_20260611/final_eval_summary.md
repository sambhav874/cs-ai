# ContractSense Final Evaluation Summary

- Run ID: `cuad-groq-balanced-5-20260611`
- Provider: `groq`
- Contracts: `5`
- Overall score: `0.5074`
- Overall 95% CI by record: `(0.5074, 0.5074)`
- Overall 95% CI by attempt: `(0.5092, 0.6207)`
- Pitch ready: `False`
- Hard gates passed: `False`
- pass^k: `0.0`
- p95 latency ms: `0.0`

## Layers
### pac1
- Score: `0.375`
- 95% CI by record: `(0.375, 0.375)`
- 95% CI by attempt: `(0.375, 0.375)`
- pass^k: `0.0`
- Hard gates passed: `False`

### rag
- Score: `0.5417`
- 95% CI by record: `(0.5417, 0.5417)`
- 95% CI by attempt: `(0.4667, 0.6167)`
- pass^k: `0.0`
- Hard gates passed: `False`

### tools
- Score: `0.622`
- 95% CI by record: `(0.622, 0.622)`
- 95% CI by attempt: `(0.5458, 0.6988)`
- pass^k: `0.0`
- Hard gates passed: `False`

## Top Failure Modes
- `api_or_runner_error`: 35 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:pac1:vault_retrieval:9e5b4c90d1`)
- `missing_citation`: 20 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:pac1:vault_retrieval:9e5b4c90d1`)
- `approval_request_missing`: 5 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:table_review:99e531dcce`)
- `expected_refusal_missing`: 5 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:security_denial:46c2993f2e`)
- `unsupported_answer_discipline_failed`: 5 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:rag:absence_not_found_a:b9018772bc`)
