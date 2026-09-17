# 01 — System Architecture

## Design Principles

1. **Agent-first, UI-contextual**: Agents are the execution engine. UI surfaces appear when humans need to review, configure, or collaborate — not as permanent navigation destinations.
2. **Backend = governance**: The backend enforces permissions, audit trails, and compliance. Agents handle orchestration and execution within those boundaries.
3. **Event-driven**: Every action (agent or human) emits an event. Events drive notifications, audit logs, integrations, and downstream workflows.
4. **API-first**: Every capability exposed via API. The web UI, mobile app, Slack bot, and email handler are all API consumers.
5. **Modular agents**: Each agent is a standalone service with defined inputs, outputs, tools, and autonomy boundaries. Agents communicate via the orchestrator, not directly.
6. **Progressive complexity**: Simple tasks stay simple (chat → done). Complex tasks reveal UI progressively (chat → generated view → full screen).

---

## System Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT LAYER                              │
│  Web App (React) │ Mobile App │ Slack/Teams Bot │ Email      │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST + WebSocket
┌──────────────────────▼──────────────────────────────────────┐
│                    API GATEWAY                                │
│  Auth │ Rate Limit │ Routing │ Request Validation            │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│               APPLICATION SERVICES                           │
│                                                              │
│  Contract    │ Request   │ Approval  │ Obligation │ User     │
│  Service     │ Service   │ Service   │ Service    │ Service  │
│              │           │           │            │          │
│  Template    │ Clause    │ Workflow  │ Analytics  │ Audit    │
│  Service     │ Service   │ Engine    │ Service    │ Service  │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│              AGENT ORCHESTRATION LAYER                        │
│                                                              │
│  ┌─────────────┐                                            │
│  │ Orchestrator │──── Plan → Decompose → Route → Monitor    │
│  └──────┬──────┘                                            │
│         │                                                    │
│  ┌──────▼───────────────────────────────────────────┐       │
│  │ Intake │ Draft │ Review │ Redline │ Approval │    │       │
│  │ Agent  │ Agent │ Agent  │ Agent   │ Agent    │    │       │
│  │        │       │        │         │          │    │       │
│  │ Signature │ Obligation │ Invoice │ Search │   │   │       │
│  │ Agent     │ Agent      │ Agent   │ Agent  │   │   │       │
│  │           │            │         │        │   │   │       │
│  │ Compliance │ Integration │ Insight │       │   │   │       │
│  │ Agent      │ Agent       │ Agent   │       │   │   │       │
│  └──────────────────────────────────────────────┘   │       │
│                                                              │
│  ┌─────────────────────────────────────────────────┐        │
│  │ Human-in-the-Loop Gate                           │        │
│  │ Autonomy boundaries │ Approval gates │ Overrides │        │
│  └─────────────────────────────────────────────────┘        │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│              KNOWLEDGE & MEMORY LAYER                        │
│                                                              │
│  Vector DB     │ Knowledge   │ Playbook   │ Clause          │
│  (embeddings)  │ Graph       │ Engine     │ Library          │
│                │ (relations) │ (positions)│ (approved text)  │
│                │             │            │                  │
│  Conversation  │ Document    │ Template   │                  │
│  Memory        │ Store (S3)  │ Engine     │                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   TOOL / MCP LAYER                           │
│                                                              │
│  LLM Provider  │ eSign API  │ CRM MCP   │ ERP MCP          │
│  (Claude/GPT)  │ (DocuSign) │ (SFDC)    │ (SAP)            │
│                │            │           │                    │
│  Email MCP     │ Slack MCP  │ OCR       │ Storage           │
│  (Gmail)       │            │ Service   │ (S3)              │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                 GOVERNANCE ENGINE                             │
│                                                              │
│  RBAC         │ Audit Trail │ Compliance  │ Encryption       │
│  (OPA)        │ (append-    │ Rules       │ (at-rest +       │
│               │  only log)  │ Engine      │  in-transit)     │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   DATA LAYER                                 │
│                                                              │
│  PostgreSQL        │ Redis          │ S3 / Blob              │
│  (structured data) │ (cache, queue) │ (documents, files)     │
│                    │                │                         │
│  ClickHouse        │ Elasticsearch  │                         │
│  (analytics)       │ (full-text)    │                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Request Flow — How a Typical Action Moves Through the System

### Example: Upload a contract PDF (Built — Phases 2.2–3.4)

