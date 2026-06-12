# ContractSense Final Evaluation Summary

- Run ID: `cuad-gemini-3-1-flash-lite-smoke-10-20260610`
- Provider: `gemini`
- Contracts: `10`
- Overall score: `0.8214`
- Overall 95% CI by record: `(0.8122, 0.8282)`
- Overall 95% CI by attempt: `(0.8035, 0.8505)`
- Pitch ready: `False`
- Hard gates passed: `False`
- pass^k: `0.3333`
- p95 latency ms: `22364.0`

## Layers
### pac1
- Score: `0.8625`
- 95% CI by record: `(0.8375, 0.875)`
- 95% CI by attempt: `(0.8458, 0.875)`
- pass^k: `0.0`
- Hard gates passed: `False`

### rag
- Score: `0.6762`
- 95% CI by record: `(0.6643, 0.6855)`
- 95% CI by attempt: `(0.6698, 0.682)`
- pass^k: `0.0`
- Hard gates passed: `True`

### tools
- Score: `0.9429`
- 95% CI by record: `(0.9429, 0.9429)`
- 95% CI by attempt: `(0.9429, 0.9429)`
- pass^k: `1.0`
- Hard gates passed: `True`

## Top Failure Modes
- `invalid_or_unsupported_citation`: 3 (example `cuad-0127-anixabiosciencesinc-06-09-2020-ex-10-1-collaboration-agreeme-766a09d61746:pac1:vault_retrieval:387a50a5ff`)
