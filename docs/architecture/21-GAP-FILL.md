# 21 — Gap Fill: Missing Architectural Details

This document fills every gap identified during the architecture audit. Each section is self-contained and cross-references the original doc it supplements.

---

## 1. Contract Status State Machine

**Supplements**: `03-DATA-MODEL.md` (contracts table)

### Valid Statuses

```
draft → in_review → in_negotiation → pending_approval → approved →
pending_signature → executed → active → expired | terminated → archived
```

### Transition Rules

| From | To | Trigger | Who Can Trigger |
|------|----|---------|-----------------|
| `draft` | `in_review` | Author submits for internal review | Contract owner, Draft Agent |
| `draft` | `in_negotiation` | Sent to counterparty | Contract owner |
| `draft` | `pending_approval` | Submitted for approval (skip review) | Contract owner |
| `in_review` | `draft` | Reviewer requests changes | Reviewer |
| `in_review` | `in_negotiation` | Internal review complete, sent to counterparty | Reviewer |
| `in_review` | `pending_approval` | Internal review complete, ready for approval | Reviewer |
| `in_negotiation` | `in_review` | Counterparty redlines received, needs internal review | System (on redline receipt) |
| `in_negotiation` | `pending_approval` | Negotiation complete, submit for approval | Contract owner |
| `in_negotiation` | `draft` | Major rework needed | Contract owner |
| `pending_approval` | `approved` | All approvers approved | Approval Agent (automatic) |
| `pending_approval` | `in_negotiation` | Approver requests changes | Approver |
| `pending_approval` | `draft` | Approver rejects | Approver |
| `approved` | `pending_signature` | Sent for signature | Contract owner, Signature Agent |
| `approved` | `in_negotiation` | Re-opened for renegotiation | Contract owner (with reason) |
| `pending_signature` | `executed` | All parties signed | Signature Agent (automatic) |
| `pending_signature` | `approved` | Signature voided/declined | Signature Agent |
| `executed` | `active` | Effective date reached (or immediate) | System (automatic) |
| `active` | `expired` | Expiry date reached | System (scheduled task) |
| `active` | `terminated` | Early termination | Contract owner (with approval) |
| `expired` | `archived` | Retention period passed or manual archive | Admin, System |
| `terminated` | `archived` | Same | Admin, System |

### Enforcement

```typescript
// lib/contract-state-machine.ts

const VALID_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft:              ["in_review", "in_negotiation", "pending_approval"],
  in_review:          ["draft", "in_negotiation", "pending_approval"],
  in_negotiation:     ["in_review", "pending_approval", "draft"],
  pending_approval:   ["approved", "in_negotiation", "draft"],
  approved:           ["pending_signature", "in_negotiation"],
  pending_signature:  ["executed", "approved"],
  executed:           ["active"],
  active:             ["expired", "terminated"],
  expired:            ["archived"],
  terminated:         ["archived"],
  archived:           [],  // Terminal state
};

function validateTransition(from: ContractStatus, to: ContractStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// Every status change goes through this function
async function transitionStatus(
  contractId: string,
  newStatus: ContractStatus,
  actor: Actor,
  reason?: string
): Promise<void> {
  const contract = await db.contracts.findUnique({ where: { id: contractId } });
  if (!validateTransition(contract.status, newStatus)) {
    throw new InvalidTransitionError(contract.status, newStatus);
  }

  await db.$transaction(async (tx) => {
    await tx.contracts.update({
      where: { id: contractId },
      data: { status: newStatus, updated_by: actor.id },
    });
  });

  // Event emitted AFTER transaction commits
  await eventBus.publish({
    event_type: "contract.status_changed",
    resource: { type: "contract", id: contractId },
    data: { from: contract.status, to: newStatus, reason },
    actor,
  });
}
```

---

## 2. Collaborative Editing Architecture

**Supplements**: `02-TECH-STACK.md`, Phase 5

### Technology: TipTap + Yjs + HocusPocus

