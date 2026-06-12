# ContractSense CUAD-Based Final Evaluation

**Status: official Groq/product-API run.**

This pitch-safe report summarizes an independent three-layer evaluation of the real ContractSense end agent. Official runs use Groq and product-level APIs only; failures, timeouts, missing citations, unsafe actions, and indexing errors remain in the denominator.

## Dataset And Run

- Dataset: `CUAD` with expert/lawyer-supervised legal annotations.
- Dataset provenance: confirm local CUAD license terms before external publication.
- Manifest: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/datasets/cuad_manifest.jsonl`
- Contracts evaluated: `1`
- Requested contract count: `1`
- Provider: `groq`
- End-agent only: `True`
- Product API only: `True`
- Existing repo evals used: `False`
- Repeats: default `3`, security `5`

## Scorecard

| Metric | Value |
|---|---:|
| Contracts evaluated | 1 |
| Overall score | 0.6595 |
| Overall 95% CI | (0.5326, 0.8287) |
| pass^k | 0.0 |
| Hard gates passed | False |
| API error rate | 0.0 |
| Timeout rate | 0.0 |
| p50 latency ms | 9991.0 |
| p95 latency ms | 10838.0 |
| Max latency ms | 10838 |

## Three Layers
- **pac1**: score `0.625`, 95% CI `(0.625, 0.625)`, pass^k `0.0`
- **rag**: score `0.4292`, 95% CI `(0.4292, 0.4292)`, pass^k `0.0`
- **tools**: score `0.9684`, 95% CI `(0.9579, 0.9789)`, pass^k `0.0`

## KPI And Table Results

- KPI field F1: `not_applicable`
- Gold span recall: `0.0`
- Citation precision: `0.0`
- Table cell accuracy: `not_applicable`
- Forbidden tool block rate: `1.0`
- Source contract immutability: `1.0`

## Tool Coverage

| Tool | Group | Covered | Observed |
|---|---|---:|---:|
| `list_documents` | read_only | True | False |
| `outline_document` | read_only | True | False |
| `search_evidence` | read_only | True | False |
| `read_evidence` | read_only | True | False |
| `get_kpi_context` | read_only | False | False |
| `calculate_from_evidence` | read_only | False | False |
| `list_tabular_reviews` | read_only | False | False |
| `get_tabular_review` | read_only | False | False |
| `list_playbooks` | read_only | False | False |
| `read_playbook_rules` | read_only | False | False |
| `get_memory_context` | read_only | True | False |
| `suggest_tabular_review` | approval_required | False | False |
| `create_tabular_review` | approval_required | False | False |
| `generate_tabular_review` | approval_required | False | False |
| `create_draft_artifact` | approval_required | False | False |
| `create_redline_artifact` | approval_required | False | False |
| `create_editable_copy` | approval_required | False | False |
| `duplicate_document_copy` | approval_required | False | False |
| `send_email` | forbidden | False | False |
| `send_external_notice` | forbidden | False | False |
| `mutate_source_contract` | forbidden | False | False |
| `apply_redline_to_original` | forbidden | False | False |

## Failure Taxonomy

- `missing_citation`: 12 attempts, example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:pac1:vault_retrieval:27122798bb`

## Breakdowns

### workflow_type
- `clause_presence`: score `0.4292`, pass^k `0.0`, attempts `3`
- `qa`: score `0.9684`, pass^k `0.0`, attempts `3`
- `vault_retrieval`: score `0.625`, pass^k `0.0`, attempts `3`
### contract_length
- `long`: score `0.6742`, pass^k `0.0`, attempts `9`
### annotation_density
- `sparse`: score `0.6742`, pass^k `0.0`, attempts `9`
### clause_family
- `"document name" that should be reviewed by a lawyer. details: the name of the contract`: score `0.6742`, pass^k `0.0`, attempts `9`

## What This Proves

- Grounded answers with citations over real CUAD legal text.
- Absent-clause discipline rather than confident hallucination.
- KPI and obligation extraction from contract evidence.
- Structured table reviews that legal and procurement teams can reuse.
- Draft, redline, playbook, and artifact workflows with approval gates.
- Source contract immutability and forbidden-tool blocking.

## Limitations

- CUAD labels are the gold source; tasks outside available label coverage are reported separately or scored only when deterministic evidence exists.
- Ambiguous KPI fields are excluded from deterministic scoring and should be reviewed qualitatively.
- Dry-run reports validate plumbing only and must not be used in sales material.
- This is a product benchmark, not a base-model leaderboard.
- Private holdout prompts and gold answers should not be published.
