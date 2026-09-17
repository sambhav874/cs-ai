# Contract Sense — Enterprise Contract KPI System Documentation

This document provides an exhaustive reference for the Contract KPI System within the `extractor` codebase. It covers system architecture, module structures, database schemas (legacy V1 and versioned V2 FlexField model), rule specifications, extraction algorithms, automated evaluation, source ingestion, and REST API interfaces.

---

## 1. System Overview & Component Directory

The KPI system is designed to automatically extract key performance indicators (KPIs), service level agreements (SLAs), and legal obligations from complex contracts, structure them into machine-evaluable rule models, ingest actual operational metric data, evaluate compliance deterministically, and trigger breach notifications.

```
                               ┌─────────────────────────┐
                               │     Contract PDF/MD     │
                               └────────────┬────────────┘
                                            │
                                            ▼
                               ┌─────────────────────────┐
                               │ RAG Segmenter & Vector  │
                               │  Candidate Extractor    │
                               └────────────┬────────────┘
                                            │
                                            ▼
                               ┌─────────────────────────┐
                               │  LLM Harvester & Spec   │
                               │   Validation (v1/v2)    │
                               └────────────┬────────────┘
                                            │
                                            ▼
 ┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐
 │ External Data Sources   │ ─►│ Source Ingestion Engine │ ─►│  MongoDB Storage        │
 │ (CSV, REST, SAP, etc.)  │   │  & Field Mapping       │   │  (contract_kpis, etc.)  │
 └─────────────────────────┘   └─────────────────────────┘   └────────────┬────────────┘
                                                                          │
                                                                          ▼
                                                             ┌─────────────────────────┐
                                                             │  Deterministic Rule     │
                                                             │   Evaluation Engine     │
                                                             └────────────┬────────────┘
                                                                          │
                                                                          ▼
                                                             ┌─────────────────────────┐
                                                             │ Breach Management &     │
                                                             │ Notification System     │
                                                             └─────────────────────────┘
```

### Module Map