- **TipTap**: Rich text editor built on ProseMirror. Handles rendering, formatting, extensions.
- **Yjs**: CRDT (Conflict-free Replicated Data Type) library for real-time collaboration. Automatically merges concurrent edits without conflicts.
- **HocusPocus**: WebSocket server that syncs Yjs documents between connected clients. Handles awareness (cursors, selections, presence).

### Why Yjs/CRDT Instead of Operational Transform

OT (used by Google Docs) requires a central server to sequence operations. CRDTs allow peer-level merging — every client can apply changes independently and converge to the same state. This means:
- No single point of failure for the collaboration server
- Works offline (changes sync when reconnected)
- Simpler server implementation (just relay, no transform logic)

### Architecture

```
Client A (TipTap + Yjs)  ──WebSocket──┐
                                       │
Client B (TipTap + Yjs)  ──WebSocket──┤──► HocusPocus Server ──► PostgreSQL
                                       │       (Yjs sync)         (persistence)
Client C (TipTap + Yjs)  ──WebSocket──┘
```

### Document Schema (TipTap/ProseMirror)

```typescript
// editor/schema.ts — defines the document structure

import { Node, Mark } from "@tiptap/core";

// The contract document is a tree of nodes:
const contractSchema = {
  nodes: {
    doc:          { content: "section+" },
    section:      { content: "heading paragraph+ | heading clause+" },
    heading:      { content: "inline*", attrs: { level: { default: 2 } } },
    paragraph:    { content: "inline*" },
    clause:       { content: "inline*", attrs: {
      clause_id:     { default: null },     // FK to clause_library_items
      clause_version:{ default: null },
      is_variable:   { default: false },    // Editable variable field
      data_source:   { default: null },     // CRM field mapping
    }},
    variable_field: { content: "inline*", attrs: {
      field_name:    {},                    // e.g., "counterparty_name"
      data_source:   {},                    // e.g., "crm.account.name"
      value:         { default: "" },       // Current populated value
      is_filled:     { default: false },
    }},
    table:        { content: "table_row+" },
    table_row:    { content: "table_cell+" },
    table_cell:   { content: "paragraph+" },
    signature_field: { attrs: {
      signer_role:   {},                    // e.g., "counterparty_ceo"
      field_type:    {},                    // "signature" | "initial" | "date"
      signer_email:  { default: null },
    }},
    text:         {},
    hard_break:   {},
  },
  marks: {
    bold:          {},
    italic:        {},
    underline:     {},
    strike:        {},
    highlight:     { attrs: { color: { default: "yellow" } } },
    comment_anchor:{ attrs: { comment_id: {} } },  // Anchors inline comments
    tracked_insert:{ attrs: { author: {}, timestamp: {} } },
    tracked_delete:{ attrs: { author: {}, timestamp: {} } },
    link:          { attrs: { href: {} } },
  },
};
```

### Persistence

Documents are stored in two forms:
1. **Yjs binary** (for collaboration): stored in PostgreSQL as `bytea`. Loaded when editing session starts. Updated on every change via HocusPocus persistence hook.
2. **HTML export** (for rendering, search, PDF generation): generated from Yjs document when editing session ends or on explicit save. Stored in `contract_versions.document_content`.

```typescript
// hocuspocus-server/persistence.ts

import { Database } from "@hocuspocus/extension-database";

const persistence = new Database({
  fetch: async ({ documentName }) => {
    // documentName = "contract:{contract_id}:v{version_id}"
    const [_, contractId, versionPart] = documentName.split(":");
    const row = await db.contractVersions.findFirst({
      where: { contract_id: contractId },
      orderBy: { version_number: "desc" },
    });
    return row?.yjs_state ?? null;  // Return Yjs binary or null for new doc
  },
  store: async ({ documentName, state }) => {
    const [_, contractId] = documentName.split(":");
    await db.contractVersions.update({
      where: { id: currentVersionId },
      data: { yjs_state: state },
    });
  },
});
```

### Presence and Awareness

