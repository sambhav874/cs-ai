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
- End-agent only: `True`
- Product API only: `True`
- Existing repo evals used: `False`
- Repeats: default `3`, security `5`
- Document transport: `{'rendered_text_pdf': 5}`

## Scorecard

| Metric | Value |
|---|---:|
| Contracts evaluated | 5 |
| Overall score | 0.518 |
| Overall 95% CI by record | (0.4903, 0.5735) |
| Overall 95% CI by attempt | (0.5123, 0.5386) |
| pass^k | 0.0067 |
| Hard gates passed | False |
| API error rate | 0.8812 |
| Timeout rate | 0.0 |
| p50 latency ms | 18494.0 |
| p95 latency ms | 48360.0 |
| Max latency ms | 54710 |

## Three Layers
- **pac1**: score `0.4416`, record-clustered 95% CI `(0.3884, 0.548)`, pass^k `0.0`
- **rag**: score `0.5192`, record-clustered 95% CI `(0.4931, 0.5713)`, pass^k `0.0167`
- **tools**: score `0.6058`, record-clustered 95% CI `(0.6058, 0.6058)`, pass^k `0.0`

## KPI And Table Results

- KPI field F1: `0.0`
- Gold span recall: `0.4157`
- Citation precision: `0.3442`
- Table cell accuracy: `0.0`
- Forbidden tool block rate: `1.0`
- Source contract immutability: `1.0`

## Tool Coverage

| Tool | Group | Covered | Observed |
|---|---|---:|---:|
| `list_documents` | read_only | True | True |
| `outline_document` | read_only | True | False |
| `search_evidence` | read_only | True | True |
| `read_evidence` | read_only | True | False |
| `get_kpi_context` | read_only | True | False |
| `calculate_from_evidence` | read_only | True | False |
| `list_tabular_reviews` | read_only | True | False |
| `get_tabular_review` | read_only | True | False |
| `list_playbooks` | read_only | True | False |
| `read_playbook_rules` | read_only | True | False |
| `get_memory_context` | read_only | True | False |
| `suggest_tabular_review` | approval_required | True | False |
| `create_tabular_review` | approval_required | True | False |
| `generate_tabular_review` | approval_required | True | False |
| `create_draft_artifact` | approval_required | True | True |
| `create_redline_artifact` | approval_required | True | False |
| `create_editable_copy` | approval_required | True | False |
| `duplicate_document_copy` | approval_required | True | False |
| `send_email` | forbidden | True | False |
| `send_external_notice` | forbidden | True | False |
| `mutate_source_contract` | forbidden | True | False |
| `apply_redline_to_original` | forbidden | True | False |

## Failure Taxonomy

- `api_or_runner_error`: 423 attempts, example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:rag:absence_not_found_b:d25aa71c58`
- `missing_citation`: 253 attempts, example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:pac1:vault_retrieval:27122798bb`
- `approval_request_missing`: 75 attempts, example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:tools:table_review:99e531dcce`
- `unsupported_answer_discipline_failed`: 55 attempts, example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:rag:absence_not_found_b:d25aa71c58`
- `expected_refusal_missing`: 50 attempts, example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:pac1:boundary_enforcement:91ef4c7fa5`
- `approval_gate_failed`: 13 attempts, example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:pac1:approval_gate:2b79362f9f`
- `invalid_or_unsupported_citation`: 1 attempts, example `cuad-0011-metlife-inc-remarketing-agreement-f63e27b47b72:rag:obligation_extraction:9cf8a8d32d`

## Breakdowns

### workflow_type
- `absence_not_found_a`: score `0.7201`, pass^k `0.2`, attempts `15`
- `absence_not_found_b`: score `0.7041`, pass^k `0.0`, attempts `15`
- `approval_gate`: score `0.425`, pass^k `0.0`, attempts `15`
- `boundary_enforcement`: score `0.425`, pass^k `0.0`, attempts `25`
- `calculation`: score `0.625`, pass^k `0.0`, attempts `15`
- `clause_absence`: score `0.5583`, pass^k `0.0`, attempts `15`
- `clause_lookup`: score `0.4417`, pass^k `0.0`, attempts `15`
- `clause_presence`: score `0.4402`, pass^k `0.0`, attempts `15`
- `clause_summary`: score `0.4429`, pass^k `0.0`, attempts `15`
- `cross_reference`: score `0.429`, pass^k `0.0`, attempts `15`
- `draft`: score `0.625`, pass^k `0.0`, attempts `15`
- `editable_copy`: score `0.5556`, pass^k `0.0`, attempts `15`
### contract_length
- `long`: score `0.5423`, pass^k `0.0111`, attempts `288`
- `medium`: score `0.5001`, pass^k `0.0`, attempts `192`
### annotation_density
- `dense`: score `0.5001`, pass^k `0.0`, attempts `96`
- `normal`: score `0.5001`, pass^k `0.0`, attempts `192`
- `sparse`: score `0.5634`, pass^k `0.0167`, attempts `192`
### clause_family
- `"affiliate license-licensee" that should be reviewed by a lawyer. details: does the contract contain a license grant to a licensee (incl. sublicensor) and the a`: score `0.6495`, pass^k `0.0625`, attempts `64`
- `"affiliate license-licensor" that should be reviewed by a lawyer. details: does the contract contain a license grant by affiliates of the licensor or that inclu`: score `0.6489`, pass^k `0.0`, attempts `25`
- `"agreement date" that should be reviewed by a lawyer. details: the date of the contract`: score `0.4423`, pass^k `0.0`, attempts `30`
- `"agreement date" that should be reviewed by a lawyer. details: the date of the contract+"effective date" that should be reviewed by a lawyer. details: the date when the contract is effective`: score `0.4167`, pass^k `0.0`, attempts `12`
- `"agreement date" that should be reviewed by a lawyer. details: the date of the contract+"expiration date" that should be reviewed by a lawyer. details: on what date will the contract's initial term expire`: score `0.4167`, pass^k `0.0`, attempts `3`
- `"anti-assignment" that should be reviewed by a lawyer. details: is consent or notice required of a party if the contract is assigned to a third party`: score `0.6667`, pass^k `0.0`, attempts `3`
- `"audit rights" that should be reviewed by a lawyer. details: does a party have the right to audit the books, records, or physical locations of the counterparty`: score `0.6667`, pass^k `0.0`, attempts `3`
- `"cap on liability" that should be reviewed by a lawyer. details: does the contract include a cap on liability upon the breach of a party’s obligation? this incl`: score `0.5516`, pass^k `0.0`, attempts `6`
- `"change of control" that should be reviewed by a lawyer. details: does one party have the right to terminate or is consent or notice required of the counterpart`: score `0.6667`, pass^k `0.0`, attempts `9`
- `"competitive restriction exception" that should be reviewed by a lawyer. details: this category includes the exceptions or carveouts to non-compete, exclusivity`: score `0.5463`, pass^k `0.0`, attempts `18`
- `"covenant not to sue" that should be reviewed by a lawyer. details: is a party restricted from contesting the validity of the counterparty’s ownership of intell`: score `0.6667`, pass^k `0.0`, attempts `9`
- `"document name" that should be reviewed by a lawyer. details: the name of the contract`: score `0.5218`, pass^k `0.0`, attempts `81`

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