| Module Path | Primary Responsibility | Key Classes & Functions |
| :--- | :--- | :--- |
| [kpi_manager.py](file:///Users/sambhavjain/Desktop/Codes/extractor/extractor/apps/backend/services/kpi_manager.py) | Main orchestration service for KPI extraction, CRUD operations, deterministic evaluation, breach management, and email notifications. | `ContractKPIManager`, `extract_for_contract`, `evaluate_kpi`, `flag_breach_remediation_email`, `_load_candidate_chunks` |
| [kpi_schema.py](file:///Users/sambhavjain/Desktop/Codes/extractor/extractor/apps/backend/services/kpi_schema.py) | **(NEW V2 Schema Layer)** Data models, JSON schema validation, safe AST formula parser, DAG dependency resolution, migration shims. | `validate_rule_spec`, `evaluate_safe_formula`, `detect_composite_cycle`, `KPISchemaV1toV2Migrator`, `flatten_for_legacy_frontend` |
| [kpi_source_ingestion.py](file:///Users/sambhavjain/Desktop/Codes/extractor/extractor/apps/backend/services/kpi_source_ingestion.py) | Ingests metric data from external connectors (REST, CSV, ERP, Webhooks), validates security bounds, maps fields to KPI schema. | `KpiSourceIngestionService`, `ingest_from_config`, `validate_source_payload`, `_fetch_rest_profile_source` |
| [kpis.py](file:///Users/sambhavjain/Desktop/Codes/extractor/extractor/apps/backend/api/routes/kpis.py) | FastAPI routing layer exposing REST endpoints for frontend & integration clients. Performs RBAC, rate limiting, and audit logging. | `kpis_router`, `KPIUpdateRequest`, `ingest_kpi_actuals_file`, `evaluate_kpi_route`, `upsert_kpi_source_config` |
| [executor.py](file:///Users/sambhavjain/Desktop/Codes/extractor/extractor/apps/backend/services/contract_agent/graph/tools/executor.py) | Tool execution module for the AI contract agent. Performs numerical calculation and safe formula evaluation. | `_calculate_from_evidence` |
| [migrate_kpi_schema_v2.py](file:///Users/sambhavjain/Desktop/Codes/extractor/extractor/scripts/migrate_kpi_schema_v2.py) | **(NEW Migration Script)** Batch CLI script to migrate MongoDB v1 flat KPI documents to v2 nested shape with checkpointing. | `main`, `MigratorRunner` |

---

## 2. Database Collection Schemas

The system utilizes four main MongoDB collections: `contract_kpis`, `kpi_actuals`, `kpi_breaches`, and `kpi_source_configs`.

### 2.1 Schema Version 1 (Legacy Flat Model)

In Schema Version 1 (`schema_version = 1`), KPI documents in `contract_kpis` store all properties in a single flat structure with approximately 60 top-level fields:

```json
{
  "_id": "ObjectId(...)",
  "kpi_id": "kpi_a1b2c3d4e5f6",
  "schema_version": 1,
  "contract_id": "contract-99",
  "project_id": "project-01",
  "contract_name": "Master_Services_Agreement.pdf",
  "name": "On-Time Delivery Rate",
  "description": "Supplier must maintain monthly on-time delivery across all regional hubs.",
  "kpi_type": "sla",
  "party": "Supplier",
  "operator": ">=",
  "value": 98.5,
  "unit": "%",
  "value_min": null,
  "value_max": null,
  "threshold_min": null,
  "threshold_max": null,
  "target_value": 98.5,
  "baseline": 95.0,
  "benchmark": 99.0,
  "direction": "higher_is_better",
  "period_type": "monthly",
  "evaluation_window": "rolling_30d",
  "frequency": "monthly",
  "aggregation_type": "avg",
  "rule_type": "threshold",
  "consequence_value": 5000.0,
  "consequence_unit": "USD",
  "trigger_condition": "actual < target_value for 1 billing cycle",
  "remediation": "Issue service credit on next invoice.",
  "remediation_sla": "15 business days",
  "contact_email": "notices@supplier.com",
  "business_owner": "Ops Lead",
  "technical_owner": "Data Team",
  "responsible_party": "Logistics Mgr",
  "tracking_status": "tracked",
  "is_tracked": true,
  "status": "active",
  "confidence_score": 0.95,
  "recommendation_reason": "Contains explicit measurable threshold (98.5%) and penalty clause.",
  "is_recommended": true,
  "source_clause": "Section 4.2: Supplier guarantees 98.5% on-time delivery...",
  "section_path": "Exhibit B > Service Levels > Delivery",
  "page_start": 12,
  "page_end": 13,
  "source_chunk_id": "chunk-8812",
  "post_extraction_ai_allowed": false,
  "breach_evaluation_mode": "deterministic_rule_engine",
  "evaluation_rule": {
    "rule_type": "threshold",
    "operator": ">=",
    "target": 98.5,
    "unit": "%",
    "evaluation_window": "rolling_30d",
    "aggregation": "avg",
    "ai_used": false
  },
  "created_at": "2026-07-29T10:00:00Z",
  "created_by": "user-123",
  "updated_at": "2026-07-29T10:00:00Z",
  "updated_by": "user-123"
}
```

---

### 2.2 Schema Version 2 (Layered FlexField Rule Model)

Schema Version 2 (`schema_version = 2`) restructures the document into clear logical sub-objects (**identity**, **rule**, **consequence**, **governance**, **custom_attributes**).

```json
{
  "kpi_id": "kpi_a1b2c3d4e5f6",
  "schema_version": 2,
  "identity": {
    "name": "On-Time Delivery Rate",
    "kpi_type": "sla",
    "canonical_metric_key": "on_time_delivery_rate",
    "party": "Supplier",
    "business_owner": "Ops Lead",
    "contract_id": "contract-99",
    "project_id": "project-01",
    "contract_name": "Master_Services_Agreement.pdf",
    "source_clause": {
      "quote": "Supplier guarantees 98.5% on-time delivery...",
      "page_start": 12,
      "page_end": 13,
      "section_path": "Exhibit B > Service Levels > Delivery",
      "source_chunk_id": "chunk-8812"
    }
  },
  "rule": {
    "rule_type": "threshold",
    "operator": ">=",
    "unit": "%",
    "period_type": "monthly",
    "evaluation_window": "rolling_30d",
    "aggregation": "avg",
    "spec": {
      "target": 98.5
    }
  },
  "consequence": {
    "value": 5000.0,
    "unit": "USD",
    "trigger_condition": "actual < target_value for 1 billing cycle",
    "remediation": "Issue service credit on next invoice.",
    "remediation_sla": "15 business days",
    "contact_email": "notices@supplier.com"
  },
  "governance": {
    "status": "tracked",
    "confidence": 0.95,
    "needs_review": false,
    "version": 1,
    "is_recommended": true,
    "recommendation_reason": "Contains explicit measurable threshold (98.5%).",
    "created_at": "2026-07-29T10:00:00Z",
    "created_by": "user-123",
    "updated_at": "2026-07-29T10:00:00Z",
    "updated_by": "user-123"
  },
  "custom_attributes": {
    "cost_center": "CC-4091",
    "region": "EMEA"
  }
}
```

---

## 3. Rule Types & Specification Shapes (`rule.spec`)

Every KPI document defines a `rule.rule_type` with a strictly typed `rule.spec` dictionary. The supported rule types and their specifications are detailed below:

### 3.1 `threshold`
Used for standard directional single-target metrics (e.g. Uptime $\ge 99.9\%$, MTTR $\le 4\text{h}$).

```json
{
  "rule_type": "threshold",
  "operator": ">=",
  "unit": "%",
  "spec": {
    "target": 99.9
  }
}
```
* **Validation Rules**: `target` must be numeric.

---

### 3.2 `range`
Used for metrics bounded by minimum and maximum acceptable values (e.g. Operating Temperature $18^\circ\text{C} - 24^\circ\text{C}$).

```json
{
  "rule_type": "range",
  "operator": "between",
  "unit": "celsius",
  "spec": {
    "min": 18.0,
    "max": 24.0
  }
}
```
* **Validation Rules**: `min < max`.

---

### 3.3 `tiered`
Used for multi-level SLA penalty/credit structures with progressive funding percentages or flat penalty amounts.

```json
{
  "rule_type": "tiered",
  "operator": "tiered",
  "unit": "%",
  "spec": {
    "tiers": [
      { "level": "Tier 1", "value": 98.0, "funding_pct": 100.0 },
      { "level": "Tier 2", "value": 95.0, "funding_pct": 90.0 },
      { "level": "Tier 3", "value": 90.0, "funding_pct": 75.0 }
    ],
    "interpolation": "step",
    "modifiers": [
      { "modifier_id": "repeat_offender", "applies_as": "multiplier", "ref_kpi_id": "kpi_prev_breach" }
    ]
  }
}
```
* **Validation Rules**: Tiers must be non-empty, sorted in ascending order of `value`, with no overlapping boundaries. `interpolation` must be `"linear"` or `"step"`.

---

### 3.4 `deadline`
Used for date-driven milestone deliverables and compliance deadlines.

```json
{
  "rule_type": "deadline",
  "operator": "<=",
  "unit": "days",
  "spec": {
    "target_date_field": "deliverable_completion_date",
    "grace_days": 5
  }
}
```
* **Validation Rules**: `grace_days >= 0`, `target_date_field` must be a valid field key.

---

### 3.5 `composite`
Used for KPIs derived mathematically from other KPIs (e.g. Overall SLA Score = $0.6 \times \text{Availability} + 0.4 \times \text{Performance}$).

```json
{
  "rule_type": "composite",
  "operator": "formula",
  "unit": "score",
  "spec": {
    "formula": "0.6 * kpi_avail + 0.4 * kpi_perf",
    "ref_kpi_ids": ["kpi_avail", "kpi_perf"],
    "cross_contract": false
  }
}
```
* **Validation Rules**: Formula must parse successfully using the restricted AST parser. All `ref_kpi_ids` must exist within the contract (unless `cross_contract: true`). Must pass **DAG Cycle Validation** (no circular dependencies).

---

### 3.6 `error_budget`
Used for reliability metrics that track permissible failure counts or percentage budgets.

```json
{
  "rule_type": "error_budget",
  "operator": "<=",
  "unit": "occurrences",
  "spec": {
    "budget": 5.0
  }
}
```
* **Validation Rules**: `budget != 0`.

---

### 3.7 `evidence`
Used for compliance checks verified by document artifacts or boolean flag assertions.

```json
{
  "rule_type": "evidence",
  "operator": "==",
  "unit": "boolean",
  "spec": {
    "expected": true
  }
}
```
* **Validation Rules**: `expected` must be a boolean or string value.

---

### 3.8 `qualitative`
Used for legal obligations that state non-quantifiable standards (e.g. *"Contractor shall use commercially reasonable efforts to minimize disruption"*).

```json
{
  "rule_type": "qualitative",
  "operator": "qualitative",
  "unit": "text",
  "spec": {
    "description": "Contractor shall use commercially reasonable efforts to minimize operational disruption during system maintenance."
  }
}
```
* **Validation Rules**: `description` must be a non-empty string.
* **Evaluation Behavior**: **Explicitly Non-Evaluable**. Calling `evaluate_kpi` on a qualitative KPI returns HTTP 400 / ValueError (*"This KPI requires human judgment and cannot be auto-evaluated"*).

---

## 4. Extraction & Harvesting Pipeline

The KPI system uses a **100% LLM-Driven 3-Stage Pipeline** in [kpi_manager.py](file:///Users/sambhavjain/Desktop/Codes/extractor/extractor/apps/backend/services/kpi_manager.py) to extract, structure, and consolidate KPIs across all contract domains with zero hardcoded keyword whitelists or heuristic regex filters:

```
  Raw Contract Chunks (Vector Store / Document Index)
                        │
                        ▼
 ┌──────────────────────────────────────────────────────────┐
 │ STAGE 1: LLM Candidate Verification Pass                 │
 │ Micro-batches run in parallel to evaluate legal intent  │
 │ across all clauses, filtering non-operational text       │
 └──────────────────────────┬───────────────────────────────┘
                            │ Verified Operational KPI Clauses
                            ▼
 ┌──────────────────────────────────────────────────────────┐
 │ STAGE 2: Deep V2 KPI & Tier Extraction                   │
 │ Model extracts V2 schema fields (identity, rule, spec,   │
 │ consequence, tiers, custom_attributes) natively in JSON │
 └──────────────────────────┬───────────────────────────────┘
                            │ Raw Extracted V2 KPI Cards
                            ▼
 ┌──────────────────────────────────────────────────────────┐
 │ STAGE 3: LLM Consolidation & Deduplication Pass          │
 │ Model merges duplicates across chunk boundaries & ranks   │
 └──────────────────────────┬───────────────────────────────┘
                            │
                            ▼
           Stored in MongoDB `contract_kpis`
```

### Pipeline Stage Details

1. **Stage 1: High-Recall Candidate Verification (`_filter_kpi_candidates_with_llm`)**:
   - Micro-batches of 15 candidate clauses are evaluated in parallel (`ThreadPoolExecutor`).
   - The LLM classifies operational controls, SLAs, targets, penalties, and payment milestones vs administrative preambles, legal headers, and signature lines based on semantic legal intent.
   - Eliminates fragile keyword lists (`KPI_KEYWORDS`, `KPI_CONTEXT_TERMS`, `NON_OPERATIONAL_NUMBER_TERMS`).

2. **Stage 2: Deep V2 KPI & Tier Structuring (`_extract_batch_llm_rows` & `_kpi_from_llm_row`)**:
   - The LLM extracts structured JSON objects directly mapped to V2 Schema specifications.
   - Infers `kpi_type`, `operator`, `value`, `unit`, `consequence_value`, `remediation`, `remediation_sla`, and `target_schedule` (multi-tier SLA penalty matrices).
   - Dynamically extracts domain custom attributes: `measurement_scope`, `measurement_window`, and `monetary_penalty_schedule`.
   - Validates candidate quotes with contiguous substring checking (`_validated_quote`).

3. **Stage 3: LLM Post-Extraction Consolidation (`_consolidate_kpis_with_llm`)**:
   - Analyzes extracted cards to merge duplicate KPIs extracted across overlapping chunk boundaries.
   - Prefers tiered-schedule representations over simple thresholds when merging matching metrics.
   - Cleans leading markdown table header noise and section title prefixes for publication-grade display.

---

## 5. Source Ingestion Engine & Connector Catalog

The system ingests actual KPI measurements from external systems via `KpiSourceIngestionService` in [kpi_source_ingestion.py](file:///Users/sambhavjain/Desktop/Codes/extractor/extractor/apps/backend/services/kpi_source_ingestion.py).

### Supported Source Connector Families

```
  File Sources           API Sources           Stream Sources        Database / Warehouse
  ────────────           ───────────           ──────────────        ────────────────────
  - CSV Upload           - Generic REST        - Webhooks            - PostgreSQL
  - Excel (.xlsx)        - SAP S/4HANA         - Kafka Topics        - MySQL
  - JSON File            - Oracle Fusion                             - SQL Server
  - XML Feed             - NetSuite                                  - Snowflake
                         - Salesforce                                - BigQuery
                         - ServiceNow                                - Amazon Redshift
                         - Jira Service Mgmt
                         - Zendesk
```

### Ingestion Security & Safeguards
* **SSRF Protection**: Validates all outbound REST URLs against private IP ranges (blocks `127.0.0.1`, `10.0.0.0/8`, `169.254.169.254`, AWS metadata IP).
* **XML / Excel Bomb Prevention**: Restricts decompressed ZIP entries in `.xlsx` files to $\le 128$ members and total uncompressed size to $\le 10\text{ MB}$.
* **Max Payload Limits**: Enforces a strict maximum upload size of $5\text{ MB}$ and $5000$ rows per batch.

---

## 6. Evaluation & Breach Lifecycle

### 6.1 Evaluation Engine (`evaluate_kpi`)

When metric actuals are ingested, `evaluate_kpi` evaluates compliance against the KPI's rule specification:

1. **Verification**: Checks if `is_tracked == True`. If untracked, defers evaluation and records the actual measurement.
2. **Aggregation**: Aggregates historic sample data over the defined `evaluation_window` (e.g. `avg`, `sum`, `min`, `max`, `count` over YTD or Rolling 30 Days).
3. **Breach Determination**:
   * For `threshold`: Compares actual aggregated value against `target` using `operator` (`>=`, `<=`, `>`, `<`, `==`).
   * For `range`: Checks if `min <= actual <= max`.
   * For `tiered`: Matches actual value against tier thresholds to calculate funding percentage and penalty credits.
   * For `composite`: Evaluates the safe AST formula after verifying all dependency KPIs have evaluated values.
   * For `qualitative`: Rejects evaluation with an explicit error.
4. **Breach Record Generation**: If a breach occurs, inserts a document into `kpi_breaches`.

### 6.2 Remediation & Email Escalation (`flag_breach_remediation_email`)

When a breach is flagged for remediation notification:
1. Recipient email is selected using hierarchical lookup:
   - Primary: `kpi.contact_email`
   - Secondary: `contract.parties` matching the responsible role (e.g. `supplier.ops@example.com`)
   - Fallback: General contract notice email in index content.
2. Rendered template email is generated containing actual value, threshold, penalty amount, and remediation SLA deadline.

---

## 7. REST API Reference Guide

Base Path: `/api`

### KPI Management Endpoints

| Method | Endpoint | Description | Request Payload | Response |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/contracts/{contract_id}/kpis/extract` | Trigger AI KPI extraction for a contract. | `KPIExtractionRequest` | List of extracted KPI candidate objects |
| `GET` | `/api/contracts/{contract_id}/kpis` | List all KPIs for a contract. | Query params (`status`, `is_tracked`) | List of KPI documents |
| `GET` | `/api/kpis/{kpi_id}` | Get a single KPI document by ID. | - | KPI document |
| `PUT` | `/api/kpis/{kpi_id}` | Update a KPI document (triggers rule validation). | `KPIUpdateRequest` | Updated KPI document |
| `DELETE` | `/api/kpis/{kpi_id}` | Delete a KPI document. | - | `{"message": "KPI deleted"}` |

### Actuals & Ingestion Endpoints

| Method | Endpoint | Description | Request Payload | Response |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/contracts/{contract_id}/kpis/actuals/upload` | Upload CSV/XLSX file of KPI actual measurements. | `multipart/form-data` | `{"count": N, "breaches": [...], "deferred": [...]}` |
| `POST` | `/api/kpis/{kpi_id}/evaluate` | Manually evaluate a KPI against an actual value. | `{"actual_value": 94.2, ...}` | Breach evaluation result |

### Source Connector Endpoints

| Method | Endpoint | Description | Request Payload | Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/kpi-sources/catalog` | Get catalog of supported external connectors. | - | List of connector descriptions |
| `POST` | `/api/contracts/{contract_id}/kpi-sources` | Create/Update external source connector config. | Source config payload | Saved source config object |
| `POST` | `/api/kpi-sources/{config_id}/sync` | Manually trigger sync execution for a source config. | - | Sync summary & ingested row count |

---

## 8. Exhaustive Field-by-Field & Frontend UI Reference ("Review & Track" Tab)

This section maps every data field in the KPI schema to its exact representation and operational function in the frontend **Review & Track** tab ([panes.tsx: KpiReviewDashboardView](file:///Users/sambhavjain/Desktop/Codes/extractor/extractor/apps/frontend/components/contracts/panes.tsx#L1231) and [ProjectKPIWorkspace.tsx](file:///Users/sambhavjain/Desktop/Codes/extractor/extractor/apps/frontend/components/dashboard/ProjectKPIWorkspace.tsx)).

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│  REVIEW & ACTIVATE TAB                                                                           │
│  [3 Accepted]  [2 Tracked]  [1 Deferred]  [4 Pending]              [Accept All] [Track Rec.]    │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │  KPI-01   [Needs Review]   [Tracked]   [Recommended]   [2 Backfilled]                        │ │
│ │  On-Time Delivery Rate                                                                       │ │
│ │  Exhibit B > Service Levels > Delivery                                                        │ │
│ │                                                                                              │ │
│ │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                  │ │
│ │  │ THRESHOLD    │  │ PENALTY       │  │ OWNER         │  │ SOURCE        │                  │ │
│ │  │ ≥ 98.5%      │  │ $5,000 USD    │  │ Supplier      │  │ SAP Dispatch  │                  │ │
│ │  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘                  │ │
│ │                                                                                              │ │
│ │  [ Accept ]  [ Track ]  [ Remove ]                                        [ Clause Citation ]│ │
│ └──────────────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 8.1 Identity & Metadata Fields

| Field Name | Type | Description | Frontend UI Location ("Review & Track" Tab) |
| :--- | :--- | :--- | :--- |
| `kpi_id` | `string` | Unique identifier generated during extraction (e.g. `kpi_a1b2c3d4`). | Rendered in monospace font as display code tag (e.g., `KPI-01` or `kpi_a1b2c...`) in card headers and project grid rows. |
| `name` | `string` | Human-readable title of the metric or obligation (e.g. *"On-Time Delivery Rate"*). | **Primary Card Heading** (bold text, line-clamp 2). |
| `kpi_type` | `string` | Category classification (`sla`, `kpi`, `financial`, `penalty`, `compliance`, `milestone`). | Used for filter dropdowns and visual icon coloring (e.g. SLA badge vs Financial badge). |
| `canonical_metric_key` | `string` | Standardized slugified key (e.g. `on_time_delivery_rate`) used for automatic source mapping. | Shown in source mapping modal for auto-matching incoming API JSON keys. |
| `party` / `responsible_party` | `string` | Legal entity or contractual role obligated to meet the KPI (e.g. *"Supplier"*, *"Contractor"*). | Displayed in **Owner Card Field** (`KpiCardField: Owner`). Defaults to *"Not specified"* if missing. |
| `business_owner` / `technical_owner` | `string` | Internal organizational leads responsible for monitoring. | Rendered in expanded detail drawer for escalation assignment. |
| `contract_id` / `contract_name` | `string` | Parent contract identifier and original file name. | Subtitle text on project-level KPI workspace rows; links card to contract view. |

---

### 8.2 Citation & Source Clause Fields

| Field Name | Type | Description | Frontend UI Location ("Review & Track" Tab) |
| :--- | :--- | :--- | :--- |
| `source_clause` / `quote` | `string` | Verbatim excerpt extracted directly from the contract text. | Rendered in the **Expanded Detail Drawer** under `Source Text` block. |
| `section_path` / `structural_path` | `string` | Breadcrumb hierarchy of document headings (e.g. *"Exhibit B > Service Levels > Section 4.2"*). | Rendered below the main title as a muted sub-line text. |
| `page_start` / `page_end` | `integer` | Page numbers in the source PDF where the clause appears. | Used by the **Clause** button (`ExternalLink` icon) to open the PDF viewer panel anchored to the exact page and highlighted box. |
| `source_chunk_id` | `string` | Vector store segment reference used for chunk audit tracing. | Inspector trace property shown in debug hover tooltip. |

---

### 8.3 Rule & Measurement Fields

| Field Name | Type | Description | Frontend UI Location ("Review & Track" Tab) |
| :--- | :--- | :--- | :--- |
| `operator` | `string` | Relational comparison operator (`>=`, `<=`, `>`, `<`, `==`, `between`, `tiered`). | Rendered together with value in the **Threshold Card Field** (e.g. `≥ 98.5%`). |
| `value` / `target_value` | `number \| string` | The numerical target or standard to achieve (e.g. `98.5`). | Formatted by `formatKpiValue()` into the **Threshold Card Field**. |
| `unit` | `string` | Measurement unit (`%`, `USD`, `hours`, `ms`, `days`, `count`). | Displayed beside the target value (e.g., `%` or `hours`). |
| `value_min` / `value_max` | `number` | Lower and upper bounds for `range` rule types. | Formatted as `18°C – 24°C` in the Threshold box. |
| `period_type` | `string` | Contractual measurement cadence (`per_event`, `daily`, `monthly`, `quarterly`, `annual`). | Displayed in the **Expanded Detail Drawer** under `Window` (e.g., *"Monthly"*). |
| `evaluation_window` | `string` | Calculation window (`current_record`, `rolling_30d`, `rolling_90d`, `ytd`, `mtd`). | Displayed in the **Expanded Detail Drawer** under `Window` (e.g., *"Rolling 30 Days"*). |
| `aggregation_type` | `string` | Function used to aggregate multiple sample actuals (`avg`, `sum`, `min`, `max`, `count`, `latest`). | Shown in rule configuration drawer when editing evaluation rules. |
| `rule.spec` | `object` | Typed rule specification payload (`threshold`, `tiered`, `composite`, `qualitative`, etc.). | Controls which custom input fields render when editing or reviewing the KPI rule. |

---

### 8.4 Consequence & Remedy Fields

| Field Name | Type | Description | Frontend UI Location ("Review & Track" Tab) |
| :--- | :--- | :--- | :--- |
| `consequence_value` | `number` | Monetary penalty amount, credit percentage, or rebate value. | Formatted by `formatConsequence()` in the **Penalty Card Field** (e.g., `$5,000.00`). |
| `consequence_unit` | `string` | Currency or credit unit (`USD`, `EUR`, `% invoice credit`). | Rendered alongside `consequence_value` in the Penalty box. |
| `trigger_condition` | `string` | Rule condition describing when penalty applies (e.g. *"actual < 95% for 2 consecutive cycles"*). | Subtext inside the Penalty card or expanded details. |
| `remediation` | `string` | Prescribed corrective action required by contractor upon breach. | Rendered in **Expanded Detail Drawer** under `Remediation`. |
| `remediation_sla` | `string` | Deadline window to perform remediation (e.g. *"15 business days"*). | Rendered alongside `remediation` in expanded drawer. |
| `contact_email` | `string` | Email address responsible for receiving automated breach notices. | Displayed under `Contact` in expanded detail drawer. |

---

### 8.5 Governance, Status & Tracking Badges

| Field Name | Type | Description | Frontend UI Location ("Review & Track" Tab) |
| :--- | :--- | :--- | :--- |
| `status` | `string` | Review workflow state (`draft`, `needs_review`, `approved`, `ignored`). | Renders the **Status Badge**: <br> • `Approved`: Green **Accepted** badge.<br> • `Needs Review`: Amber **Needs Review** badge.<br> • `Ignored`: Gray **Removed** badge. |
| `is_tracked` / `tracking_status` | `boolean \| string` | Flag indicating if deterministic rule evaluation & monitoring are active (`tracked` vs `recommended`). | Renders the **Tracking Status Pill**: <br> • `Tracked`: Green pill with `CheckCircle2` icon.<br> • `Not tracked`: Amber pill with `Play` tracking button. |
| `is_recommended` | `boolean` | AI heuristic flag denoting high-confidence, evaluable operational KPIs. | Renders the blue **Recommended** pill badge. |
| `recommendation_reason` | `string` | Explanation why AI recommended tracking this KPI. | Tooltip content when hovering over the Recommended badge. |
| `needs_review` | `boolean` | Indicates candidate requires human verification. | Highlights card container with subtle amber border glow. |
| `last_tracking_backfill` | `object` | Details on historical actuals evaluated upon activation (`created_breach_count`). | Renders purple **N backfilled** badge (e.g., `2 backfilled`) when historical breaches are generated on tracking start. |

---

### 8.6 Source Integration Mapping Fields

| Field Name | Type | Description | Frontend UI Location ("Review & Track" Tab) |
| :--- | :--- | :--- | :--- |
| `source_config_id` | `string` | ID of linked external data connector (`KPISourceConfig`). | Displayed in **Source Card Field** (e.g., *"SAP Dispatch · Hourly"*). |
| `source_config_status` | `string` | Connection health status (`configured`, `not_configured`, `syncing`, `error`). | Color-codes the Source Box border & tone: <br> • `Green`: Configured & healthy.<br> • `Amber`: Unconfigured/Manual upload.<br> • `Red`: Sync error. |
| `field_mappings` | `array` | Mapping between external payload keys and `actual_value`. | Configured via the `Actuals & Sources` modal drawer. |

