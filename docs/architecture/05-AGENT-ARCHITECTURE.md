# 05 — Agent Architecture

## Overview

The agent layer is the intelligence engine of the platform. It's a Python service that runs alongside the Node.js backend, communicating via gRPC (synchronous) and Redis queues (asynchronous). Every agent is a LangGraph node with defined tools, memory access, and autonomy boundaries.

---

## Document Processing Pipeline (Built — Phases 2.2 through 3.4)

Contract documents flow through a linear pipeline of specialized LLM stages. Each stage is a BullMQ job processed by async workers — no synchronous blocking.

```
POST /upload (or /requests/:id/convert)
  └─ documentQueue: parse-document [parse.worker.ts]
       │  PARSING: S3 download → extract text → store _totalPages in metadata
       └─ agentQueue: detect-binder [agent.worker.ts]
            │  LLM (Haiku, first 10K chars) — is this a multi-document binder?
            ├── isBinder (conf ≥ 0.7)
            │     SPLITTING → documentQueue: split-binder [parse.worker.ts]
            │       pdf-lib page slicing → N child Contract+Version records
            │       each child → documentQueue: parse-document (pipeline repeats independently)
            │       parent → DONE + _splitInto: [childIds] in metadata
            └── not binder
                  agentQueue: classify-document [agent.worker.ts]
                    LLM (Haiku, first 5K chars) → contractType (11 known types + OTHER)
                    CLASSIFYING → update contract.type
                    agentQueue: extract-ai [agent.worker.ts]
                      POST /review to agents service (3-step Review Agent)
                      EXTRACTING → results patched back via PATCH /contracts/:id
                      documentQueue: chunk-and-index
                        INDEXING: legal chunker → ES bulk index → BullMQ: embed-contract
                        pgvector embeddings → DONE
```

### Pipeline Status Values

| Status | What's happening |
|--------|-----------------|
| `PENDING` | Queued, not started |
| `PARSING` | S3 download + text extraction |
| `SPLITTING` | pdf-lib page slicing into child contracts |
| `CLASSIFYING` | LLM determining contract type |
| `EXTRACTING` | 3-step Review Agent running (30–60s) |
| `INDEXING` | Chunking + ES indexing + embedding |
| `DONE` | Pipeline complete |
| `FAILED` | Error in any stage |

> **Note:** `BINDER_DETECTED` was used in Phase 3.2 as a user-gate pause state. Removed in Phase 3.3 — binder split now runs automatically.

---

## General Orchestrator Pattern (Phase 04+)

For future phases (Drafting, Negotiation, Approval), a general task-decomposition orchestrator is planned:

```
User Intent → Orchestrator → Plan → Route to Agent(s) → Execute → Validate → Respond
                                         ↑                    │
                                         └── Re-plan on failure ←┘
```

This is not yet built. Phase 04 (Drafting) will be the first phase to require true orchestration (template selection → CRM data fetch → clause assembly → draft generation).

---

## Agent Specifications

### Agent Registry

| Agent | Purpose | LLM Tier | Autonomy | Status |
|-------|---------|----------|----------|--------|
| **Detect-Binder Agent** ✅ | Classify doc as binder vs single contract; suggest splits with pageHints | Haiku (first 10K chars) | Autonomous | **Built** — `detect_binder.py` |
| **Classify Agent** ✅ | Identify contract type from first 5K chars (11 types) | Haiku (first 5K chars) | Autonomous | **Built** — `classify.py` |
| **Review Agent (3-step)** ✅ | Step 1 (Extract/Haiku): clause segments + raw fields with quotes. Step 2 (Validate/Sonnet): normalize types, assign per-field confidence. Step 3 (Score/Sonnet): riskScore, contractType, summary. Plus type-specific fields (10 types × 9–16 fields) + org custom fields + open-ended findings. | Haiku → Sonnet → Sonnet | Autonomous | **Built** — `review_agent.py` |
| **Intake Classify Agent** ✅ | Classify intake request: contractType + priority + extract counterparty/value/law | Haiku (first 3K chars) | Autonomous | **Built** — `intake.py` |
| **Portfolio Query Agent** ✅ | NL → structured ES filters → fetch contracts → synthesise answer | Sonnet | Autonomous | **Built** — `portfolio_agent.py` |
| **Ask Agent (RAG)** ✅ | Per-contract and portfolio Q&A grounded in clause embeddings with [Clause N] citations | Sonnet | Autonomous | **Built** — `ask_agent.py` |
| Intake Agent | Classify requests, route to queue | Fast (Haiku) | Autonomous | Phase 03 (partially covered by classify agent) |
| Draft Agent | Generate contracts from templates + data | Sonnet | Semi-autonomous | Phase 04 |
| Redline Agent | Generate counter-proposals | Opus | Semi-autonomous | Phase 05 |
| Approval Agent | Route approvals, generate summaries | Haiku | Autonomous | Phase 06 |
| Signature Agent | Prepare and monitor signatures | Haiku | Autonomous | Phase 07 |
| Obligation Agent | Extract and monitor obligations | Sonnet | Autonomous | Phase 08 |
| Invoice Agent | Match invoices to contract terms | Sonnet | Semi-autonomous | Phase 08 |
| Search Agent | Semantic search, portfolio queries | Sonnet | Autonomous | Phase 09 |
| Compliance Agent | Check against regulations | Opus | Autonomous | Phase 10 |
| Integration Agent | Sync data between systems | Haiku | Autonomous | Phase 10 |
| Insight Agent | Generate analytics, recommendations | Sonnet | Autonomous | Phase 09 |

