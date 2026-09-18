# Full Evaluation Contract Fixtures

This folder contains five long-form contracts designed for full backend
evaluation of the contract-agent system.

The contracts are intentionally dense. Each one includes:

- key dates and renewal/termination windows
- KPI targets, thresholds, scoring bands, and monetary penalties
- reporting obligations with exact deadlines
- audit rights and records-retention duties
- security, privacy, or operational compliance duties
- insurance, indemnity, limitation of liability, and step-in/transition clauses
- clause references suitable for exact section lookup
- enough cross-cutting content for compound questions

## Contracts

| Contract ID | Domain | File |
|---|---|---|
| `full_eval_global_logistics` | Logistics | `01_global_logistics_master_services_agreement.md` |
| `full_eval_healthcare_cloud` | Healthcare cloud/data processing | `02_healthcare_cloud_data_processing_agreement.md` |
| `full_eval_solar_storage_epc` | Renewable energy EPC/O&M | `03_solar_storage_epc_and_operations_contract.md` |
| `full_eval_payment_processing` | Payment processing/fintech | `04_payment_processing_platform_agreement.md` |
| `full_eval_smart_transit` | Public transit concession | `05_smart_transit_operations_concession.md` |
| `full_eval_telecom_5g` | Telecom / 5G Edge Infrastructure | `06_telecom_5g_network_managed_services_agreement.md` |
| `full_eval_pharma_cdmo` | Biotech / Pharmaceutical CDMO | `07_pharmaceutical_contract_development_manufacturing_agreement.md` |
| `full_eval_enterprise_ai` | Enterprise AI Supercomputing | `08_enterprise_ai_cloud_infrastructure_master_agreement.md` |

Use `manifest.json` for evaluator discovery and expected truth anchors.

## Intended Evaluation Coverage

These fixtures are suitable for testing:

- `SUMMARY`
- `CLAUSE_LOOKUP`
- `KPI_QUERY`
- `OBLIGATION_TRACK`
- `RISK_ANALYSIS`
- `COMPLIANCE`
- key date extraction
- exact numeric value extraction
- citation grounding
- tool-level retrieval checks
- compound multi-agent orchestration

Generated UI, SVG, chart rendering, and browser visual evaluation are
intentionally excluded.