Each connected user broadcasts their cursor position and selection. Other users see colored cursors with name labels.

```typescript
// Awareness data per user
interface AwarenessState {
  user: { name: string; color: string; avatar_url: string };
  cursor: { anchor: number; head: number } | null;
  selection: { from: number; to: number } | null;
}
```

### Conflict Resolution

Yjs CRDTs resolve conflicts automatically. Two users typing at the same position: both insertions are preserved in the order received. Two users deleting the same text: deletion is idempotent — applied once. One user inserts, another deletes at the same position: both operations applied — insertion preserved, surrounding text deleted.

No manual conflict resolution is ever needed.

---

## 3. LLM Prompt Management

**Supplements**: `05-AGENT-ARCHITECTURE.md`

### Prompt Architecture

Every agent has a system prompt that defines its behavior. Prompts are versioned, testable, and separate from code.

```
agents/
└── prompts/
    ├── intake_agent/
    │   ├── v1.md          # System prompt version 1
    │   ├── v2.md          # System prompt version 2 (current)
    │   └── test_cases.jsonl  # Evaluation dataset
    ├── draft_agent/
    │   ├── v1.md
    │   ├── v2.md
    │   └── test_cases.jsonl
    ├── review_agent/
    │   ├── v1.md
    │   └── ...
    └── shared/
        ├── formatting_rules.md    # Included in all agents
        ├── safety_guardrails.md   # Included in all agents
        └── org_context_template.md # Template for org-specific context injection
```

### Prompt Structure (every agent)

```markdown
# {Agent Name} — System Prompt v{N}

## Role
You are the {Agent Name} for a Contract Lifecycle Management platform.
Your job is to {one-sentence purpose}.

## Context (injected at runtime)
- Organization: {org.name}
- Industry: {org.industry}
- Jurisdiction preferences: {org.jurisdictions}
- User role: {user.role}
- User permissions: {user.permissions}

## Rules (non-negotiable)
1. {Rule 1 — e.g., never invent clause language, always use approved library}
2. {Rule 2}
3. ...

## Tools Available
- {tool_name}: {what it does}
- ...

## Output Format
{Structured output specification — JSON schema or markdown format}

## Confidence Rating
Rate your confidence 0.0-1.0 on every output:
- 0.9+: Fully confident, matches playbook/template exactly
- 0.7-0.9: Mostly confident, minor deviations noted
- 0.5-0.7: Uncertain, recommend human review
- <0.5: Cannot complete reliably, escalate

## Examples
{2-3 few-shot examples of ideal input → output}
```

### Runtime Prompt Assembly

At invocation time, the prompt is assembled from components:

```python
def assemble_prompt(agent_name: str, org: Organization, user: User, context: dict) -> str:
    # 1. Load agent-specific system prompt (versioned)
    agent_prompt = load_prompt(f"prompts/{agent_name}/v{current_version}.md")

    # 2. Load shared rules
    formatting = load_prompt("prompts/shared/formatting_rules.md")
    safety = load_prompt("prompts/shared/safety_guardrails.md")

    # 3. Inject org-specific context
    org_context = render_template("prompts/shared/org_context_template.md", {
        "org_name": org.name,
        "org_industry": org.industry,
        "jurisdictions": org.settings.get("jurisdictions"),
        "playbook_summary": get_playbook_summary(org.id),
        "template_types": get_template_types(org.id),
    })

    # 4. Assemble final prompt
    return f"{agent_prompt}\n\n{org_context}\n\n{formatting}\n\n{safety}"
```

### Prompt Versioning and Rollback

```python
# config/prompt_config.yaml
agents:
  draft_agent:
    current_version: 2
    rollback_version: 1  # If current fails evaluation, auto-rollback
    evaluation_threshold: 0.85  # Min score on test cases to deploy
  review_agent:
    current_version: 3
    rollback_version: 2
    evaluation_threshold: 0.80
```

### Prompt Evaluation Pipeline

Every prompt change is tested against the agent's evaluation dataset before deployment:

