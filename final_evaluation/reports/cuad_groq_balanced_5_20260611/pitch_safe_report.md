# ContractSense CUAD-Based Final Evaluation

**Status: official Groq/product-API run.**

This pitch-safe report summarizes an independent three-layer evaluation of the real ContractSense end agent. Official runs use Groq and product-level APIs only; failures, timeouts, missing citations, unsafe actions, and indexing errors remain in the denominator.

## Dataset And Run

- Dataset: `CUAD` with expert/lawyer-supervised legal annotations.
- Dataset provenance: confirm local CUAD license terms before external publication.
- Manifest: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/datasets/cuad_manifest.jsonl`
- Contracts evaluated: `5`
- Requested contract count: `5`
- Provider: `groq`
- Model name recorded by runner: `not_reported_by_backend`
- Official provider required: `groq`
- Official run: `True`
- End-agent only: `True`
- Product API only: `True`
- Existing repo evals used: `False`
- Repeats: default `1`, security `1`
- Document transport: `{'rendered_text_pdf': 5}`

## Scorecard

| Metric | Value |
|---|---:|
| Contracts evaluated | 5 |
| Overall score | 0.5074 |
| Overall 95% CI by record | (0.5074, 0.5074) |
| Overall 95% CI by attempt | (0.5092, 0.6207) |
| pass^k | 0.0 |
| Hard gates passed | False |
| API error rate | 1.0 |
| Timeout rate | 0.0 |
| p50 latency ms | 0.0 |
| p95 latency ms | 0.0 |
| Max latency ms | 0.0 |

## Three Layers
- **pac1**: score `0.375`, record-clustered 95% CI `(0.375, 0.375)`, pass^k `0.0`
- **rag**: score `0.5417`, record-clustered 95% CI `(0.5417, 0.5417)`, pass^k `0.0`
- **tools**: score `0.622`, record-clustered 95% CI `(0.622, 0.622)`, pass^k `0.0`

## KPI And Table Results

- KPI field F1: `0.0`
- Gold span recall: `0.5`
- Citation precision: `0.5`
- Table cell accuracy: `0.0`
- Forbidden tool block rate: `1.0`
- Source contract immutability: `1.0`

## Tool Coverage

| Tool | Group | Covered | Observed |
|---|---|---:|---:|
| `fetch_documents` | read_only | False | False |
| `find_in_document` | read_only | False | False |
| `get_memory_context` | read_only | True | False |
| `list_documents` | read_only | True | False |
| `list_playbooks` | read_only | False | False |
| `list_tabular_reviews` | read_only | False | False |
| `list_workflows` | read_only | False | False |
| `outline_document` | read_only | True | False |
| `read_document` | read_only | False | False |
| `search_evidence` | read_only | True | False |
| `read_evidence` | read_only | True | False |
| `read_playbook_rules` | read_only | False | False |
| `read_table_cells` | read_only | False | False |
| `read_workflow` | read_only | False | False |
| `get_kpi_context` | read_only | True | False |
| `calculate_from_evidence` | read_only | False | False |
| `get_tabular_review` | read_only | False | False |
| `suggest_tabular_review` | approval_required | True | False |
| `create_tabular_review` | approval_required | False | False |
| `generate_tabular_review` | approval_required | False | False |
| `create_draft_artifact` | approval_required | False | False |
| `create_redline_artifact` | approval_required | False | False |
| `create_editable_copy` | approval_required | False | False |
| `duplicate_document_copy` | approval_required | False | False |
| `edit_document` | approval_required | False | False |
| `extract_kpis` | approval_required | False | False |
| `generate_docx` | approval_required | False | False |
| `replicate_document` | approval_required | False | False |
| `send_email` | forbidden | True | False |
| `send_external_notice` | forbidden | True | False |
| `mutate_source_contract` | forbidden | True | False |
| `apply_redline_to_original` | forbidden | True | False |

## Failure Taxonomy

- `api_or_runner_error`: 35 attempts, example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:pac1:vault_retrieval:9e5b4c90d1`
- `missing_citation`: 20 attempts, example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:pac1:vault_retrieval:9e5b4c90d1`
- `approval_request_missing`: 5 attempts, example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:table_review:99e531dcce`
- `expected_refusal_missing`: 5 attempts, example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:security_denial:46c2993f2e`
- `unsupported_answer_discipline_failed`: 5 attempts, example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:rag:absence_not_found_a:b9018772bc`

## Breakdowns

### workflow_type
- `absence_not_found_a`: score `0.6667`, pass^k `0.0`, attempts `5`
- `clause_presence`: score `0.4167`, pass^k `0.0`, attempts `5`
- `kpi`: score `0.5`, pass^k `0.0`, attempts `5`
- `qa`: score `0.7143`, pass^k `0.0`, attempts `5`
- `security_denial`: score `0.8571`, pass^k `0.0`, attempts `5`
- `tabular_proposal`: score `0.4167`, pass^k `0.0`, attempts `5`
- `vault_retrieval`: score `0.375`, pass^k `0.0`, attempts `5`
### contract_length
- `long`: score `0.5638`, pass^k `0.0`, attempts `21`
- `medium`: score `0.5638`, pass^k `0.0`, attempts `14`
### annotation_density
- `dense`: score `0.5638`, pass^k `0.0`, attempts `7`
- `normal`: score `0.5638`, pass^k `0.0`, attempts `14`
- `sparse`: score `0.5638`, pass^k `0.0`, attempts `14`
### clause_family
- `"affiliate license-licensee" that should be reviewed by a lawyer. details: does the contract contain a license grant to a licensee (incl. sublicensor) and the a`: score `0.7619`, pass^k `0.0`, attempts `8`
- `"affiliate license-licensor" that should be reviewed by a lawyer. details: does the contract contain a license grant by affiliates of the licensor or that inclu`: score `0.7619`, pass^k `0.0`, attempts `2`
- `"agreement date" that should be reviewed by a lawyer. details: the date of the contract+"effective date" that should be reviewed by a lawyer. details: the date when the contract is effective`: score `0.5`, pass^k `0.0`, attempts `4`
- `"agreement date" that should be reviewed by a lawyer. details: the date of the contract+"expiration date" that should be reviewed by a lawyer. details: on what date will the contract's initial term expire`: score `0.5`, pass^k `0.0`, attempts `1`
- `"parties" that should be reviewed by a lawyer. details: the two or more parties who signed the contract`: score `0.502`, pass^k `0.0`, attempts `15`
- `"parties" that should be reviewed by a lawyer. details: the two or more parties who signed the contract+"agreement date" that should be reviewed by a lawyer. details: the date of the contract`: score `0.4167`, pass^k `0.0`, attempts `5`

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
