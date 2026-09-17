---
name: clm-debug-multilayer
description: When an agent flow breaks in draftLegal, the bug is rarely in only one layer. Trace through API route → Python agent → config/settings → auth headers → DB scoping in that order, and don't stop after one fix. Includes the canonical "create contract from draft" four-layer case study, the auth-header gotchas (x-internal-secret, x-internal-service, x-org-id), pydantic-settings vs os.getenv, structured-error contract, and the schema-silently-drops-unknown-fields trap. Invoke when the user reports "agent is broken," "I get a 500," "agent returns blank/empty," or "this worked yesterday."
---

# Multi-Layer Debugging for Agent Flows

When the user says "the agent is broken," resist the urge to fix the first thing that looks wrong. Agent flows touch five distinct layers in this stack, and bugs usually live in two or more of them. Fixing one and stopping is how we burned hours re-debugging the same flow.

This skill is the discipline: walk the layers in order, find every bug at every layer, then fix them as one batch.

---

## The five layers (in the order to check them)

```
   user types in /agent
        │
        ▼
   ┌─────────────────────────────────┐
1. │ API route (Fastify)             │  apps/api/src/routes/agents.ts
   │ - Body schema (Zod)             │  ← drops unknown fields silently
   │ - Auth (requireAuth)            │
   │ - Forwards to Python            │
   └─────────────────────────────────┘
        │
        ▼
   ┌─────────────────────────────────┐
2. │ Python agent service (FastAPI)  │  apps/agents/app/agents/*.py
   │ - Orchestrator + step pipeline  │  apps/agents/app/orchestrator.py
   │ - Tool selection                │
   │ - LLM call                      │
   └─────────────────────────────────┘
        │
        ▼
   ┌─────────────────────────────────┐
3. │ Config / settings               │  apps/agents/app/settings.py
   │ - INTERNAL_SERVICE_SECRET       │  ← os.getenv vs pydantic-settings
   │ - API_BASE_URL                  │
   │ - LLM provider keys             │
   └─────────────────────────────────┘
        │
        ▼
   ┌─────────────────────────────────┐
4. │ Internal API headers            │  Python tool → Node API
   │ - x-internal-secret             │
   │ - x-internal-service: agents    │  ← REQUIRED, not optional
   │ - x-org-id                      │  ← REQUIRED for system-scoped
   └─────────────────────────────────┘
        │
        ▼
   ┌─────────────────────────────────┐
5. │ Internal route + DB scoping     │  apps/api/src/routes/internal-ai.ts
   │ - requireAuth honors x-org-id   │
   │ - Prisma WHERE { orgId }        │
   │ - ES query orgId scope          │
   └─────────────────────────────────┘
```

---

## The canonical case study — "create contract from draft"

This bug had a problem at **four of the five layers** simultaneously. Each layer's fix only progressed one step further. We didn't find them all until we walked the layers explicitly. Use this as the template for any agent-flow bug.

**Symptom (user-visible):** click "Generate" in NewContractFlow → spinner → generic "failed" toast. No useful error.

**Layer 1 — API route silently dropped `templateId`:**
The Fastify route's Zod body schema didn't include `templateId`. Zod's `.strip()` default means unknown fields are silently dropped. The frontend was sending `{ templateId, title, counterparty }`; the route saw `{ title, counterparty }` and forwarded that.
- **Fix:** add `templateId` to the body schema. Forward it as `context.template_id` to the Python agent.

**Layer 2 — Python agent ignored `template_id`:**
`step_select_template` in `apps/agents/app/agents/draft_agent.py` always ran the LLM-pick path, even when an explicit ID was passed. The context.template_id arrived but was never read.
- **Fix:** add an explicit-ID honoring branch at the top of `step_select_template` — if `context.template_id` is set, fetch that template directly and skip the LLM pick.

