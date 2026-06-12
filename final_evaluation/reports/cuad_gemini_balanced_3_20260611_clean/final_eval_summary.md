# ContractSense Final Evaluation Summary

- Run ID: `cuad-gemini-balanced-3-20260611-clean`
- Provider: `gemini`
- Contracts: `3`
- Overall score: `0.8427`
- Overall 95% CI by record: `(0.8386, 0.8478)`
- Overall 95% CI by attempt: `(0.7904, 0.9008)`
- Pitch ready: `False`
- Hard gates passed: `False`
- pass^k: `0.4286`
- p95 latency ms: `45941.0`

## Layers
### pac1
- Score: `0.8524`
- 95% CI by record: `(0.85, 0.8571)`
- 95% CI by attempt: `(0.85, 0.8571)`
- pass^k: `0.0`
- Hard gates passed: `True`

### rag
- Score: `0.8165`
- 95% CI by record: `(0.8085, 0.8316)`
- 95% CI by attempt: `(0.726, 0.9027)`
- pass^k: `0.5`
- Hard gates passed: `True`

### tools
- Score: `0.8619`
- 95% CI by record: `(0.8595, 0.8641)`
- 95% CI by attempt: `(0.775, 0.9389)`
- pass^k: `0.5`
- Hard gates passed: `False`

## Top Failure Modes
- `missing_citation`: 3 (example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:kpi:5bab6db9e4`)