### LLM Provider Registry

All supported providers and models are defined in `apps/agents/app/providers.py`. Adding a new model = one line in the registry. The UI fetches available models from `GET /api/v1/agent/models` and lets users pick per session.

**Supported providers (as of Phase 01):**

| Provider | Models |
|----------|--------|
| **Anthropic** | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 |
| **OpenAI** | gpt-4o, gpt-4o-mini, gpt-4-turbo |
| **Google** | gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash |

### LLM Routing (OmniModel — System Agents)

System agents route to the appropriate tier automatically by task. Provider priority is OpenAI → Anthropic → Google (configurable in `active_provider()` in `config.py`). This is separate from the user's chat model selection.

**Actual routing as built (Phases 2.2–3.4):**

| Pipeline Stage | Agent File | Model | Context Limit | Why |
|---------------|-----------|-------|--------------|-----|
| detect-binder | `detect_binder.py` | Haiku | First 10K chars | Fast, binary classification |
| classify-document | `classify.py` | Haiku | First 5K chars | Fast, 11-class classification |
| extract-ai Step 1 (Extract) | `review_agent.py` | Haiku | 40K chars, chunked | High throughput, low cost |
| extract-ai Step 2 (Validate) | `review_agent.py` | Sonnet | Same chunks | Reasoning needed for normalization |
| extract-ai Step 3 (Score) | `review_agent.py` | Sonnet | Same chunks | Reasoning needed for risk scoring |
| intake-classify | `intake.py` | Haiku | First 3K chars | Fast classification of request text |
| portfolio-query | `portfolio_agent.py` | Sonnet | Variable | Synthesis requires reasoning |
| ask (RAG) | `ask_agent.py` | Sonnet | Top-N clauses | Grounded answers need reasoning |

> **Note:** System agent model selection defaults to Anthropic. Override per-agent by passing `provider` + `model_id` to `build_llm()` from `providers.py`.

---

## Agent Implementation Template

Every specialist agent follows this structure:

```python
class DraftAgent:
    """Generates contract drafts from templates, clauses, and data."""

    name = "draft_agent"
    description = "Generates contract documents from templates and business data"

    # Autonomy boundaries (configurable per org)
    can_auto_execute = True  # Can generate drafts without human approval
    confidence_threshold = 0.85  # Below this, require human review
    max_retries = 2

    # Tools this agent can use
    tools = [
        "get_template",           # Fetch template from library
        "get_clauses",            # Fetch clauses by category
        "get_playbook_positions", # Fetch playbook rules
        "query_crm",             # Get counterparty data from CRM
        "create_contract",        # Save contract to database
        "save_version",           # Save document version
        "generate_embedding",     # Create vector embedding
    ]

    system_prompt = """You are the Draft Agent for a CLM platform. Your role is to
    generate contract documents that are accurate, compliant with the organization's
    playbook, and populated with correct business data.

    Rules:
    - Always use the organization's approved templates. Never generate freeform.
    - Always use clauses from the approved clause library. Never invent clause language.
    - Always follow playbook positions for variable terms.
    - Always populate variable fields from CRM/request data. Flag any missing fields.
    - Rate your confidence in the generated draft (0.0-1.0).
    - If confidence < 0.85, flag for human review with specific concerns.
    """

    async def execute(self, state: AgentState) -> AgentResult:
        # 1. Select template
        template = await self.tools.get_template(
            contract_type=state.contract_type,
            jurisdiction=state.jurisdiction,
            deal_value=state.deal_value,
        )

        # 2. Gather clauses
        clauses = await self.tools.get_clauses(
            template_sections=template.sections,
            jurisdiction=state.jurisdiction,
        )

        # 3. Get playbook positions
        positions = await self.tools.get_playbook_positions(
            clause_categories=[c.category for c in clauses]
        )

        # 4. Get counterparty data
        counterparty = await self.tools.query_crm(
            counterparty_id=state.counterparty_id
        )

        # 5. Call LLM to assemble document
        llm = select_llm("draft", state.complexity)
        document = await self.llm_call(
            model=llm,
            template=template,
            clauses=clauses,
            positions=positions,
            counterparty=counterparty,
            request_data=state.request_data,
        )

        # 6. Save contract and version
        contract = await self.tools.create_contract(document, state)
        await self.tools.save_version(contract.id, document)
        await self.tools.generate_embedding(contract.id, document.text)

        return AgentResult(
            success=True,
            contract_id=contract.id,
            confidence=document.confidence_score,
            requires_human_review=document.confidence_score < self.confidence_threshold,
            summary=document.summary,
        )
```

