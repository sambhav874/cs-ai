# 03 — Data Model

## Schema Design Principles

1. **Multi-tenant by default**: every table has `org_id` as the first column in its primary key scope. PostgreSQL RLS policies enforce isolation.
2. **Soft deletes**: `deleted_at` timestamp on all core tables. Never hard delete contracts.
3. **Audit-ready**: `created_at`, `updated_at`, `created_by`, `updated_by` on every table.
4. **JSONB for flexible metadata**: contract-type-specific fields stored as JSONB to avoid schema changes per contract type.
5. **Version everything**: contracts, clauses, templates, and playbook positions are versioned. Current = latest version.
6. **UUID primary keys**: all IDs are UUIDs. No sequential integers exposed externally.

---

## Entity Relationship Overview

```
Organization ──1:N──► User
Organization ──1:N──► Contract
Organization ──1:N──► Template
Organization ──1:N──► ClauseLibraryItem
Organization ──1:N──► PlaybookPosition
Organization ──1:N──► WorkflowDefinition

User ──1:N──► ContractRequest (as requestor)
User ──N:M──► Role (via user_roles)

ContractRequest ──1:1──► Contract (once drafted)

Contract ──1:N──► ContractVersion (document versions)
Contract ──1:N──► Obligation
Contract ──1:N──► Comment
Contract ──1:N──► ApprovalInstance
Contract ──1:N──► SignatureRequest
Contract ──1:N──► AuditEvent
Contract ──N:1──► Counterparty
Contract ──N:1──► Template (source template)
Contract ──0:1──► Contract (parent — for amendments, OR binder split children)
Contract ──1:N──► Contract (split children — when binder PDF is split into N contracts)

Template ──1:N──► TemplateSection
TemplateSection ──N:1──► ClauseLibraryItem (optional clause reference)

PlaybookPosition ──N:1──► ClauseCategory

WorkflowDefinition ──1:N──► WorkflowNode
WorkflowDefinition ──1:N──► WorkflowEdge

ApprovalInstance ──1:N──► ApprovalStep
```

---

## Core Tables

### organizations

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | varchar(255) | |
| slug | varchar(100) UNIQUE | URL-friendly identifier |
| logo_url | text | |
| brand_colors | jsonb | `{ primary, secondary, accent }` |
| settings | jsonb | Org-level config: default timezone, date format, LLM preference |
| subscription_tier | enum | `free`, `pro`, `enterprise` |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### users

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| org_id | uuid FK → organizations | |
| email | varchar(255) | Unique within org |
| full_name | varchar(255) | |
| avatar_url | text | |
| auth_provider_id | varchar(255) | Auth0/Clerk external ID |
| preferences | jsonb | Notification prefs, default views, timezone, language |
| status | enum | `active`, `inactive`, `invited` |
| last_active_at | timestamptz | |
| created_at / updated_at | timestamptz | |

### roles

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| org_id | uuid FK | |
| name | varchar(100) | e.g., `Legal Counsel`, `Sales Rep`, `Admin` |
| description | text | |
| is_system | boolean | System roles cannot be deleted |
| permissions | jsonb | `{ contracts: { view, edit, delete, approve, sign }, templates: { view, edit }, ... }` |
| created_at / updated_at | timestamptz | |

### user_roles

| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid FK | |
| role_id | uuid FK | |
| granted_at | timestamptz | |
| granted_by | uuid FK → users | |

### counterparties

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| org_id | uuid FK | |
| name | varchar(255) | |
| legal_name | varchar(255) | |
| address | jsonb | `{ street, city, state, country, zip }` |
| contacts | jsonb | `[{ name, email, role, phone }]` |
| external_crm_id | varchar(255) | Salesforce/HubSpot record ID |
| metadata | jsonb | Industry, size, relationship tier |
| created_at / updated_at | timestamptz | |

---

## Contract Tables

