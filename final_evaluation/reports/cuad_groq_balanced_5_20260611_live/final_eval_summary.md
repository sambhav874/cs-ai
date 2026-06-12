# ContractSense Final Evaluation Summary

- Run ID: `cuad-groq-balanced-5-20260611-live`
- Provider: `groq`
- Contracts: `5`
- Overall score: `0.709`
- Overall 95% CI by record: `(0.5993, 0.7995)`
- Overall 95% CI by attempt: `(0.6597, 0.7847)`
- Pitch ready: `False`
- Hard gates passed: `False`
- pass^k: `0.1143`
- p95 latency ms: `94728.0`

## Layers
### pac1
- Score: `0.7354`
- 95% CI by record: `(0.5529, 0.8382)`
- 95% CI by attempt: `(0.5529, 0.8382)`
- pass^k: `0.0`
- Hard gates passed: `False`

### rag
- Score: `0.6321`
- 95% CI by record: `(0.5586, 0.7101)`
- 95% CI by attempt: `(0.5475, 0.7224)`
- pass^k: `0.1`
- Hard gates passed: `False`

### tools
- Score: `0.7678`
- 95% CI by record: `(0.6686, 0.867)`
- 95% CI by attempt: `(0.6817, 0.8512)`
- pass^k: `0.15`
- Hard gates passed: `False`

## Top Failure Modes
- `api_or_runner_error`: 13 (example `cuad-0093-n2kinc-10-16-1997-ex-10-16-sponsorship-agreement-72206778cab5:rag:clause_presence:4117061283`)
- `missing_citation`: 10 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:rag:clause_presence:1020188777`)
- `approval_request_missing`: 5 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:table_review:99e531dcce`)
- `expected_refusal_missing`: 5 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:security_denial:46c2993f2e`)
- `unsupported_answer_discipline_failed`: 4 (example `cuad-0040-cytodyninc-20200109-10-q-ex-10-5-11941634-ex-10-5-license-ag-abc8e9538636:rag:absence_not_found_a:4595caffc8`)
- `invalid_or_unsupported_citation`: 3 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:kpi:5bab6db9e4`)
