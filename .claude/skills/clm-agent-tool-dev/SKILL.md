---
name: clm-agent-tool-dev
description: How to add or modify an agent tool in the draftLegal stack end-to-end — Python tool file in apps/agents, LangChain StructuredTool registration, orchestrator routing rule (A1-A12), REST callback endpoint in apps/api/src/routes/internal-ai.ts, frontend artifact factory with dedupeKey, and the probe to verify it works. Invoke when the user asks to add a new agent tool, modify an existing one, debug a tool that isn't firing, or wire a new orchestrator routing rule.
---

# Agent Tool Development

There are five places a new agent tool touches in this repo. Skipping any one of them is the most common cause of "the tool exists but the agent never fires it." Follow this checklist top-to-bottom and verify with a probe at the end.

This skill assumes you've already decided **what** the tool should do. Before starting, ask: is this a read tool (search/get/ask) or a write tool (mutate state)? The answer changes how it gets registered, how the LLM is told to invoke it, and what artifact it emits.

---

## The five places a tool lives

| # | Layer | File path | What you put here |
|---|-------|-----------|-------------------|
| 1 | Python tool implementation | `apps/agents/app/tools/<name>.py` | The actual logic. Calls back to Node API with internal-service headers. Returns structured dict. |
| 2 | LangChain registry | `apps/agents/app/tools/__init__.py` (or wherever the registry list lives) | Wraps the function as `StructuredTool` with name, description, args schema. |
| 3 | Orchestrator routing | `apps/agents/app/orchestrator.py` | Add a rule (Axx) telling the LLM when to pick this tool over alternatives. |
| 4 | REST endpoint | `apps/api/src/routes/internal-ai.ts` | The HTTP backend. Accepts `x-internal-secret` + `x-internal-service: agents`. Real business logic + DB. |
| 5 | Frontend artifact factory | `apps/web/src/components/agent/artifact-from-tool.ts` | Converts tool result to a renderable artifact card with stable `dedupeKey`. |

Plus one verification:
- `scripts/feature-integrity/probes/PNN-<name>.mjs` — probe asserts shape + agent firing + prose coverage.

---

## Step-by-step walkthrough

### 1. Python tool file (`apps/agents/app/tools/<name>.py`)

```python
"""<name> — one-line summary of what this tool does."""
from __future__ import annotations
import httpx
from pydantic import BaseModel, Field
from app.settings import settings  # ← NOT os.getenv

class ToolInput(BaseModel):
    org_id: str = Field(..., description="Org ID. The orchestrator passes this from session context.")
    contract_ids: list[str] = Field(..., min_items=2, max_items=10)
    topics: list[str] = Field(..., min_items=1, max_items=10)

async def run_<name>(input: ToolInput) -> dict:
    headers = {
        "content-type": "application/json",
        "x-internal-secret": settings.internal_service_secret,  # ← pydantic-settings, not os.getenv
        "x-internal-service": "agents",                         # ← REQUIRED, not optional
        "x-org-id": input.org_id,                               # ← required for system-scoped calls
    }
    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.post(
            f"{settings.api_base_url}/api/internal/ai/tools/<name>",
            json=input.model_dump(),
            headers=headers,
        )
    if r.status_code == 422:
        # Structured error — surface to LLM so it can retry with correct args
        return {"error": "validation_failed", "detail": r.json()}
    r.raise_for_status()
    return r.json()
```

**Gotchas burned into us:**
- `os.getenv("INTERNAL_SERVICE_SECRET")` returns `None` if the var isn't exported in the shell that started uvicorn. `pydantic-settings` reads `.env` — that's why we use `settings.internal_service_secret`. **Always use settings.**
- Both `x-internal-secret` AND `x-internal-service: agents` headers are required by `requireAuth`. One alone returns 401.
- `x-org-id` is required for system-scoped calls (no logged-in user). Without it, the route gets `orgId='system'` and DB queries return empty.
- Use `httpx.AsyncClient` with explicit timeout — defaults are too long, and we've seen body-timeout cascades.
- Return the raw error body (not just status) on 4xx so the LLM can self-correct.

### 2. LangChain StructuredTool registration

Find where the existing tools are registered (search for `StructuredTool(` in `apps/agents/app/`). Add yours:

```python
from langchain.tools import StructuredTool
from app.tools.<name> import run_<name>, ToolInput

<name>_tool = StructuredTool.from_function(
    coroutine=run_<name>,
    name="<name>",                    # snake_case, this is the LLM-facing identifier
    description="<one-line for LLM>", # be specific — "compare 2-10 contracts on 1-10 topics, returns matrix"
    args_schema=ToolInput,
)
```