---

## Memory System

### Short-term (Conversation Memory)
- **Store**: Redis with TTL (24 hours)
- **Scope**: Per user session
- **Content**: Last N messages, current workflow state, active contract context
- **Purpose**: Maintain context within a conversation. "That contract" refers to the one being discussed.

### Long-term (RAG / Retrieval)
- **Store**: pgvector (contract embeddings) + Elasticsearch (full-text)
- **Scope**: Per organization (isolated)
- **Content**: All contract versions, clause library, playbook positions, historical negotiations
- **Purpose**: Find relevant precedents, similar contracts, applicable clauses when drafting or reviewing.

### Knowledge Graph (future phase)
- **Store**: PostgreSQL with recursive CTEs (or Neo4j if needed later)
- **Scope**: Per organization
- **Content**: Entity relationships: counterparty → contracts → obligations → people → departments
- **Purpose**: Answer relationship queries: "How many active contracts do we have with companies in the Acme Corp group?"

---

## Human-in-the-Loop Gate

Every agent action is evaluated against autonomy boundaries before execution:

```python
class HumanGate:
    def evaluate(self, agent_result: AgentResult, org_config: OrgConfig) -> GateDecision:
        # Always require human for these actions
        if agent_result.action_type in ["sign", "send_external", "delete", "financial_commit"]:
            return GateDecision.REQUIRE_HUMAN

        # Check confidence threshold
        if agent_result.confidence < org_config.confidence_threshold:
            return GateDecision.REQUIRE_HUMAN

        # Check value threshold
        if agent_result.contract_value > org_config.auto_approve_max_value:
            return GateDecision.REQUIRE_HUMAN

        # Check if non-standard terms detected
        if agent_result.has_playbook_deviations:
            return GateDecision.REQUIRE_HUMAN

        return GateDecision.AUTO_PROCEED
```

### Autonomy Levels (configurable per org)

| Level | Description | Human Touchpoint |
|-------|-------------|------------------|
| Supervised | Agent proposes, human executes every action | Every step |
| Guided | Agent executes routine tasks, human approves non-standard | Deviations, high-value, external sends |
| Autonomous | Agent executes most actions, human reviews summary | Post-execution review, exceptions only |

Default for new orgs: **Guided**. Enterprises may set **Supervised** initially and increase as trust builds.

---

## Agent Communication Protocol

Agents communicate with the Node.js backend via:

### Synchronous (gRPC) — for real-time chat responses

```protobuf
service AgentService {
  rpc Chat(ChatRequest) returns (stream ChatResponse);
  rpc Extract(ExtractRequest) returns (ExtractResponse);
  rpc Review(ReviewRequest) returns (ReviewResponse);
  rpc Draft(DraftRequest) returns (DraftResponse);
}
```

### Asynchronous (BullMQ Redis Queues) — for background jobs

Two queues, two worker processes:

```typescript
// documentQueue — parse.worker.ts (concurrency=3)
type DocumentJobName = 'parse-document' | 'split-binder' | 'chunk-and-index' | 'embed-contract'

// agentQueue — agent.worker.ts (concurrency=2)
type AgentJobName = 'detect-binder' | 'classify-document' | 'extract-ai' | 'classify-request'
```

Agents communicate with the Node.js backend via direct HTTP (not gRPC):
- Review Agent → `PATCH /api/v1/contracts/:id` (internal service auth via `x-internal-service` header)
- Review Agent → `POST /api/v1/contracts/:id/versions/:versionId/clauses`
- Review Agent → `POST /api/v1/contracts/:id/versions/:versionId/chunk`

Background jobs run on a separate worker pool. They don't block user-facing requests.