### contract_requests

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Feature: IN-001 through IN-007 |
| org_id | uuid FK | |
| request_number | varchar(20) | Auto-generated: `REQ-2026-0001` |
| contract_type | varchar(50) | `nda`, `msa`, `sow`, `employment`, `vendor`, `custom` |
| counterparty_id | uuid FK | Nullable (may not be known yet) |
| requestor_id | uuid FK → users | |
| assigned_to | uuid FK → users | Legal team member |
| priority | enum | `standard`, `urgent`, `critical` |
| status | enum | `new`, `assigned`, `in_progress`, `drafted`, `completed`, `rejected` |
| source | enum | `web_form`, `chat`, `email`, `crm_trigger`, `slack` |
| description | text | Business context |
| key_terms | jsonb | `{ deal_value, effective_date, term_length, jurisdiction, region }` |
| attachments | jsonb | `[{ filename, s3_key, mime_type, size }]` |
| external_ref | jsonb | `{ crm_opportunity_id, deal_id }` |
| contract_id | uuid FK → contracts | Set once contract is created from this request |
| created_at / updated_at | timestamptz | |

### contracts

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Core entity |
| org_id | uuid FK | |
| contract_number | varchar(20) | Auto-generated: `CTR-2026-0001` |
| title | varchar(500) | |
| contract_type | varchar(50) | |
| status | enum | `draft`, `in_review`, `in_negotiation`, `pending_approval`, `approved`, `pending_signature`, `executed`, `active`, `expired`, `terminated`, `archived` |
| counterparty_id | uuid FK | |
| parent_contract_id | uuid FK → contracts | For amendments — links to parent |
| request_id | uuid FK → contract_requests | Originating request |
| template_id | uuid FK → templates | Template used to generate |
| created_by | uuid FK → users | |
| assigned_to | uuid FK → users | Current owner |
| current_version_id | uuid FK → contract_versions | Points to latest version |
| effective_date | date | |
| expiry_date | date | |
| termination_date | date | If terminated early |
| value | decimal(15,2) | Total contract value |
| currency | varchar(3) | `USD`, `EUR`, `GBP` |
| jurisdiction | varchar(100) | Governing law |
| analysis_status | enum | Pipeline stage: `PENDING`, `PARSING`, `CLASSIFYING`, `EXTRACTING`, `SPLITTING`, `INDEXING`, `DONE`, `FAILED` |
| risk_score | decimal(3,2) | 0.00 to 1.00, set by Review Agent Step 3 (Score) |
| summary | text | AI-generated contract summary |
| suggested_title | varchar(500) | AI-suggested title (replaces upload filename) |
| counterparty_name | varchar(255) | Promoted from extracted parties array |
| key_terms | jsonb | 14 generic extracted fields: `{ parties, effectiveDate, expiryDate, value, currency, governingLaw, noticePeriodDays, paymentTermsDays, autoRenew, exclusivity, liabilityCapAmount, ipOwnership, terminationRights, confidentiality }` |
| field_confidence | jsonb | Per-field evidence: `{ [fieldKey]: { confidence, quote, section, issue } }` — shown as dots in UI |
| tags | text[] | User-defined tags |
| external_refs | jsonb | `{ crm_id, erp_id, matter_id }` |
| metadata | jsonb | See **metadata key reference** below |
| created_at / updated_at / deleted_at | timestamptz | |

#### contracts.metadata — Key Reference

The `metadata` JSONB column has two categories of keys:

**Pipeline system keys (underscore-prefixed — written by workers):**

| Key | Written by | Value |
|-----|-----------|-------|
| `_totalPages` | `parse.worker.ts` | `number` — total PDF pages, used by detect-binder to compute last split range |
| `_binderDetected` | `agent.worker.ts` | `true` — set when LLM classifies doc as binder |
| `_suggestedSplits` | `agent.worker.ts` | `[{ title, type, pageStart, pageEnd }]` — LLM-suggested split specs |
| `_autoSplit` | `agent.worker.ts` | `true` — set when auto-split was applied |
| `_splitInto` | `parse.worker.ts` | `string[]` — child contract IDs after split completes |
| `_typeFields` | `review.py` → PATCH | `{ [fieldKey]: { value, confidence, quote, label } }` — type-specific extracted fields |
| `_aiFindings` | `review.py` → PATCH | `[{ key, label, value, confidence, quote }]` — open-ended LLM observations beyond defined schemas |
| `_aiClassification` | `agent.worker.ts` | `{ contractType, confidence, extractedTerms }` — intake classification result |

**Org custom field values (written by `review.py` PATCH):**

| Key | Value |
|-----|-------|
| `[fieldKey]` | Raw extracted value (string/number/boolean/array) matching the `contract_field_definitions.field_key` |

**Extraction bucket summary:**