**Description discipline:** the description is the LLM's primary signal for tool selection. Bad: "search contracts." Good: "Search contracts by name/counterparty/status. Returns paginated results with totalMatching for portfolio-wide counts. Use for 'find contract X' queries; use portfolio_search for 'how many MSAs' style aggregations." Mention what the tool is FOR and what it is NOT for.

### 3. Orchestrator routing rule (`apps/agents/app/orchestrator.py`)

The system prompt has numbered rules A1–A12 (and growing). When you add a new tool, add or edit the routing rule that disambiguates it from sibling tools.

Pattern:
```
A##. Tool routing: when the user asks "<intent shape>", use <tool>. Specifically:
  - "compare these N contracts on X" → portfolio_compare (NOT parallel portfolio_search calls)
  - "list MSAs expiring in 60 days" → portfolio_search (NOT contract_search)
  - "find the contract with Acme" → contract_search
  - "show me the indemnity clause in <contract>" → clause_search
```

**Rules already in place that you should respect:**
- **A11** — `totalMatching` honesty: for "how many" answers, read `totalMatching`, not `total`.
- **A12** — Hybrid retrieval routing (the one above).
- **COMMIT-DON'T-CONFIRM** — if the user asked for a state change in the same turn and required args are present, fire the write tool. Don't ask "shall I?"
- **Plan-then-execute** — multi-step destructive plans (>1 write tool in sequence) propose a JSON plan first, then execute on user confirmation. Single-write tools fire directly under COMMIT-DON'T-CONFIRM.
- **Tool budget** — per-tool max 3 calls, total max 25 per turn. Orchestrator enforces; tool itself doesn't need to.

### 4. REST callback endpoint (`apps/api/src/routes/internal-ai.ts`)

```ts
// In internalAiRoutes registration
fastify.post('/tools/<name>', async (request, reply) => {
  const body = ZodSchema.parse(request.body)  // validate eagerly
  const orgId = request.orgId  // populated by requireAuth from x-org-id

  // Required-keys validation if this is a write tool — return structured error
  const missing = []
  if (!body.contractId) missing.push('contractId')
  if (missing.length) {
    return reply.code(422).send({ error: 'missing_payload_keys', missing })
  }

  // Real DB work
  const result = await prisma.<model>.findMany({ where: { orgId, ... } })

  // Honesty: include totalMatching distinct from total (page size)
  const [results, totalMatching] = await Promise.all([
    prisma.<model>.findMany({ where, take: 50 }),
    prisma.<model>.count({ where }),
  ])

  return { results, total: results.length, totalMatching }
})
```

**Internal-service auth** is enforced by the existing `requireAuth` middleware in `apps/api/src/middleware/auth.ts`. It checks:
1. `x-internal-secret === INTERNAL_SERVICE_SECRET`
2. `x-internal-service === 'agents'`
3. `x-org-id` populates `request.orgId` for org scoping

If any of those is missing, you get 401. If you're adding a new internal route and getting 401, the issue is upstream in the Python tool not the route.

**Audit events:** if this is a write tool, emit an audit event:
```ts
await emitAuditEvent({ orgId, action: '<tool>.executed', resourceId, userId: 'agent', metadata: {...} })
```

### 5. Frontend artifact factory (`apps/web/src/components/agent/artifact-from-tool.ts`)

```ts
import { stableKey } from './stable-key'

export function from<Name>(toolResult: <Name>Result): <Name>Artifact {
  return {
    type: '<name>',
    dedupeKey: stableKey('<name>', /* stable fingerprint of inputs */),
    // … the rest of the renderable payload
  }
}
```

**dedupeKey discipline:** `stableKey(toolName, fingerprint)` where `fingerprint` is something deterministic from the inputs:
- `contract_search`: query string + filters hash
- `portfolio_compare`: sorted contract IDs joined + sorted topics joined
- `clause_search`: query + contractId

The consumer (`ActionPreview` or the artifact pane) uses dedupeKey to **replace** rather than **stack**. Without dedupeKey, the same tool firing twice produces two cards.

**ActionPreview vs read artifact:**
- Read tools (search/get/ask) → render directly as informational artifact card.
- Write tools → render as `ActionPreview` chip showing the diff. User clicks Apply → fires the staged tool with staged args. Cancel discards.

### 6. Probe (`scripts/feature-integrity/probes/PNN-<name>.mjs`)

Use the standard probe template from the `clm-qa-playbook` skill. Three checks:

1. **Direct API call** to `/api/internal/ai/tools/<name>` returns expected shape (use `INTERNAL_SERVICE_SECRET` + `x-internal-service: agents` + `x-org-id`).
2. **Agent fires the tool** for the right natural-language query — assert on `tool_call_start` events from `streamAgentChat`.
3. **Prose covers the tool's output** — for `portfolio_compare`, both contract names should appear in the assistant's reply (catches the "I only looked at the first one" failure).

