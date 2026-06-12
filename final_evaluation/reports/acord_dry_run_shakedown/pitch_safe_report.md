# ContractSense ACORD-Based Final Evaluation

**Status: dry-run shakedown only. Do not publish as an official result.**

This pitch-safe report summarizes an independent three-layer evaluation of the real ContractSense end agent. Official runs use Groq and product-level APIs only; failures, timeouts, missing citations, unsafe actions, and indexing errors remain in the denominator.

## Dataset And Run

- Dataset: `ACORD` with expert/lawyer-supervised legal annotations.
- Dataset provenance: confirm local ACORD license terms before external publication.
- Manifest: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/datasets/acord_manifest.jsonl`
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
| Overall score | 0.8998 |
| Overall 95% CI | (0.8801, 0.9287) |
| pass^k | 0.3333 |
| Hard gates passed | True |
| API error rate | 0.0 |
| Timeout rate | 0.0 |
| p50 latency ms | 1002.0 |
| p95 latency ms | 1003.0 |
| Max latency ms | 1003 |

## Three Layers
- **pac1**: score `0.875`, 95% CI `(0.875, 0.875)`, pass^k `0.0`
- **rag**: score `0.8613`, 95% CI `(0.8496, 0.8729)`, pass^k `0.0`
- **tools**: score `0.9737`, 95% CI `(0.9562, 0.9912)`, pass^k `1.0`

## KPI And Table Results

- KPI field F1: `not_applicable`
- Gold span recall: `1.0`
- Citation precision: `1.0`
- Table cell accuracy: `1.0`
- Forbidden tool block rate: `1.0`
- Source contract immutability: `1.0`

## Tool Coverage

| Tool | Group | Covered | Observed |
|---|---|---:|---:|
| `list_documents` | read_only | True | True |
| `outline_document` | read_only | True | True |
| `search_evidence` | read_only | True | True |
| `read_evidence` | read_only | True | True |
| `get_kpi_context` | read_only | False | False |
| `calculate_from_evidence` | read_only | False | False |
| `list_tabular_reviews` | read_only | False | False |
| `get_tabular_review` | read_only | False | False |
| `list_playbooks` | read_only | False | False |
| `read_playbook_rules` | read_only | False | False |
| `get_memory_context` | read_only | True | True |
| `suggest_tabular_review` | approval_required | True | True |
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
- `qa`: score `0.9167`, pass^k `0.3333`, attempts `9`
- `retrieval`: score `0.8613`, pass^k `0.0`, attempts `6`
- `tabular_proposal`: score `0.9474`, pass^k `1.0`, attempts `3`
### contract_length
- `short`: score `0.9033`, pass^k `0.3333`, attempts `18`
### annotation_density
- `sparse`: score `0.9033`, pass^k `0.3333`, attempts `18`
### clause_family
- `acord relevant precedent clause (5-star)`: score `0.9072`, pass^k `0.25`, attempts `12`
- `acord relevant precedent clause (5-star)+acord relevant precedent clause (5-star)`: score `0.8956`, pass^k `0.5`, attempts `6`

## What This Proves

- Grounded precedent-clause retrieval over expert-rated ACORD legal text.
- High-rated clause selection with low-rated distractor avoidance.
- Structured table reviews for precedent comparison and drafting reuse.
- Draft, redline, playbook, and artifact workflows with approval gates.
- Source clause-bank immutability and forbidden-tool blocking.

## Limitations

- ACORD labels are the gold source; tasks outside available label coverage are reported separately or scored only when deterministic evidence exists.
- Ambiguous KPI fields are excluded from deterministic scoring and should be reviewed qualitatively.
- Dry-run reports validate plumbing only and must not be used in sales material.
- This is a product benchmark, not a base-model leaderboard.
- Private holdout prompts and gold answers should not be published.
