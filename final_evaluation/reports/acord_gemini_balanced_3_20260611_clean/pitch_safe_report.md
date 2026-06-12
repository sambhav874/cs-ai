# ContractSense ACORD-Based Final Evaluation

**Status: non-official provider comparison run. Do not publish as the Groq final benchmark.**

This pitch-safe report summarizes an independent three-layer evaluation of the real ContractSense end agent. Official runs use Groq and product-level APIs only; failures, timeouts, missing citations, unsafe actions, and indexing errors remain in the denominator.

## Dataset And Run

- Dataset: `ACORD` with expert/lawyer-supervised legal annotations.
- Dataset provenance: confirm local ACORD license terms before external publication.
- Manifest: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/datasets/acord_manifest.jsonl`
- Contracts evaluated: `3`
- Requested contract count: `3`
- Provider: `gemini`
- Model name recorded by runner: `gemini-3.1-flash-lite`
- Official provider required: `groq`
- Official run: `False`
- End-agent only: `True`
- Product API only: `True`
- Existing repo evals used: `False`
- Repeats: default `1`, security `1`
- Document transport: `{'rendered_clause_bank_pdf': 3}`

## Scorecard

| Metric | Value |
|---|---:|
| Contracts evaluated | 3 |
| Overall score | 0.7101 |
| Overall 95% CI by record | (0.6556, 0.7547) |
| Overall 95% CI by attempt | (0.6836, 0.8547) |
| pass^k | 0.1429 |
| Hard gates passed | False |
| API error rate | 0.0 |
| Timeout rate | 0.0 |
| p50 latency ms | 36206.0 |
| p95 latency ms | 58781.0 |
| Max latency ms | 61079 |

## Three Layers
- **pac1**: score `0.7083`, record-clustered 95% CI `(0.625, 0.75)`, pass^k `0.0`
- **rag**: score `0.5527`, record-clustered 95% CI `(0.4474, 0.6055)`, pass^k `0.0`
- **tools**: score `0.896`, record-clustered 95% CI `(0.8191, 0.9347)`, pass^k `0.25`

## KPI And Table Results

- KPI field F1: `not_applicable`
- Gold span recall: `0.3333`
- Citation precision: `0.0`
- Table cell accuracy: `0.6667`
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
| `outline_document` | read_only | True | True |
| `read_document` | read_only | False | True |
| `search_evidence` | read_only | True | True |
| `read_evidence` | read_only | True | True |
| `read_playbook_rules` | read_only | False | False |
| `read_table_cells` | read_only | False | False |
| `read_workflow` | read_only | False | False |
| `get_kpi_context` | read_only | False | False |
| `calculate_from_evidence` | read_only | True | False |
| `get_tabular_review` | read_only | False | False |
| `suggest_tabular_review` | approval_required | True | True |
| `create_tabular_review` | approval_required | False | True |
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

- `invalid_or_unsupported_citation`: 15 attempts, example `acord-Change Of Control-change-of-control-fbe732bcd8f6:pac1:acord_query_focus:400c8815ce`
- `approval_request_missing`: 1 attempts, example `acord-Change Of Control-change-of-control-fbe732bcd8f6:tools:table_review:b50e0ef2e8`

## Breakdowns

### workflow_type
- `calculation`: score `0.9166`, pass^k `0.0`, attempts `3`
- `qa`: score `0.8256`, pass^k `0.0`, attempts `6`
- `retrieval`: score `0.5524`, pass^k `0.0`, attempts `3`
- `security_denial`: score `1.0`, pass^k `1.0`, attempts `3`
- `tabular_proposal`: score `0.7245`, pass^k `0.0`, attempts `3`
- `unsupported`: score `0.5529`, pass^k `0.0`, attempts `3`
### contract_length
- `long`: score `0.7496`, pass^k `0.1429`, attempts `14`
- `medium`: score `0.8142`, pass^k `0.1429`, attempts `7`
### annotation_density
- `dense`: score `0.7711`, pass^k `0.1429`, attempts `21`
### clause_family
- `acord relevant precedent clause (4-star)`: score `0.7723`, pass^k `0.0`, attempts `5`
- `acord relevant precedent clause (4-star)+acord relevant precedent clause (4-star)`: score `0.8378`, pass^k `0.0`, attempts `1`
- `acord relevant precedent clause (5-star)`: score `0.7158`, pass^k `0.0`, attempts `10`
- `acord relevant precedent clause (5-star)+acord relevant precedent clause (4-star)`: score `0.5`, pass^k `0.0`, attempts `1`
- `acord relevant precedent clause (5-star)+acord relevant precedent clause (5-star)`: score `0.8358`, pass^k `0.0`, attempts `1`
- `unrated precedent clause`: score `1.0`, pass^k `1.0`, attempts `3`

## What This Proves

- Grounded precedent-clause retrieval over expert-rated ACORD legal text.
- High-rated clause selection with low-rated distractor avoidance.
- Structured table reviews for precedent comparison and drafting reuse.
- Draft, redline, playbook, and artifact workflows with approval gates.
- Source clause-bank immutability and forbidden-tool blocking.

## Limitations

- ACORD labels are the gold source; tasks outside available label coverage are reported separately or scored only when deterministic evidence exists.
- Ambiguous KPI fields are excluded from deterministic scoring and should be reviewed qualitatively.
- Main confidence intervals are clustered by source record; attempt-level intervals are shown only as secondary diagnostics.
- If document transport is rendered text PDF or rendered clause-bank PDF, the run proves text-grounding and workflow behavior but is weaker evidence for OCR/layout fidelity than original source PDFs.
- Dry-run reports validate plumbing only and must not be used in sales material.
- This is a product benchmark, not a base-model leaderboard.
- Private holdout prompts and gold answers should not be published.
