# ContractSense Final Evaluation Summary

- Run ID: `cuad-groq-balanced-3-20260611-clean`
- Provider: `groq`
- Contracts: `3`
- Overall score: `0.8002`
- Overall 95% CI by record: `(0.7783, 0.8233)`
- Overall 95% CI by attempt: `(0.7672, 0.8844)`
- Pitch ready: `False`
- Hard gates passed: `False`
- pass^k: `0.1905`
- p95 latency ms: `54056.0`

## Layers
### pac1
- Score: `0.8345`
- 95% CI by record: `(0.8036, 0.85)`
- 95% CI by attempt: `(0.8036, 0.85)`
- pass^k: `0.0`
- Hard gates passed: `True`

### rag
- Score: `0.6834`
- 95% CI by record: `(0.6364, 0.7639)`
- 95% CI by attempt: `(0.6074, 0.7912)`
- pass^k: `0.1667`
- Hard gates passed: `False`

### tools
- Score: `0.8966`
- 95% CI by record: `(0.8613, 0.9144)`
- 95% CI by attempt: `(0.835, 0.9511)`
- pass^k: `0.25`
- Hard gates passed: `False`

## Top Failure Modes
- `expected_refusal_missing`: 3 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:security_denial:46c2993f2e`)
- `invalid_or_unsupported_citation`: 3 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:kpi:5bab6db9e4`)
- `missing_citation`: 3 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:rag:clause_presence:1020188777`)
- `unsupported_answer_discipline_failed`: 2 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:rag:absence_not_found_a:b9018772bc`)
- `approval_request_missing`: 1 (example `cuad-0040-cytodyninc-20200109-10-q-ex-10-5-11941634-ex-10-5-license-ag-abc8e9538636:tools:table_review:439c2eb6f1`)
