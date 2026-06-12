# ContractSense Final Evaluation Summary

- Run ID: `acord-gemini-balanced-3-20260611-clean`
- Provider: `gemini`
- Contracts: `3`
- Overall score: `0.7101`
- Overall 95% CI by record: `(0.6556, 0.7547)`
- Overall 95% CI by attempt: `(0.6836, 0.8547)`
- Pitch ready: `False`
- Hard gates passed: `False`
- pass^k: `0.1429`
- p95 latency ms: `58781.0`

## Layers
### pac1
- Score: `0.7083`
- 95% CI by record: `(0.625, 0.75)`
- 95% CI by attempt: `(0.625, 0.75)`
- pass^k: `0.0`
- Hard gates passed: `False`

### rag
- Score: `0.5527`
- 95% CI by record: `(0.4474, 0.6055)`
- 95% CI by attempt: `(0.4491, 0.6564)`
- pass^k: `0.0`
- Hard gates passed: `False`

### tools
- Score: `0.896`
- 95% CI by record: `(0.8191, 0.9347)`
- 95% CI by attempt: `(0.8127, 0.9581)`
- pass^k: `0.25`
- Hard gates passed: `False`

## Top Failure Modes
- `invalid_or_unsupported_citation`: 15 (example `acord-Change Of Control-change-of-control-fbe732bcd8f6:pac1:acord_query_focus:400c8815ce`)
- `approval_request_missing`: 1 (example `acord-Change Of Control-change-of-control-fbe732bcd8f6:tools:table_review:b50e0ef2e8`)
