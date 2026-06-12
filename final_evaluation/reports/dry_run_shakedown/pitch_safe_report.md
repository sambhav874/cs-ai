# ContractSense CUAD-Based Final Evaluation

**Status: dry-run shakedown only. Do not publish as an official result.**

This pitch-safe report summarizes an independent three-layer evaluation of the real ContractSense end agent. Official runs use Groq and product-level APIs only; failures, timeouts, missing citations, unsafe actions, and indexing errors remain in the denominator.

## Dataset And Run

- Dataset: `CUAD` with lawyer-supervised annotated contract spans.
- CUAD provenance: primary public contract dataset for commercial-contract clause extraction; confirm local license terms before external publication.
- Manifest: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/datasets/cuad_manifest.jsonl`
- Contracts evaluated: `1`
- Requested contract count: `10`
- Provider: `groq`
- End-agent only: `True`
- Product API only: `True`
- Existing repo evals used: `False`
- Repeats: default `3`, security `5`

## Scorecard

| Metric | Value |
|---|---:|
| Contracts evaluated | 1 |
| Overall score | 0.9007 |
| Overall 95% CI | (0.8775, 0.9343) |
| pass^k | 0.3333 |
| Hard gates passed | True |
| API error rate | 0.0 |
| Timeout rate | 0.0 |
| p50 latency ms | 1002.0 |
| p95 latency ms | 1003.0 |
| Max latency ms | 1003 |

## Three Layers
- **pac1**: score `0.875`, 95% CI `(0.875, 0.875)`, pass^k `0.0`
- **rag**: score `0.8488`, 95% CI `(0.8447, 0.8529)`, pass^k `0.0`
- **tools**: score `0.9912`, 95% CI `(0.9854, 0.9971)`, pass^k `1.0`

## KPI And Table Results

- KPI field F1: `1.0`
- Gold span recall: `1.0`
- Citation precision: `1.0`
- Table cell accuracy: `0.0`
- Forbidden tool block rate: `1.0`
- Source contract immutability: `1.0`

## Tool Coverage

| Tool | Group | Covered | Observed |
|---|---|---:|---:|
| `list_documents` | read_only | True | True |
| `outline_document` | read_only | True | True |
| `search_evidence` | read_only | True | True |
| `read_evidence` | read_only | True | True |
| `get_kpi_context` | read_only | True | True |
| `calculate_from_evidence` | read_only | False | False |
| `list_tabular_reviews` | read_only | False | False |
| `get_tabular_review` | read_only | False | False |
| `list_playbooks` | read_only | False | False |
| `read_playbook_rules` | read_only | False | False |
| `get_memory_context` | read_only | True | True |
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

- No failure modes recorded in this run.

## Breakdowns

### workflow_type
- `clause_presence`: score `0.8426`, pass^k `0.0`, attempts `3`
- `exact_extraction`: score `0.855`, pass^k `0.0`, attempts `3`
- `kpi`: score `0.9825`, pass^k `1.0`, attempts `3`
- `project_memory`: score `0.875`, pass^k `0.0`, attempts `3`
- `qa`: score `1.0`, pass^k `1.0`, attempts `3`
- `vault_retrieval`: score `0.875`, pass^k `0.0`, attempts `3`
### contract_length
- `short`: score `0.905`, pass^k `0.3333`, attempts `18`
### annotation_density
- `dense`: score `0.905`, pass^k `0.3333`, attempts `18`
### clause_family
- `agreement date`: score `0.9059`, pass^k `0.3333`, attempts `9`
- `termination for convenience`: score `0.865`, pass^k `0.0`, attempts `6`
- `termination for convenience+audit rights`: score `0.9825`, pass^k `1.0`, attempts `3`

## What This Proves

- Grounded answers with citations over real CUAD contracts.
- Absent-clause discipline rather than confident hallucination.
- KPI and obligation extraction from contract evidence.
- Structured table reviews that legal and procurement teams can reuse.
- Draft, redline, playbook, and artifact workflows with approval gates.
- Source contract immutability and forbidden-tool blocking.

## Limitations

- CUAD labels are the gold source; tasks outside CUAD label coverage are reported separately or scored only when deterministic evidence exists.
- Ambiguous KPI fields are excluded from deterministic scoring and should be reviewed qualitatively.
- Dry-run reports validate plumbing only and must not be used in sales material.
- This is a product benchmark, not a base-model leaderboard.
- Private holdout prompts and gold answers should not be published.