```python
async def evaluate_prompt(agent_name: str, version: int) -> EvalResult:
    test_cases = load_test_cases(f"prompts/{agent_name}/test_cases.jsonl")
    prompt = load_prompt(f"prompts/{agent_name}/v{version}.md")

    scores = []
    for case in test_cases:
        result = await run_agent(agent_name, prompt, case.input)
        score = evaluate_output(result, case.expected_output, case.rubric)
        scores.append(score)

    avg_score = sum(scores) / len(scores)
    threshold = config.agents[agent_name].evaluation_threshold

    return EvalResult(
        passed=avg_score >= threshold,
        score=avg_score,
        threshold=threshold,
        per_case_scores=scores,
    )
```

---

## 4. External Portal Security

**Supplements**: `06-SECURITY-GOVERNANCE.md`, Phase 5

### Access Model

External counterparties access the negotiation portal (SCR-011) and signing page (SCR-018) WITHOUT creating an account. Access is via signed, time-limited URLs.

### Token Design

```typescript
// lib/portal-token.ts

interface PortalToken {
  contract_id: string;
  counterparty_id: string;
  permissions: ("view" | "redline" | "comment" | "sign")[];
  expires_at: string;           // ISO timestamp
  max_uses: number | null;      // null = unlimited
  password_required: boolean;
  created_by: string;           // User who generated the link
}

function generatePortalLink(token: PortalToken): string {
  const payload = {
    ...token,
    iat: Date.now(),
    jti: crypto.randomUUID(),   // Unique token ID for revocation
  };
  const signed = jwt.sign(payload, PORTAL_SECRET, { expiresIn: "30d" });
  return `${BASE_URL}/portal/${signed}`;
}
```

### Security Layers

| Layer | Protection |
|-------|-----------|
| URL token | JWT signed with server secret, contains permissions and expiry |
| Optional password | Org can require password for sensitive contracts (stored hashed) |
| IP logging | Every portal access logged with IP, user-agent, timestamp |
| Rate limiting | 100 requests/hour per token to prevent abuse |
| Content isolation | Portal renders ONLY the specific contract — no access to other data |
| CSRF protection | Portal pages use CSRF tokens on all mutations |
| Token revocation | Any internal user can revoke a portal link instantly (adds `jti` to blocklist) |
| Expiry | Default 30 days. Configurable per link (1 day to 90 days). |
| Audit trail | Every portal action (view, redline, comment, sign) logged to audit_events |

### Portal API

Portal has its own API namespace that does NOT require standard JWT auth — uses portal token instead:

```
/api/v1/portal/verify          POST  — Verify token + optional password
/api/v1/portal/contract        GET   — Get contract document and metadata
/api/v1/portal/contract/redline POST — Submit redlines
/api/v1/portal/contract/comment POST — Add comment
/api/v1/portal/contract/sign    POST — Submit signature
```

---

## 5. Search & Indexing Architecture

**Supplements**: `02-TECH-STACK.md`, Phase 2

### Multi-Tenant Isolation

```
Elasticsearch index: "contracts_{org_id}"
  — Each org gets its own index
  — Aliases point to current index for zero-downtime reindexing
  — Index template applied on org creation

pgvector: WHERE org_id = :org_id in every vector query
  — No separate namespace needed, RLS handles isolation
```

### Elasticsearch Index Mapping

```json
{
  "mappings": {
    "properties": {
      "contract_id":    { "type": "keyword" },
      "org_id":         { "type": "keyword" },
      "title":          { "type": "text", "analyzer": "english", "fields": { "exact": { "type": "keyword" } } },
      "contract_type":  { "type": "keyword" },
      "counterparty":   { "type": "text", "analyzer": "standard", "fields": { "exact": { "type": "keyword" } } },
      "status":         { "type": "keyword" },
      "jurisdiction":   { "type": "keyword" },
      "value":          { "type": "double" },
      "effective_date": { "type": "date" },
      "expiry_date":    { "type": "date" },
      "assigned_to":    { "type": "keyword" },
      "tags":           { "type": "keyword" },
      "risk_score":     { "type": "float" },
      "content":        { "type": "text", "analyzer": "english" },
      "clauses":        { "type": "nested", "properties": {
        "section":      { "type": "keyword" },
        "text":         { "type": "text", "analyzer": "english" }
      }},
      "created_at":     { "type": "date" },
      "updated_at":     { "type": "date" }
    }
  }
}
```

