# ContractSense CUAD-Based Final Evaluation

**Status: non-official provider comparison run. Do not publish as the Groq final benchmark.**

This pitch-safe report summarizes an independent three-layer evaluation of the real ContractSense end agent. Official runs use Groq and product-level APIs only; failures, timeouts, missing citations, unsafe actions, and indexing errors remain in the denominator.

## Dataset And Run

- Dataset: `CUAD` with expert/lawyer-supervised legal annotations.
- Dataset provenance: confirm local CUAD license terms before external publication.
- Manifest: `/Users/sambhavjain/Desktop/Codes/extractor/extractor/final_evaluation/datasets/cuad_manifest.jsonl`
- Contracts evaluated: `10`
- Requested contract count: `10`
- Provider: `gemini`
- Model name recorded by runner: `gemini-3.1-flash-lite`
- Official provider required: `groq`
- Official run: `False`
- End-agent only: `True`
- Product API only: `True`
- Existing repo evals used: `False`
- Repeats: default `3`, security `5`
- Document transport: `{'rendered_text_pdf': 10}`

## Scorecard

| Metric | Value |
|---|---:|
| Contracts evaluated | 10 |
| Overall score | 0.8214 |
| Overall 95% CI by record | (0.8122, 0.8282) |
| Overall 95% CI by attempt | (0.8035, 0.8505) |
| pass^k | 0.3333 |
| Hard gates passed | False |
| API error rate | 0.0 |
| Timeout rate | 0.0 |
| p50 latency ms | 16338.0 |
| p95 latency ms | 22364.0 |
| Max latency ms | 23965 |

## Three Layers
- **pac1**: score `0.8625`, record-clustered 95% CI `(0.8375, 0.875)`, pass^k `0.0`
- **rag**: score `0.6762`, record-clustered 95% CI `(0.6643, 0.6855)`, pass^k `0.0`
- **tools**: score `0.9429`, record-clustered 95% CI `(0.9429, 0.9429)`, pass^k `1.0`

## KPI And Table Results

- KPI field F1: `not_applicable`
- Gold span recall: `1.0`
- Citation precision: `0.88`
- Table cell accuracy: `not_applicable`
- Forbidden tool block rate: `1.0`
- Source contract immutability: `1.0`

## Tool Coverage

| Tool | Group | Covered | Observed |
|---|---|---:|---:|
| `list_documents` | read_only | True | True |
| `outline_document` | read_only | True | True |
| `search_evidence` | read_only | True | True |
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

- `invalid_or_unsupported_citation`: 3 attempts, example `cuad-0127-anixabiosciencesinc-06-09-2020-ex-10-1-collaboration-agreeme-766a09d61746:pac1:vault_retrieval:387a50a5ff`

## Breakdowns

### workflow_type
- `clause_presence`: score `0.6762`, pass^k `0.0`, attempts `30`
- `qa`: score `0.9429`, pass^k `1.0`, attempts `30`
- `vault_retrieval`: score `0.8625`, pass^k `0.0`, attempts `30`
### contract_length
- `long`: score `0.8345`, pass^k `0.3333`, attempts `27`
- `medium`: score `0.8171`, pass^k `0.3333`, attempts `36`
- `short`: score `0.8333`, pass^k `0.3333`, attempts `27`
### annotation_density
- `dense`: score `0.8336`, pass^k `0.3333`, attempts `27`
- `normal`: score `0.8209`, pass^k `0.3333`, attempts `36`
- `sparse`: score `0.8292`, pass^k `0.3333`, attempts `27`
### clause_family
- `"document name" that should be reviewed by a lawyer. details: the name of the contract`: score `0.8272`, pass^k `0.3333`, attempts `90`

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