| Where stored | What | Populated by |
|-------------|------|-------------|
| `contract.keyTerms` | 14 generic fields | Review Agent Step 2 (Validate) |
| `contract.metadata._typeFields` | Type-specific expert fields (NDA: 9, MSA: 11, SOW: 11, SLA: 11, EMPLOYMENT: 16, etc.) | `review.py` → PATCH |
| `contract.metadata[fieldKey]` | Org admin-defined custom fields from `contract_field_definitions` | `review.py` → PATCH |
| `contract.metadata._aiFindings` | Open-ended LLM observations | `review.py` → PATCH |

### contract_versions

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| contract_id | uuid FK | |
| version_number | integer | 1, 2, 3... |
| document_s3_key | varchar(500) | S3 key for the document file |
| document_format | enum | `docx`, `pdf`, `html` |
| document_content | text | Full text content (for search/extraction) |
| change_summary | text | AI-generated summary of changes from previous version |
| source | enum | `internal_draft`, `internal_edit`, `counterparty_redline`, `amendment` |
| created_by | uuid FK → users | Or agent ID |
| created_by_agent | varchar(50) | If created by agent: `draft_agent`, `redline_agent` |
| embedding | vector(1536) | pgvector embedding for semantic search |
| created_at | timestamptz | |

### contract_comments

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Feature: NG-003 |
| contract_id | uuid FK | |
| version_id | uuid FK → contract_versions | |
| parent_comment_id | uuid FK → contract_comments | For threaded replies |
| author_id | uuid FK → users | |
| clause_anchor | jsonb | `{ section, paragraph, start_offset, end_offset }` — position in document |
| content | text | Comment text |
| is_internal | boolean | true = only visible to internal team |
| is_resolved | boolean | |
| resolved_by | uuid FK → users | |
| created_at / updated_at | timestamptz | |

---

## Template & Clause Tables

### templates

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Feature: CFG-004 |
| org_id | uuid FK | |
| name | varchar(255) | |
| contract_type | varchar(50) | What type of contract this generates |
| description | text | |
| status | enum | `draft`, `active`, `retired` |
| version | integer | |
| usage_count | integer | How many contracts generated from this |
| usage_rules | jsonb | `{ allowed_roles: [], auto_select_conditions: {} }` |
| created_by | uuid FK | |
| approved_by | uuid FK | |
| created_at / updated_at | timestamptz | |

### template_sections

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| template_id | uuid FK | |
| section_order | integer | Display order |
| title | varchar(255) | Section heading |
| content_type | enum | `static_text`, `clause_reference`, `variable_field`, `conditional` |
| static_content | text | If `static_text` — the actual content |
| clause_id | uuid FK → clause_library_items | If `clause_reference` |
| variable_fields | jsonb | `[{ field_name, data_source, fallback_value }]` |
| conditions | jsonb | `{ show_if: { field: "deal_value", operator: ">", value: 100000 } }` |
| created_at / updated_at | timestamptz | |

### clause_categories

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| org_id | uuid FK | |
| parent_id | uuid FK → clause_categories | Tree structure |
| name | varchar(255) | e.g., `Liability`, `Indemnification`, `IP Rights` |
| path | ltree | Materialized path for efficient tree queries |
| sort_order | integer | |

### clause_library_items

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Feature: CFG-005 |
| org_id | uuid FK | |
| category_id | uuid FK → clause_categories | |
| name | varchar(255) | Short label |
| content | text | The clause language (rich text / HTML) |
| version | integer | |
| status | enum | `draft`, `approved`, `active`, `retired` |
| jurisdiction | varchar(100)[] | Applicable jurisdictions |
| contract_types | varchar(50)[] | Applicable contract types |
| usage_count | integer | |
| approved_by | uuid FK | |
| embedding | vector(1536) | For semantic search within clause library |
| created_at / updated_at | timestamptz | |

---

## Playbook Tables

### playbook_positions

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Feature: CFG-003 |
| org_id | uuid FK | |
| clause_category_id | uuid FK → clause_categories | |
| jurisdiction | varchar(100) | Null = global |
| preferred_language | text | Preferred position clause text |
| acceptable_language | text | Acceptable alternative |
| fallback_language | text | Last resort |
| walkaway_description | text | When to reject |
| risk_threshold | decimal(3,2) | Deviation score that triggers alert (0.0 - 1.0) |
| auto_counter_enabled | boolean | Can agent auto-generate counter without human? |
| notes | text | Internal notes for legal team |
| version | integer | |
| approved_by | uuid FK | |
| created_at / updated_at | timestamptz | |