### Search Pipeline (query → results)

```
User query: "Acme liability clause from last year"
    │
    ▼
1. Query Analyzer (agent)
   → Extracts: counterparty="Acme", clause_type="liability", date_range="last year"
   → Generates: structured ES query + semantic embedding
    │
    ▼
2. Parallel execution:
   ├── Elasticsearch: filtered full-text search (structured fields + content)
   └── pgvector: semantic similarity search (embedding of query)
    │
    ▼
3. Result Fusion
   → Reciprocal Rank Fusion (RRF) merges both result sets
   → Weighted: 0.6 × full-text score + 0.4 × semantic score
   → Deduplicate by contract_id
    │
    ▼
4. Post-processing
   → Apply RBAC filter (remove contracts user can't access)
   → Generate snippet/highlight from matching content
   → Return top-K results with metadata + snippets
```

### Indexing Pipeline

```
Contract created/updated
    │
    ▼
Event: "contract.version_saved"
    │
    ├──► Job: "doc.extract_text" → extract text from DOCX/PDF
    │       ↓ on completion
    │       Event: "contract.text_extracted"
    │       │
    │       ├──► Job: "doc.generate_embedding" → Claude embed → pgvector
    │       └──► Job: "doc.index_elasticsearch" → index to ES
    │
    └──► (parallel) Job: "agent.extract_terms" → extract key terms → update metadata
```

---

## 6. Notification Delivery System

**Supplements**: `01-SYSTEM-ARCHITECTURE.md`, Phase 9

### Channel Routing

```typescript
// notifications/router.ts

interface NotificationPayload {
  dedup_key: string;               // Prevents duplicate notifications
  recipient_id: string;
  notification_type: string;        // e.g., "approval_requested", "obligation_approaching"
  title: string;
  body: string;
  resource: { type: string; id: string };
  urgency: "low" | "medium" | "high" | "critical";
  action_url?: string;              // Deep link into the app
  action_buttons?: { label: string; action: string }[];
}

async function routeNotification(payload: NotificationPayload): Promise<void> {
  // 1. Check deduplication
  const dedupKey = `notif:dedup:${payload.dedup_key}`;
  const alreadySent = await redis.set(dedupKey, "1", "NX", "EX", 86400);
  if (!alreadySent) return;  // Already sent today

  // 2. Get user preferences
  const prefs = await getUserNotificationPrefs(payload.recipient_id);
  const channelPref = prefs.channels[payload.notification_type] ?? prefs.default_channel;

  // 3. Check quiet hours
  if (isInQuietHours(prefs, payload.urgency)) {
    if (payload.urgency !== "critical") {
      await scheduleForAfterQuietHours(payload, prefs);
      return;
    }
    // Critical notifications ignore quiet hours
  }

  // 4. Deliver to configured channel(s)
  const channels = Array.isArray(channelPref) ? channelPref : [channelPref];
  for (const channel of channels) {
    switch (channel) {
      case "in_app":
        await deliverInApp(payload);
        break;
      case "email":
        await deliverEmail(payload);
        break;
      case "slack":
        await deliverSlack(payload);
        break;
      case "teams":
        await deliverTeams(payload);
        break;
      case "push":
        await deliverPushNotification(payload);
        break;
    }
  }
}
```

### Email Templates

HTML email templates stored in `templates/email/` with Handlebars syntax:

```
templates/email/
├── approval_requested.hbs
├── approval_completed.hbs
├── approval_rejected.hbs
├── contract_signed.hbs
├── obligation_approaching.hbs
├── obligation_overdue.hbs
├── renewal_approaching.hbs
├── signature_reminder.hbs
├── portal_invitation.hbs
├── weekly_digest.hbs
└── _layout.hbs              # Shared header/footer with org branding
```