**Layer 3 — `INTERNAL_SECRET` was empty in dev:**
The Python tool used `os.getenv("INTERNAL_SERVICE_SECRET")`. The dev shell that started uvicorn didn't have it exported (only present in `.env`). `os.getenv` returned `None`. The internal call sent `x-internal-secret: ""` and got 401.
- **Fix:** switch to `from app.settings import settings; settings.internal_service_secret` everywhere. pydantic-settings reads `.env`; `os.getenv` doesn't.

**Layer 4 — Missing `x-internal-service: agents` header:**
The Python tool sent `x-internal-secret` but not `x-internal-service: agents`. Node's `requireAuth` checks **both**; one alone returns 401.
- **Fix:** add `x-internal-service: agents` to all internal calls. Treat it as required, never optional.

**(Layer 5 was actually fine — once layers 1-4 were fixed, the route worked.)**

But: a related call later failed because of a **fifth bug**:

**Layer 5 — `requireAuth` didn't honor `x-org-id` for system calls:**
The internal call passed `x-org-id` but `requireAuth` only set `request.orgId` from the JWT. For system-scoped calls (no JWT), `orgId` defaulted to `'system'` and DB queries returned empty.
- **Fix:** in `apps/api/src/middleware/auth.ts`, when internal-service auth succeeds, populate `request.orgId` from `x-org-id` header.

**Lesson:** if we'd stopped after Layer 1, the bug would still be present 4 layers deep. Walk the whole stack.

---

## Walk-the-layers checklist

Apply in this order. Each step takes <2 minutes.

### Layer 1 — API route (`apps/api/src/routes/`)

- [ ] Open the route handler. Does the Zod body schema include every field the frontend is sending? **Zod silently strips unknown fields by default.** Look for `z.object({...})` — anything not listed gets dropped without error.
- [ ] Check the `requireAuth` / `requirePermission` calls — is the user role allowed to hit this route?
- [ ] Add a `request.log.info({ body }, 'incoming')` and re-run. Compare what the route sees against what the frontend sent.
- [ ] Check the response code on the failing call (Network tab). 422 = validation error (read body). 401 = auth header missing. 403 = permission. 404 = route not registered or path mismatch. 500 = next layer.

### Layer 2 — Python agent (`apps/agents/app/`)

- [ ] Tail the agents service log: `docker logs <agents-container> -f` or wherever uvicorn writes.
- [ ] Find the request handler (typically `app/agents/<agent>.py` or `app/routes/<route>.py`). Print `context` and incoming params at the top.
- [ ] If the agent is multi-step (LangGraph), instrument each step start/end. The bug might be a step silently returning `None`.
- [ ] Check that the orchestrator system-prompt rule for this flow exists and is correct. Search `orchestrator.py` for the relevant Axx rule.
- [ ] Tool selection: which tool fired? Look for `tool_call_start` events in the stream, or log `selected_tool` in the orchestrator.

### Layer 3 — Config / settings (`apps/agents/app/settings.py`)

- [ ] Open `settings.py`. Are all required env vars defined as fields on the Settings class?
- [ ] Are there any `os.getenv(...)` calls in the codebase outside of `settings.py`? **Find and fix.** Use `settings.<field>` everywhere.
  ```bash
  rg "os\.getenv\(" apps/agents/
  ```
- [ ] In a Python REPL inside the running container:
  ```python
  from app.settings import settings
  print(settings.internal_service_secret)
  print(settings.api_base_url)
  ```
  Empty/wrong values reveal config-load bugs (typo in env var name, .env not loaded, etc.).

### Layer 4 — Internal API headers

- [ ] Every Python → Node call needs **all three** headers:
  - `x-internal-secret: <settings.internal_service_secret>`
  - `x-internal-service: agents`
  - `x-org-id: <orgId>` (for system-scoped calls — when not acting as a logged-in user)