```
1. User uploads PDF via web → POST /api/v1/contracts/upload
2. API Gateway: auth + RBAC check
3. Fastify: S3 upload → prisma.contract.create(analysisStatus: PENDING) → 201 response
4. BullMQ: documentQueue.add('parse-document', { contractId, s3Key })

   parse.worker.ts:
   5. S3 download → extractDocument() → store plainText + _totalPages in metadata → PARSING

   agent.worker.ts:
   6. agentQueue: detect-binder
      → POST /detect-binder (Haiku, 10K chars)
      → isBinder?

      Branch A — IS binder:
      7a. metadata: { _binderDetected, _suggestedSplits, _autoSplit: true } → SPLITTING
      8a. documentQueue: split-binder
          → S3 download → pdf-lib slice → N child Contract+Version records
          → each child: documentQueue: parse-document (pipeline repeats independently)
          → parent: DONE + metadata._splitInto: [childIds]

      Branch B — NOT binder:
      7b. agentQueue: classify-document
          → POST /classify (Haiku, 5K chars) → contractType → update contract.type → CLASSIFYING
      8b. agentQueue: extract-ai
          → fetch plainText + customFields from DB
          → POST /review to agents service (Python)
          → 3-step Review Agent (Extract/Haiku → Validate/Sonnet → Score/Sonnet)
          → PATCH /contracts/:id (summary, keyTerms, riskScore, _typeFields, _aiFindings, metadata[customFields])
          → POST /contracts/:id/versions/:versionId/clauses (clauseSegments, clauseFlags)
          → POST /contracts/:id/versions/:versionId/chunk → INDEXING
      9b. documentQueue: chunk-and-index
          → legalChunkAndStore() → ES bulk index
          → documentQueue: embed-contract → pgvector embeddings → DONE

10. UI: React Query polls analysisStatus → renders per-stage banner → shows complete data at DONE
```

### Example: "Draft an NDA for Acme" in Slack (Phase 04+ — not yet built)

```
This flow requires the Draft Agent, Approval Agent, and Signature Agent, which are planned for
Phases 04, 06, and 07 respectively. When built:

1. Slack MCP receives message → API Gateway auth
2. Intake Agent: classify type=NDA, counterparty=Acme → create request
3. Draft Agent: template lookup → CRM data → clause assembly → LLM draft
4. Approval Agent: evaluate routing rules → auto-approve if standard
5. Signature Agent: prepare PDF → send signing link
6. Confirmation back via Slack
```

---

## Event System

Every meaningful action emits an event to the event bus. Events are the backbone of:
- **Audit trail**: every event persisted to append-only audit log
- **Notifications**: events trigger notification rules
- **Integrations**: events trigger CRM/ERP sync
- **Analytics**: events feed the analytics pipeline
- **Agent monitoring**: events track agent actions and performance

### Event Schema

```json
{
  "event_id": "evt_abc123",
  "event_type": "contract.draft_created",
  "timestamp": "2026-03-17T14:30:00Z",
  "actor": {
    "type": "agent",
    "id": "draft_agent",
    "triggered_by": "user_456"
  },
  "resource": {
    "type": "contract",
    "id": "ctr_789"
  },
  "data": {
    "template_used": "tpl_nda_standard",
    "counterparty": "Acme Corp",
    "confidence_score": 0.95
  },
  "org_id": "org_001",
  "metadata": {
    "ip_address": "10.0.1.50",
    "session_id": "sess_xyz"
  }
}
```

### Core Event Types

| Category | Events |
|----------|--------|
| Request | `request.created`, `request.assigned`, `request.completed`, `request.rejected` |
| Contract | `contract.draft_created`, `contract.updated`, `contract.version_saved`, `contract.status_changed` |
| Negotiation | `negotiation.redline_received`, `negotiation.counter_sent`, `negotiation.agreed` |
| Approval | `approval.requested`, `approval.approved`, `approval.rejected`, `approval.escalated`, `approval.delegated` |
| Signature | `signature.sent`, `signature.viewed`, `signature.completed`, `signature.declined`, `signature.reminder_sent` |
| Obligation | `obligation.extracted`, `obligation.approaching`, `obligation.overdue`, `obligation.completed` |
| Renewal | `renewal.approaching`, `renewal.decision_made`, `renewal.auto_renewed` |
| System | `agent.action`, `agent.error`, `integration.sync`, `user.login`, `user.permission_changed` |

---

## Multi-Tenancy

The platform is multi-tenant from day one:

- **Org-level isolation**: every record has `org_id`. All queries scoped by org.
- **Row-level security**: PostgreSQL RLS policies enforce org isolation at the database level.
- **Separate document storage**: each org gets its own S3 prefix (or separate bucket for enterprise).
- **Separate vector namespace**: each org's contract embeddings in their own vector DB namespace.
- **Configurable LLM**: each org can configure their preferred LLM provider (Claude, GPT, etc.) — OmniModel support.

---

## Scalability Considerations

| Component | Strategy |
|-----------|----------|
| API layer | Horizontally scalable stateless services behind load balancer |
| Agent orchestration | Queue-based (Redis/SQS). Each agent invocation is a job. Workers scale independently. |
| Document processing | Async job queue. OCR, extraction, embedding generation run as background workers. |
| Search | Elasticsearch for full-text, vector DB for semantic. Both horizontally scalable. |
| Real-time collaboration | WebSocket server with Redis pub/sub for multi-user sync |
| Analytics | ClickHouse for fast analytical queries. Materialized views for dashboards. |
| File storage | S3 with CDN for document delivery. Presigned URLs for secure access. |

---

## Environments

| Environment | Purpose | Data |
|-------------|---------|------|
| Local dev | Developer machines | Seed data, Docker Compose |
| CI/CD | Automated testing | Test fixtures, ephemeral DB |
| Staging | Pre-production validation | Anonymized production data subset |
| Production | Live system | Real customer data |