---

## Workflow & Approval Tables

### workflow_definitions

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Feature: CFG-001, CFG-002 |
| org_id | uuid FK | |
| name | varchar(255) | |
| description | text | |
| applies_to | jsonb | `{ contract_types: [], regions: [], value_ranges: [] }` |
| status | enum | `draft`, `active`, `retired` |
| version | integer | |
| created_by | uuid FK | |
| created_at / updated_at | timestamptz | |

### workflow_nodes

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workflow_id | uuid FK | |
| node_type | enum | `start`, `approval`, `condition`, `notification`, `escalation`, `timer`, `end` |
| label | varchar(255) | |
| config | jsonb | Type-specific: `{ approver_role, approver_user_id, condition_expression, timer_hours, ... }` |
| position_x | integer | Canvas position for visual builder |
| position_y | integer | |

### workflow_edges

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workflow_id | uuid FK | |
| source_node_id | uuid FK → workflow_nodes | |
| target_node_id | uuid FK → workflow_nodes | |
| condition_label | varchar(255) | e.g., "Yes", "No", "Value > $1M" |
| condition_expression | jsonb | |

### approval_instances

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Feature: AP-001 through AP-007 |
| contract_id | uuid FK | |
| workflow_id | uuid FK → workflow_definitions | |
| status | enum | `pending`, `approved`, `rejected`, `cancelled` |
| initiated_by | uuid FK → users | |
| initiated_at | timestamptz | |
| completed_at | timestamptz | |
| current_node_id | uuid FK → workflow_nodes | Current position in workflow |

### approval_steps

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| approval_instance_id | uuid FK | |
| workflow_node_id | uuid FK | |
| approver_id | uuid FK → users | |
| delegated_from | uuid FK → users | If delegated |
| status | enum | `pending`, `approved`, `rejected`, `skipped`, `delegated` |
| decision_at | timestamptz | |
| comments | text | |
| agent_recommendation | jsonb | `{ action: "approve", confidence: 0.92, reasoning: "..." }` |

---

## Obligation Tables

### obligations

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Feature: PS-001 through PS-004 |
| org_id | uuid FK | |
| contract_id | uuid FK | |
| obligation_type | enum | `payment`, `delivery`, `sla`, `reporting`, `renewal`, `notice`, `custom` |
| title | varchar(500) | |
| description | text | |
| clause_reference | varchar(100) | e.g., "Section 5.2" |
| due_date | date | |
| recurrence | jsonb | `{ frequency: "monthly", day: 15, end_date }` or null for one-time |
| owner_id | uuid FK → users | |
| status | enum | `pending`, `approaching`, `overdue`, `completed`, `waived` |
| completion_evidence | jsonb | `{ type, s3_key, notes, verified_by, verified_at }` |
| financial_value | decimal(15,2) | If applicable |
| alert_rules | jsonb | `{ days_before: [30, 15, 7, 1], escalation_after_days: 3 }` |
| extracted_by_agent | boolean | True if AI-extracted, false if manually created |
| confidence_score | decimal(3,2) | If AI-extracted |
| created_at / updated_at | timestamptz | |

---

## Signature Tables

### signature_requests

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Feature: EX-001 through EX-006 |
| contract_id | uuid FK | |
| version_id | uuid FK → contract_versions | |
| provider | enum | `docusign`, `adobe_sign`, `internal` |
| external_envelope_id | varchar(255) | DocuSign/Adobe envelope ID |
| status | enum | `preparing`, `sent`, `viewed`, `partially_signed`, `completed`, `declined`, `voided` |
| signing_order | jsonb | `[{ signer_id, email, role, order, status, signed_at }]` |
| sent_at | timestamptz | |
| completed_at | timestamptz | |
| signed_document_s3_key | varchar(500) | |
| audit_trail_s3_key | varchar(500) | |
| reminder_config | jsonb | `{ interval_days: 3, max_reminders: 3 }` |
| created_at / updated_at | timestamptz | |

---

## Audit & Events