- [ ] Verify by hand:
  ```bash
  curl -H "x-internal-secret: clm-internal-dev-secret-2026" \
       -H "x-internal-service: agents" \
       -H "x-org-id: <orgId>" \
       -H "content-type: application/json" \
       -d '{...}' \
       http://localhost:3001/api/internal/ai/tools/<name>
  ```
- [ ] Compare against what the Python tool actually sends. Add `print(headers)` before the `httpx` call.
- [ ] If `requireAuth` fails: log which check failed in `apps/api/src/middleware/auth.ts`. The error returned is generic 401; the **reason** is in server logs.

### Layer 5 — Internal route + DB scoping (`apps/api/src/routes/internal-ai.ts`)

- [ ] Does the route handler use `request.orgId`? Where does that come from?
- [ ] If `request.orgId === 'system'` (the default for system-scoped calls), are the queries scoped correctly?
- [ ] Prisma queries: `where: { orgId, ... }` — if `orgId` is wrong, you get empty results, not an error.
- [ ] ES queries: same, `term: { orgId }` filter.
- [ ] If the result is empty when it shouldn't be, log the actual SQL/ES query Prisma is generating: `prisma.$on('query', e => log.debug(e))`.

---

## Symptom → most likely layer (lookup table)

| Symptom | Most likely layer | First check |
|---------|-------------------|-------------|
| "Generic failed" toast, no useful error | Layer 1 (route silently dropped a field) or Layer 2 (untyped error converted to 500) | Add typed error contract, surface detail to UI |
| 401 on internal call | Layer 4 (auth headers) | Both `x-internal-secret` AND `x-internal-service: agents` |
| Empty results when data exists | Layer 5 (`orgId` scoping) | Log `request.orgId` in route handler |
| Agent says "I don't have access" / "I can't find it" | Layer 2 (orchestrator routing) or Layer 5 (org scoping) | Check tool_call_start events, then check orgId |
| Silent no-op (no error, nothing changed) | Layer 1 (Zod schema) or write-tool missing-payload validation | Eager validate, return `{error: 'missing_payload_keys', missing: [...]}` |
| Agent calls wrong tool | Layer 2 (orchestrator description) | Tighten the tool description to disambiguate; add an A## routing rule |
| LLM hallucinates content not in DB | Layer 2 (groundedness) — orchestrator A3 not enforced | Tool returning empty result; LLM filling in. Verify tool actually returned data. |
| Works on local, broken in deployed env | Layer 3 (config — env var missing) | Compare `.env.example` against actual env in deployed container |
| Worked yesterday, broken today | Recent migration or worker queue stuck | `git log -p` since last working state; check BullMQ worker logs |
| First request works, second doesn't | Layer 2 (multi-turn memory) — `tool_calls`+`tool_results` not persisted | See `apps/agents/app/memory.py` `append_to_session` |
| Stream cuts mid-response | Fastify body timeout in agent-chat proxy | Check `reply.hijack()` + `clientGone` flag in `apps/api/src/routes/agents.ts` |

---

## Honest error contract (what tools should return)

When in doubt, return a typed error the LLM can self-correct against. Generic 500s force the user to retry blindly.

```json
// Validation failure
{ "error": "missing_payload_keys", "missing": ["contractId", "topic"] }

// User-visible business error (not a bug)
{ "error": "NO_TEMPLATE_MATCH", "detail": "No published template matches contract type 'NDA'." }

// Auth failure (rare — usually middleware-handled)
{ "error": "internal_auth_failed", "detail": "x-internal-service header missing" }
```

The HTTP status maps:
- **200** — success
- **400** — Zod schema mismatch (frontend bug)
- **401** — internal-service auth failure (header missing or wrong)
- **403** — user role can't access (permission failure)
- **404** — resource not found OR not in user's org
- **422** — validation passed schema but business rule failed (e.g. `NO_TEMPLATE_MATCH`, `missing_payload_keys`)
- **500** — actual unhandled bug (should be rare; if you see it, raise to typed error)

