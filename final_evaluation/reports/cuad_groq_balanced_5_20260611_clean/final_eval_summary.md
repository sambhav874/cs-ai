# ContractSense Final Evaluation Summary

- Run ID: `cuad-groq-balanced-5-20260611-clean`
- Provider: `groq`
- Contracts: `5`
- Overall score: `0.7712`
- Overall 95% CI by record: `(0.7517, 0.7849)`
- Overall 95% CI by attempt: `(0.7355, 0.8433)`
- Pitch ready: `False`
- Hard gates passed: `False`
- pass^k: `0.1714`
- p95 latency ms: `50448.0`

## Layers
### pac1
- Score: `0.8304`
- 95% CI by record: `(0.8125, 0.8479)`
- 95% CI by attempt: `(0.8125, 0.8479)`
- pass^k: `0.0`
- Hard gates passed: `True`

### rag
- Score: `0.639`
- 95% CI by record: `(0.5988, 0.6732)`
- 95% CI by attempt: `(0.5604, 0.7271)`
- pass^k: `0.1`
- Hard gates passed: `False`

### tools
- Score: `0.8563`
- 95% CI by record: `(0.8512, 0.8637)`
- 95% CI by attempt: `(0.7897, 0.9182)`
- pass^k: `0.25`
- Hard gates passed: `False`

## Top Failure Modes
- `approval_request_missing`: 5 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:table_review:99e531dcce`)
- `expected_refusal_missing`: 5 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:security_denial:46c2993f2e`)
- `invalid_or_unsupported_citation`: 5 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:kpi:5bab6db9e4`)
- `missing_citation`: 5 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:rag:clause_presence:1020188777`)
- `unsupported_answer_discipline_failed`: 4 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:rag:absence_not_found_a:b9018772bc`)