Soft-pass when the LLM picks an alternate tool but still answers correctly — note in evidence string. Don't make probes brittle to model phrasing.

---

## Anti-patterns to avoid

| Anti-pattern | What goes wrong | Fix |
|--------------|----------------|-----|
| Silent no-op on missing payload | Agent thinks the tool succeeded; returns confidently wrong answer. | Validate required keys, return `{error: 'missing_payload_keys', missing: [...]}`. |
| `total: results.length` | Agent claims "50 contracts" when real count is 313 (page-1 of many). | Add `totalMatching` from a `count()` query; orchestrator A11 reads it. |
| Asking for confirmation on every write | UX feels timid; user says "yes obviously." | COMMIT-DON'T-CONFIRM rule — fire directly when args are present. |
| New artifact stacks duplicates | UI fills with identical cards on retries. | Always emit `dedupeKey: stableKey(toolName, fingerprint)`. |
| Tool description = "does X" | LLM picks the wrong sibling tool. | Description names the intent shape, not the action. Mention what it's NOT for. |
| Multi-doc compare via parallel single-doc tools | LLM synthesizes prose that only covers the first doc. | Build a dedicated structured tool that returns a matrix. |
| `os.getenv("INTERNAL_SERVICE_SECRET")` | Returns None when var not exported; tool 401s in dev. | `from app.settings import settings; settings.internal_service_secret`. |
| Forgetting `x-internal-service: agents` | 401 on every internal call. | Both headers, every call, no exceptions. |
| Forgetting `x-org-id` on system calls | DB returns empty for orgId='system'. | Pass `orgId` from session context through to the header. |

---

## Read tool vs write tool — the differences

| Aspect | Read tool | Write tool |
|--------|-----------|------------|
| Auto-execute | Yes — fires on selection | Only under COMMIT-DON'T-CONFIRM (single-write) or Plan-then-execute (multi-write) |
| Artifact type | Direct render (search results, contract card, etc.) | `ActionPreview` chip with diff |
| Required-keys validation | Optional | **Required** — return `{error: 'missing_payload_keys', missing: [...]}` |
| Audit event | Optional | **Required** — emit on success |
| Probe assertion | Tool fires + prose grounded in result | Tool fires + DB state changed + audit event written |

---

## Where things live (cheat sheet specific to tools)

| Need | File |
|------|------|
| Add a tool's Python logic | `apps/agents/app/tools/<name>.py` |
| Register tool with LangChain | search `StructuredTool.from_function` in `apps/agents/app/` |
| Orchestrator system prompt | `apps/agents/app/orchestrator.py` (rules A1-A12) |
| Tool memory persistence | `apps/agents/app/memory.py` (`append_to_session` writes tool_calls + tool_results) |
| Internal-service settings | `apps/agents/app/settings.py` (pydantic-settings) |
| REST endpoint | `apps/api/src/routes/internal-ai.ts` |
| Auth middleware | `apps/api/src/middleware/auth.ts` (handles internal-service + x-org-id) |
| Permissions | `apps/api/src/lib/permissions.ts` (rarely needed for agent tools — use system role) |
| Artifact factory | `apps/web/src/components/agent/artifact-from-tool.ts` |
| ActionPreview component | `apps/web/src/components/agent/ActionPreview.tsx` |
| Stable-key helper | `apps/web/src/components/agent/stable-key.ts` |
| Probe harness | `scripts/feature-integrity/lib/harness.mjs` |

---

## Quick verification after a change

1. **Python boots clean** — `pnpm dev` (or however agents service starts) — no import errors.
2. **Direct curl** — hit `/api/internal/ai/tools/<name>` with proper headers, eyeball the JSON shape.
3. **Agent fires it** — open `/agent`, ask the natural-language query that should trigger the tool, watch the network tab for the `tool_call_start` event with `name: '<name>'`.
4. **Probe passes** — `node scripts/feature-integrity/run.mjs P##-<name>`.
5. **Tracker** — append a session log row in `BUILD_TRACKER.md` describing what you added; ADL row only if the tool introduces an architectural pattern (rare).

---

## When NOT to add a new tool

- **The existing tool just needs a different filter** → extend the existing tool's args schema instead. Don't proliferate near-duplicate tools.
- **The user wants different formatting** → that's an orchestrator output-format rule, not a new tool.
- **It's a one-off scripted task** → write a `scripts/*.ts` one-shot, not a tool. Tools are for things the agent should fire repeatedly across users.

A new tool is justified when: (a) the LLM cannot reliably accomplish the task by chaining existing tools, or (b) the existing chain produces unreliable output (e.g. multi-doc compare via parallel calls).