The orchestrator system prompt knows to retry on 422 with corrected args; it gives up on 500.

---

## Quick smoke test after a fix

After fixing what you think is the bug, **run all five layers**:

1. **Frontend:** Click the failing flow in `/agent`. Open Network tab. Confirm request body matches what you expect.
2. **API route:** server log shows incoming body matching Network tab.
3. **Python agent:** agents service log shows the request, tool selected, tool arguments.
4. **Internal call:** look for the outbound `httpx` log line — headers + body — confirm headers present.
5. **DB:** the Prisma query log shows correct `orgId` scope; result set non-empty if data exists.

If all five show the right thing and the user-visible bug is gone — done. If any one looks off, that's the next layer to debug.

---

## Anti-patterns (real bugs we shipped)

| Anti-pattern | Why it's a trap | Fix discipline |
|--------------|-----------------|----------------|
| Stop after the first fix | The other 3 layers are still broken; bug looks "intermittent" because each retry exposes a different layer's bug. | Walk all five even when an earlier one explains the symptom. |
| `os.getenv("X")` in Python | Returns `None` if not exported; `.env` is read by pydantic-settings, not os.getenv. | `from app.settings import settings; settings.x` everywhere. |
| Zod schema `.strip()` (default) | Silently drops fields the frontend sends. | Either `.strict()` (error on unknown) or **explicitly include every field** in the schema. |
| Generic `throw new Error(...)` from a route | Becomes a 500 with no detail; user sees "failed." | Return typed errors (`reply.code(422).send({ error, detail })`). |
| Forgetting `x-internal-service: agents` | 401 — but the error is generic; you might suspect the secret. | Always send both headers. Add to a shared helper if you're writing multiple tools. |
| Forgetting `x-org-id` on system calls | Empty results, not error. | When acting on behalf of an org without a user JWT, pass `x-org-id`. |
| Catching `Exception` and returning empty | Hides the real error from the LLM and from logs. | Let exceptions surface; convert to typed errors at the route boundary only. |
| "Fixed" by tightening the probe | The bug is still there; the probe just stops detecting it. | Probes assert real-world behavior. Fix the bug, not the probe. |

---

## When the bug crosses into LLM behavior

Sometimes the layers are all healthy and the LLM still does the wrong thing. Then the issue is in the **prompt or tool description**, not the plumbing:

- LLM picks the wrong sibling tool → tool descriptions overlap. Tighten the descriptions; add an A## routing rule.
- LLM ignores tool result → orchestrator A3 (citations required) not strong enough; rewrite the rule.
- LLM asks for confirmation when it shouldn't → COMMIT-DON'T-CONFIRM rule missing/weak.
- LLM hallucinates fields → tool's response shape is too permissive (e.g. returns `{ result: ... }` when it should return strict typed fields the LLM can check existence of).

These are not infrastructure bugs. They're prompt-engineering bugs. Different fix discipline — see the `clm-agent-tool-dev` skill.

---

## File-path cheat sheet

| Layer | File |
|-------|------|
| 1 — API route | `apps/api/src/routes/agents.ts`, `apps/api/src/routes/internal-ai.ts` |
| 1 — Auth middleware | `apps/api/src/middleware/auth.ts` |
| 2 — Orchestrator | `apps/agents/app/orchestrator.py` (system prompt + A1–A12 rules) |
| 2 — Agent files | `apps/agents/app/agents/<agent>.py` (draft, review, ask, portfolio, redline, approval, …) |
| 2 — Tool memory | `apps/agents/app/memory.py` (`append_to_session` persists tool_calls + tool_results) |
| 3 — Settings | `apps/agents/app/settings.py` (pydantic-settings) |
| 4 — Internal-service auth check | `apps/api/src/middleware/auth.ts` (handles x-internal-secret + x-internal-service + x-org-id) |
| 5 — Internal routes | `apps/api/src/routes/internal-ai.ts` |