### audit_events

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Append-only — never update or delete |
| org_id | uuid | |
| event_type | varchar(100) | `contract.created`, `approval.completed`, etc. |
| actor_type | enum | `user`, `agent`, `system`, `external` |
| actor_id | varchar(255) | User ID or agent name |
| triggered_by_user_id | uuid | If agent action, which user triggered it |
| resource_type | varchar(50) | `contract`, `request`, `approval`, etc. |
| resource_id | uuid | |
| data | jsonb | Event-specific payload |
| ip_address | inet | |
| user_agent | text | |
| confidence_score | decimal(3,2) | For agent actions |
| timestamp | timestamptz | Indexed |

**Partitioned by month** for performance. Retention policy configurable per org.

---

## Integration Tables

### integration_connections

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Feature: CFG-006 |
| org_id | uuid FK | |
| provider | varchar(50) | `salesforce`, `sap`, `docusign`, `slack`, etc. |
| status | enum | `connected`, `disconnected`, `error` |
| credentials | jsonb (encrypted) | OAuth tokens, API keys (encrypted at rest) |
| field_mappings | jsonb | `{ our_field: their_field }` pairs |
| sync_config | jsonb | `{ direction, frequency, triggers }` |
| last_sync_at | timestamptz | |
| error_log | jsonb | Recent errors |
| created_at / updated_at | timestamptz | |

---

## Search & Extraction Tables

### contract_clauses

Stores per-clause embeddings for semantic search and RAG. Populated by the `chunk-and-index` + `embed-contract` BullMQ pipeline.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| version_id | uuid FK → contract_versions | |
| contract_id | uuid FK → contracts | Denormalized for query efficiency |
| org_id | uuid FK | For org-scoped search |
| clause_type | varchar(100) | e.g., `indemnification`, `termination`, `payment` |
| content | text | Clause text |
| embedding | vector(1536) | pgvector embedding (text-embedding-3-large) |
| embedded_at | timestamptz | |
| char_start | integer | Character offset in full plainText |
| char_end | integer | |
| is_sub_chunk | boolean | true if this is a sliding-window sub-chunk of a long clause |
| window_index | integer | Sub-chunk sequence number |
| created_at | timestamptz | |

Index: `IVFFlat (embedding vector_cosine_ops)` — `lists=100`
Index: `(version_id, is_sub_chunk)` — for sub-chunk filtering

### contract_field_definitions

Admin-defined org-specific extraction fields. Values extracted by Review Agent and stored flat in `contract.metadata[field_key]`.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| org_id | uuid FK | |
| field_key | varchar(100) | Snake_case key — matches metadata key (e.g. `survival_period`) |
| field_label | varchar(255) | Human-readable label (e.g. `Survival Period`) |
| field_type | enum | `text`, `number`, `date`, `boolean`, `select`, `multiselect` |
| contract_type | varchar(50) | Null = global (all types); value = scoped to one type (e.g. `NDA`) |
| options | text[] | Values for select/multiselect fields |
| help_text | text | Hint shown in UI |
| sort_order | integer | Display order within field type |
| created_at / updated_at | timestamptz | |

Unique constraint: `(org_id, contract_type, field_key)`

---

## Indexes

Critical indexes for performance (beyond primary keys):

```sql
-- Multi-tenant scoping (all queries filter by org_id first)
CREATE INDEX idx_contracts_org_status ON contracts(org_id, status);
CREATE INDEX idx_contracts_org_type ON contracts(org_id, contract_type);
CREATE INDEX idx_contracts_org_counterparty ON contracts(org_id, counterparty_id);
CREATE INDEX idx_contracts_org_expiry ON contracts(org_id, expiry_date);
CREATE INDEX idx_requests_org_status ON contract_requests(org_id, status);
CREATE INDEX idx_obligations_org_status_due ON obligations(org_id, status, due_date);
CREATE INDEX idx_audit_org_type_time ON audit_events(org_id, event_type, timestamp);
CREATE INDEX idx_versions_contract ON contract_versions(contract_id, version_number);

-- Semantic search (pgvector)
CREATE INDEX idx_versions_embedding ON contract_versions USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_clauses_embedding ON clause_library_items USING ivfflat (embedding vector_cosine_ops);

-- Full text search
CREATE INDEX idx_contracts_fts ON contracts USING gin(to_tsvector('english', title));
CREATE INDEX idx_versions_fts ON contract_versions USING gin(to_tsvector('english', document_content));
```
