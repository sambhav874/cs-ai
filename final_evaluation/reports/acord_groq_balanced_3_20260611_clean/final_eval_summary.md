# ContractSense Final Evaluation Summary

- Run ID: `acord-groq-balanced-3-20260611-clean`
- Provider: `groq`
- Contracts: `3`
- Overall score: `0.6499`
- Overall 95% CI by record: `(0.5967, 0.7518)`
- Overall 95% CI by attempt: `(0.6525, 0.8255)`
- Pitch ready: `False`
- Hard gates passed: `False`
- pass^k: `0.0476`
- p95 latency ms: `44826.0`

## Layers
### pac1
- Score: `0.5417`
- 95% CI by record: `(0.5, 0.625)`
- 95% CI by attempt: `(0.5, 0.625)`
- pass^k: `0.0`
- Hard gates passed: `False`

### rag
- Score: `0.5645`
- 95% CI by record: `(0.461, 0.7524)`
- 95% CI by attempt: `(0.4674, 0.6616)`
- pass^k: `0.0`
- Hard gates passed: `False`

### tools
- Score: `0.8759`
- 95% CI by record: `(0.8607, 0.8991)`
- 95% CI by attempt: `(0.7984, 0.9453)`
- pass^k: `0.0833`
- Hard gates passed: `False`

## Top Failure Modes
- `invalid_or_unsupported_citation`: 9 (example `acord-Change Of Control-change-of-control-fbe732bcd8f6:pac1:acord_query_focus:400c8815ce`)
- `missing_citation`: 6 (example `acord-Change Of Control-change-of-control-fbe732bcd8f6:rag:acord_top1_retrieval:f6204af818`)
- `approval_request_missing`: 3 (example `acord-Change Of Control-change-of-control-fbe732bcd8f6:tools:table_review:b50e0ef2e8`)
- `expected_refusal_missing`: 2 (example `acord-Change Of Control-change-of-control-fbe732bcd8f6:tools:security_denial:3d37358db3`)