Each template receives the full notification payload plus org branding (logo, colors).

### Digest Mode

Users can opt for digest mode instead of real-time notifications. Digests are compiled by the `scheduled.digest_compile` job:

- **Daily digest**: all non-critical notifications from the past 24 hours, grouped by type
- **Weekly digest**: summary of contract activity, upcoming obligations, pending approvals

---

## 7. File Processing Pipeline

**Supplements**: `02-TECH-STACK.md`, Phase 2

### Upload Flow

```
Client uploads file
    │
    ▼
1. API endpoint validates:
   - File size ≤ 50MB (configurable per org)
   - MIME type in allowlist: application/pdf, application/vnd.openxmlformats*,
     application/msword, image/png, image/jpeg, image/tiff
   - Filename sanitization (strip special chars, limit length)
    │
    ▼
2. File stored in temp S3 location: s3://{bucket}/temp/{org_id}/{upload_id}
    │
    ▼
3. Virus scan job (ClamAV or AWS GuardDuty):
   - PASS → move to permanent location
   - FAIL → delete file, reject upload, alert admin
    │
    ▼
4. Permanent storage: s3://{bucket}/{org_id}/contracts/{contract_id}/{version_id}/{filename}
    │
    ▼
5. Post-upload processing jobs (queued):
   a. Text extraction (doc.extract_text)
   b. OCR if scanned PDF (doc.ocr → then doc.extract_text)
   c. Thumbnail generation (for preview in repository)
   d. Embedding generation (doc.generate_embedding)
   e. Elasticsearch indexing
   f. Agent extraction (agent.extract_terms) — key terms, dates, parties
```

### Supported Formats

| Format | Read | Write | Notes |
|--------|------|-------|-------|
| PDF | ✓ | ✓ | Primary output format. Generated via Puppeteer/wkhtmltopdf |
| DOCX | ✓ | ✓ | Primary editing format. Converted to/from TipTap schema via mammoth.js |
| DOC (legacy) | ✓ | ✗ | Read-only. Converted to DOCX on upload via LibreOffice |
| Images (PNG/JPG/TIFF) | ✓ | ✗ | OCR via Claude Vision or Tesseract |
| HTML | ✓ | ✓ | Internal storage format for TipTap documents |

### Presigned URLs

Documents are never served directly through the API. Clients request a presigned URL:

```
GET /api/v1/contracts/:id/versions/:vid/download
→ Returns: { url: "https://s3.../...?Signature=...", expires_in: 900 }
```

Presigned URLs expire in 15 minutes. RBAC checked before URL generation.

---

## 8. Internationalization (i18n)

**Supplements**: `07-UI-DESIGN-SYSTEM.md`

### Scope

- **UI language**: all labels, buttons, messages, error text — 10+ languages at launch
- **Contract content**: contracts themselves can be in any language (user-generated content)
- **Date/number formatting**: locale-aware (e.g., MM/DD/YYYY vs DD/MM/YYYY, 1,000.00 vs 1.000,00)
- **Timezone**: all dates stored as UTC, displayed in user's configured timezone
- **RTL support**: planned for Phase 2 of i18n (Arabic, Hebrew)

### Implementation

```typescript
// Frontend: react-i18next

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: require("./locales/en.json") },
    es: { translation: require("./locales/es.json") },
    fr: { translation: require("./locales/fr.json") },
    de: { translation: require("./locales/de.json") },
    ja: { translation: require("./locales/ja.json") },
    pt: { translation: require("./locales/pt.json") },
    zh: { translation: require("./locales/zh.json") },
  },
  lng: "en",  // Default, overridden by user preference
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

// Usage in components:
// const { t } = useTranslation();
// <button>{t("common.approve")}</button>
```

### Locale Files Structure

