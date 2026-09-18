# ContractSense PAC

PAC-style benchmark for the ContractSense agent.

This is a local deterministic benchmark world inspired by BitGN PAC1. It does
not require MongoDB or the FastAPI app. The runner gives an LLM a seeded
contract workspace, exposes typed tools, records side effects, and scores the
final answer plus tool behavior.

The v1 suite is intentionally multi-axis: it checks whether an agent can answer
contract questions, cite evidence, create side-effecting work products, perform
simple invoice arithmetic, refuse unsafe vendor requests, and handle legal
workflow categories commonly used in legal-agent benchmarks.

It now reports by the explicit PAC1 and MikeOSS-style parameters from the
benchmark notes, not only by internal scoring dimensions.

## Run

```bash
cd apps/backend
python ../../testing/backend/scripts/contract_agent_pac_benchmark.py
```

The default runner is the synthetic PAC tool-loop agent. To evaluate the real
ContractSense RAG agent core against the same seeded world, run:

```bash
cd apps/backend
poetry run python ../../testing/backend/scripts/contract_agent_pac_benchmark.py --runner contractsense --output /tmp/contractsense-pac-contractsense-report.json
```

`--runner contractsense` calls the production `ContractRAGSystem` answer path
with the benchmark world loaded as indexed project documents, then translates
observed citations, calculations, and work products into the PAC scorer.

The runner uses an OpenAI-compatible chat endpoint:

- `OPENAI_BASE_URL`, default `https://api.groq.com/openai/v1`
- `OPENAI_API_KEY`, or `GROQ_API_KEY`
- `MODEL_ID`, default `openai/gpt-oss-120b`

It loads the existing backend `.env` by default before reading those values.
Pass `--env-file /path/to/env` only when you intentionally want another file.

Use `--list-tasks` to inspect the suite and `--task TASK_ID` to run one task.

Write a full JSON report with:

```bash
cd apps/backend
python ../../testing/backend/scripts/contract_agent_pac_benchmark.py --output /tmp/contractsense-pac-report.json
```

## Tools

- `list_documents`: inspect the seeded workspace.
- `search_contracts`: retrieve likely evidence sections.
- `read_section`: read a specific cited source section.
- `get_kpis`: inspect seeded KPI breach state.
- `calculate_service_credit`: perform invoice/service-credit arithmetic.
- `draft_notice`: create a breach notice artifact.
- `create_checklist`: create an internal checklist artifact.
- `answer`: finish with outcome, message, and evidence refs.

## PAC1 Parameters

Each task is mapped to one or more PAC1-style parameters:

- `vault_retrieval`: can the agent find the right contract, section, policy, invoice, message, or note?
- `receipts_and_invoices`: can it aggregate invoice evidence and calculate correctly?
- `project_memory`: can it infer the right project/entity from partial context?
- `messaging`: can it process incoming/outgoing communication safely?
- `prompt_injection`: can it reject malicious instructions from untrusted content?
- `boundary_enforcement`: can it avoid overreach, leakage, or unsafe actions?

The JSON report includes `summary.by_pac1_parameter`.

## MikeOSS Parameters

Each task is also mapped to MikeOSS-style methodology/condition labels:

- `recursive_agentic_orchestration`
- `multi_model_legal_cognition_pathways`
- `ai_native_benchmark_enhancement`
- `enterprise_grade_chart_smoothing`
- `strategic_category_weighting`
- `advanced_decimal_point_optimisation`
- `reviewing_documents_moments_before_signing`
- `producing_summaries_no_one_reads`
- `turning_simple_workflows_into_platforms`
- `renaming_existing_features_with_word_agentic`
- `generating_benchmark_pdfs_with_dark_blue_gradients`

The MikeOSS article is satirical, so the names are preserved as benchmark
metadata, while the scoring remains deterministic and evidence-based. The JSON
report includes `summary.by_mikeoss_parameter`.

## Scoring

Each task is scored with weighted checks across these dimensions:

- `completion`: correct outcome and required facts.
- `evidence`: required refs, refs observed in tool output, and citation discipline.
- `process`: required tool path and required source reads.
- `side_effects`: created drafts/checklists, content, and artifact refs.
- `trustworthiness`: no forbidden tools or confidential leakage.
- `legal_quality`: legal workflow vocabulary and category-specific substance.
- `efficiency`: tool-call budget and no excessive repetition.

The pass threshold is `0.95`, so partial credit is visible but not enough to
hide a meaningful failure. The report includes aggregate score by task category,
aggregate score by scoring dimension, PAC1 parameter, MikeOSS parameter, and top
failure modes.

## Categories

The seeded v1 suite covers:

- Summarizing documents
- Contract analysis
- Extracting information and data
- Comparison and benchmarking
- Regulatory tracking
- Legal strategy
- Drafting
- Risk assessment
- Trustworthiness
- Checklists
- Project memory
