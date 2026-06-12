# ContractSense CUAD-Based Final Evaluation

**Status: dry-run shakedown only. Do not publish as an official result.**

This pitch-safe report summarizes an independent three-layer evaluation of the real ContractSense end agent. Official runs use Groq and product-level APIs only; failures, timeouts, missing citations, unsafe actions, and indexing errors remain in the denominator.

## Dataset And Run

- Dataset: `CUAD` with expert/lawyer-supervised legal annotations.
- Dataset provenance: confirm local CUAD license terms before external publication.
- Manifest: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/datasets/cuad_manifest.jsonl`
- Contracts evaluated: `1`
- Requested contract count: `1`
- Provider: `groq`
- Model name recorded by runner: `not_reported_by_backend`
- Official provider required: `groq`
- Official run: `True`
- End-agent only: `True`
- Product API only: `True`
- Existing repo evals used: `False`
- Repeats: default `1`, security `1`
- Document transport: `{'rendered_text_pdf': 1}`

## Scorecard

| Metric | Value |
|---|---:|
| Contracts evaluated | 1 |
| Overall score | 0.9005 |
| Overall 95% CI by record | (0.9005, 0.9005) |
| Overall 95% CI by attempt | (0.8736, 0.9687) |
| pass^k | 0.7143 |
| Hard gates passed | True |
| API error rate | 0.0 |
| Timeout rate | 0.0 |
| p50 latency ms | 1001.0 |
| p95 latency ms | 1001.0 |
| Max latency ms | 1001 |

## Three Layers
- **pac1**: score `0.875`, record-clustered 95% CI `(0.875, 0.875)`, pass^k `0.0`
- **rag**: score `0.8769`, record-clustered 95% CI `(0.8769, 0.8769)`, pass^k `0.5`
- **tools**: score `0.9579`, record-clustered 95% CI `(0.9579, 0.9579)`, pass^k `1.0`

## KPI And Table Results

- KPI field F1: `0.75`
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
| `get_kpi_context` | read_only | True | True |
| `calculate_from_evidence` | read_only | False | False |
| `list_tabular_reviews` | read_only | False | False |
| `get_tabular_review` | read_only | False | False |
| `list_playbooks` | read_only | False | False |
| `read_playbook_rules` | read_only | False | False |
| `get_memory_context` | read_only | True | True |
| `suggest_tabular_review` | approval_required | True | True |
| `create_tabular_review` | approval_required | False | False |
| `generate_tabular_review` | approval_required | False | False |
| `create_draft_artifact` | approval_required | True | True |
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
- `absence_not_found_a`: score `0.9511`, pass^k `1.0`, attempts `1`
- `clause_presence`: score `0.8028`, pass^k `0.0`, attempts `1`
- `draft`: score `1.0`, pass^k `1.0`, attempts `1`
- `kpi`: score `0.915`, pass^k `1.0`, attempts `1`
- `qa`: score `1.0`, pass^k `1.0`, attempts `1`
- `tabular_proposal`: score `0.9167`, pass^k `1.0`, attempts `1`
- `vault_retrieval`: score `0.875`, pass^k `0.0`, attempts `1`
### contract_length
- `long`: score `0.9229`, pass^k `0.7143`, attempts `7`
### annotation_density
- `sparse`: score `0.9229`, pass^k `0.7143`, attempts `7`
### clause_family
- `"affiliate license-licensee" that should be reviewed by a lawyer. details: does the contract contain a license grant to a licensee (incl. sublicensor) and the a`: score `0.9511`, pass^k `1.0`, attempts `1`
- `"agreement date" that should be reviewed by a lawyer. details: the date of the contract+"expiration date" that should be reviewed by a lawyer. details: on what date will the contract's initial term expire`: score `0.915`, pass^k `1.0`, attempts `1`
- `"parties" that should be reviewed by a lawyer. details: the two or more parties who signed the contract`: score `0.9194`, pass^k `0.5`, attempts `4`
- `"parties" that should be reviewed by a lawyer. details: the two or more parties who signed the contract+"agreement date" that should be reviewed by a lawyer. details: the date of the contract`: score `0.9167`, pass^k `1.0`, attempts `1`

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
- Main confidence intervals are clustered by source record; attempt-level intervals are shown only as secondary diagnostics.
- If document transport is rendered text PDF or rendered clause-bank PDF, the run proves text-grounding and workflow behavior but is weaker evidence for OCR/layout fidelity than original source PDFs.
- Dry-run reports validate plumbing only and must not be used in sales material.
- This is a product benchmark, not a base-model leaderboard.
- Private holdout prompts and gold answers should not be published.