```json
// locales/en.json (abbreviated)
{
  "common": {
    "approve": "Approve",
    "reject": "Reject",
    "save": "Save",
    "cancel": "Cancel",
    "search": "Search contracts..."
  },
  "contracts": {
    "status": {
      "draft": "Draft",
      "in_review": "In Review",
      "in_negotiation": "In Negotiation",
      "pending_approval": "Pending Approval",
      "executed": "Executed",
      "active": "Active"
    }
  },
  "notifications": {
    "approval_requested": "{{approverName}}, your approval is needed for {{contractTitle}}",
    "obligation_approaching": "Obligation \"{{obligationTitle}}\" is due in {{daysRemaining}} days"
  }
}
```

### Backend: Error Messages

API error responses include a `message_key` that the frontend translates:

```json
{
  "type": "validation_error",
  "title": "Invalid transition",
  "status": 400,
  "message_key": "errors.contract.invalid_transition",
  "params": { "from": "draft", "to": "executed" }
}
```

---

## 9. Caching Strategy

**Supplements**: `02-TECH-STACK.md`

### Cache Layers

| Layer | Store | TTL | What's Cached |
|-------|-------|-----|---------------|
| Browser | React Query | 5 min (staleTime) | API responses for current session |
| CDN | CloudFront | 24h | Static assets, portal pages, document thumbnails |
| API | Redis | Varies | See below |
| Database | PostgreSQL | Built-in | Query plan cache, buffer pool |

### Redis Cache Patterns

```typescript
// lib/cache.ts

class CacheService {
  // Pattern 1: Simple key-value with TTL
  async getOrFetch<T>(key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached);

    const value = await fetcher();
    await this.redis.set(key, JSON.stringify(value), "EX", ttl);
    return value;
  }

  // Pattern 2: Invalidation on write
  async invalidate(patterns: string[]): Promise<void> {
    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) await this.redis.del(...keys);
    }
  }
}
```

### What's Cached and When It's Invalidated

| Key Pattern | TTL | Cached Data | Invalidated On |
|-------------|-----|-------------|----------------|
| `org:{id}:settings` | 1 hour | Org settings, branding | Org settings updated |
| `user:{id}:profile` | 30 min | User profile + preferences | User profile updated |
| `user:{id}:permissions` | 5 min | Computed permission set | Role or user_roles changed |
| `templates:{org_id}:list` | 10 min | Template list | Template created/updated/deleted |
| `clauses:{org_id}:tree` | 10 min | Clause category tree | Category or clause changed |
| `playbook:{org_id}:positions` | 10 min | Playbook positions | Playbook updated |
| `workflow:{org_id}:definitions` | 10 min | Active workflow definitions | Workflow published/updated |
| `dashboard:{org_id}:{type}` | 5 min | Dashboard metric data | Refresh scheduled every 5 min |
| `contract:{id}:summary` | 30 min | Agent-generated contract summary | Contract version saved |
| `search:{org_id}:{query_hash}` | 2 min | Search results | Short TTL, high-frequency queries |

### Cache Invalidation Events

```typescript
// Event handlers that invalidate relevant caches

eventHandlers.on("template.updated", async (event) => {
  await cache.invalidate([`templates:${event.org_id}:*`]);
});

eventHandlers.on("contract.version_saved", async (event) => {
  await cache.invalidate([
    `contract:${event.resource.id}:*`,
    `dashboard:${event.org_id}:*`,
  ]);
});

eventHandlers.on("user.role_changed", async (event) => {
  await cache.invalidate([`user:${event.resource.id}:permissions`]);
});
```

---

## 10. Outgoing Webhook System

**Supplements**: `04-API-DESIGN.md`, `20-WORKFLOW-EVENTS-ASYNC.md`

### Webhook Configuration

Orgs can subscribe to events and receive HTTP POST callbacks to their endpoints.

```typescript
// Database: webhook_subscriptions table
interface WebhookSubscription {
  id: string;
  org_id: string;
  url: string;                          // Target endpoint
  events: string[];                     // Event types: ["contract.executed", "approval.*"]
  secret: string;                       // Shared secret for signature verification
  status: "active" | "paused" | "failed";
  headers: Record<string, string>;      // Custom headers to include
  retry_config: { max_retries: number; backoff_seconds: number[] };
  failure_count: number;                // Consecutive failures
  last_success_at: string | null;
  last_failure_at: string | null;
}
```

### Delivery

```typescript
async function deliverWebhook(subscription: WebhookSubscription, event: DomainEvent): Promise<void> {
  const payload = {
    event_id: event.event_id,
    event_type: event.event_type,
    timestamp: event.timestamp,
    resource: event.resource,
    data: event.data,  // Sensitive fields redacted per org config
  };

  const signature = crypto
    .createHmac("sha256", subscription.secret)
    .update(JSON.stringify(payload))
    .digest("hex");

  const response = await fetch(subscription.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Signature": `sha256=${signature}`,
      "X-Webhook-Event": event.event_type,
      "X-Webhook-Delivery": event.event_id,
      ...subscription.headers,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),  // 10s timeout
  });

  if (!response.ok) throw new WebhookDeliveryError(response.status);
}
```

### Failure Handling

- **Retry**: exponential backoff [1s, 30s, 5m, 30m, 2h] — 5 retries
- **Circuit breaker**: after 10 consecutive failures, subscription paused, admin alerted
- **Manual replay**: admin can replay failed deliveries from webhook log

---

## 11. Feature Flag Code Integration

**Supplements**: `19-DEPLOYMENT-STRATEGY.md`

```typescript
// lib/feature-flags.ts

import { PostHog } from "posthog-node";

class FeatureFlags {
  private client: PostHog;

  async isEnabled(flag: string, context: { org_id: string; user_id: string }): Promise<boolean> {
    return this.client.isFeatureEnabled(flag, context.user_id, {
      groups: { org: context.org_id },
    });
  }
}

// Usage in API endpoint:
app.post("/api/v1/agent/draft", async (req, res) => {
  if (!await flags.isEnabled("clm.phase4.ai_drafting.enabled", req.context)) {
    return res.status(404).json({ error: "Feature not available" });
  }
  // ... proceed with drafting
});

// Usage in React component:
function ContractEditor() {
  const aiAssistEnabled = useFeatureFlag("clm.phase4.ai_assist.enabled");

  return (
    <Editor>
      {aiAssistEnabled && <AIAssistToolbar />}
    </Editor>
  );
}
```

---

## 12. Tenant Provisioning / Signup Flow

**Supplements**: Phase 1

### Flow

```
1. User signs up (Auth0/Clerk hosted page)
    │
    ▼
2. Auth webhook fires → POST /api/v1/auth/webhook
    │
    ▼
3. Backend checks: does user's email domain match an existing org?
   ├── YES → add user to existing org with default role (configurable)
   └── NO  → create new org + add user as Admin
    │
    ▼
4. For new org:
   a. Create org record with defaults
   b. Create system roles (Admin, Legal, Sales, etc.)
   c. Assign Admin role to founding user
   d. Create default Elasticsearch index for org
   e. Create default S3 prefix for org
   f. Seed sample data (optional, for trial accounts):
      - 3 sample templates (NDA, MSA, SOW)
      - 10 sample clauses
      - 1 sample workflow
   g. Queue setup wizard notification
    │
    ▼
5. User logs in → sees Setup Wizard (SCR-044) → guided configuration
```

### Domain-Based Org Matching

Enterprise customers can claim their email domain. All users with `@company.com` auto-join the org:

```typescript
// On signup: check if user's domain is claimed
const domain = email.split("@")[1];
const claimedOrg = await db.organizations.findFirst({
  where: { claimed_domains: { has: domain } },
});

if (claimedOrg) {
  const defaultRole = claimedOrg.settings.default_role ?? "viewer";
  await addUserToOrg(user.id, claimedOrg.id, defaultRole);
} else {
  await createNewOrg(user);
}
```
