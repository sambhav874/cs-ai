# 29 — App-wide agent: plan

> **Scope**: the agent that operates *as the interface to the app itself* — starts tasks for the user, takes actions across contracts / requests / approvals / counterparties, and rides along contextually on every page.
> **Not this plan**: AI that operates *on* contracts (extraction, clauses, playbook, drafting) — that's `docs/28-AI-PLAN.md`.
> **Written**: 2026-04-24, after a scan of Harvey / Claude.ai / ChatGPT / Perplexity / Notion 3.0 / Linear / Cursor 3 / Salesforce Agentforce / Microsoft 365 Copilot / Arc-Dia / Raycast / Attio / Monday / Asana / Ironclad Jurist, plus the agent-design engineering guidance from Anthropic (Messages API + Tool Runner + tool search), OpenAI function-calling, Vercel AI SDK 5/6, assistant-ui, Smashing's 2026 agentic-AI UX patterns, and the 2026 MCP enterprise roadmap.

---

## 1. The problem

You asked for two things:

1. **A main agent** as the primary entry — possibly above the dashboard. Do anything the app can do from one chat.
2. **A contextual side agent** across the entire app. Knows what page you're on. Can help with the current task.

The design question under that: **does the agent REPLACE the dashboard (agent-first), SIT ABOVE it, or LIVE BESIDE it?** The research says this is the highest-leverage UX decision in the whole plan.

---

## 2. What the market actually does

Thirteen products examined. They cluster into **three patterns**:

| Pattern | Used by | What it feels like |
|---|---|---|
| **A. Agent-first landing** (composer IS the home) | Harvey, Claude.ai, ChatGPT, Perplexity, M365 Copilot (web), Raycast, Dia | Blank prompt, big composer, suggestion chips. No dashboard. |
| **B. Hero band above dashboard** (agent AND dashboard on the same scroll) | **Attio** (cleanest), Harvey (with Recent Threads under composer), M365 Copilot Chat home | Prompt box at the top of the page; tasks / meetings / widgets below on the same screen. |
| **C. Dashboard-first with agent companion** (side panel / utility button) | Salesforce Agentforce, Ironclad Jurist, Notion Q&A sidebar, Cursor Composer, M365 Copilot in Word/Excel | Your existing dashboard is untouched; an agent panel opens from a header icon / keyboard shortcut. |
| **D. Command-palette only** (no hero, no pane) | Linear | ⌘K does everything. Agents are first-class assignees on issues. |
| **E. Hybrid** (two surfaces sharing memory) | Harvey (Assistant home + Vault agents), Notion 3.0 (inline + sidebar + home agents), M365 Copilot (app chat + Office panes), Attio (home hero + per-record Ask Attio) | Main agent lives on home; contextual agent lives in every record/page. Memory is shared. |

### The big empirical findings

- **Agent-first landing is right for creation tools** (Harvey, Claude) but **wrong for systems of record** with operational queues. Reviews consistently complain when a transactional SaaS replaces the dashboard with a composer. You lose "glance to know what's on fire."
- **Attio is the cleanest live example of "hero above dashboard"** for a CRM — `Ask Attio` composer at the top + upcoming meetings / tasks / widgets below on the same page. Reviewed positively for doing both without sacrificing either.
- **No CLM today does Pattern B.** Ironclad, Sirion, LinkSquares, SpotDraft all keep the dashboard as the home and bolt Jurist / their agent onto a side panel. **This is a design opening for us.**
- **Per-page agent as a side panel is already table-stakes** — Jurist in the .docx editor, Agentforce on a record, Notion AI in the sidebar, Copilot in Word. Users love page-context awareness. Anything less feels dated.
- **Dual-surface with shared memory is the Holy Grail** — users hate two chat surfaces that don't know about each other. Notion explicitly unified inline and sidebar in 3.0 for this reason.

---

## 3. Recommendation

### Pattern B + Pattern E — hero band above the dashboard, plus a global contextual side panel with shared memory.

**Why not Pattern A (replace the dashboard)**:
- CLM users have strong habitual queues: approvals waiting, expiring contracts, my requests, recent activity, team workload. These are dashboard problems. Erasing them breaks the product's operational value.
- Harvey can get away with agent-first because there's no queue to triage — it replaces *creation*. Ironclad, which has both creation AND a pipeline, keeps a dashboard home. Our shape is Ironclad's, not Harvey's.

**Why not Pattern C (just a side panel, no hero)**:
- Every legacy CLM does this. It undersells the "agent-first" identity we want.
- Forces users to discover the agent. Not load-bearing in the UI hierarchy.

**Why Pattern B (hero above dashboard)**:
- Attio proved it works for CRM. Same category shape as ours (transactional SaaS with a standing queue).
- Agent is first thing users see after login → signals AI is the core of the product.
- Dashboard is still visible below → muscle-memory preserved, nothing lost.
- Agent starter prompts can pull from the user's actual queue: "Send Zynga MSA for approval", "Summarise expiring contracts", "Find all NDAs with uncapped liability". That pulls the two into one experience.

**Why Pattern E (add a side panel too)**:
- On a contract detail page, the user wants the agent to know *which contract*. Opening the hero agent, typing "the contract I'm looking at", pasting the URL — all friction.
- A per-page side panel shares memory with the hero (same thread list, same memory, different default context scope) and always knows the current page.
- This is the Ironclad + Jurist pattern, but with our agent also being the hero. Best of both.

### What this looks like on screen

```
/dashboard
┌──────────────────────────────────────────────────────────────────────────┐
│  Welcome back, Admin                                                     │
│                                                                          │
│  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│  ┃  ✨  Ask me anything                                                ┃ │  ← HERO AGENT
│  ┃                                                                    ┃ │     (Pattern B)
│  ┃  [Send Zynga MSA for approval]  [Draft an NDA for Acme Corp]      ┃ │
│  ┃  [What's expiring in Q2?]       [Show me all uncapped-liability]  ┃ │
│  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                          │
│  Your day: 1 approval · 2 expiring · 2 drafts                           │  ← existing dashboard
│                                                                          │
│  Active Contracts · Open Requests · Pending Approvals · Expiring Soon   │
│                                                                          │
│  Upload Contract · New Request · View Approvals                         │
│                                                                          │
│  Recent Activity ...                                                     │
└──────────────────────────────────────────────────────────────────────────┘

/contracts/:id                                      ┌─────────────────────┐
┌─────────────────────────────────────────────────┐ │  ✨ Agent           │  ← SIDE AGENT
│  ← WPT Enterprises - Zynga License Agreement    │ │                     │     (Pattern E)
│  [Status] [Type] [Risk 75%]                     │ │  Context:           │
│  Send for Review · Ask AI ⌘K · Actions ▾        │ │  📄 This contract   │
│                                                 │ │                     │
│  [document canvas]                              │ │  "Summarise risks"  │
│                                                 │ │  "Compare to MSA    │
│                                                 │ │   template"         │
│                                                 │ │  "Who approves      │
│                                                 │ │   this?"            │
│                                                 │ │                     │
│                                                 │ │  [conversation ...] │
│                                                 │ │                     │
│                                                 │ │  [composer ...]     │
└─────────────────────────────────────────────────┘ └─────────────────────┘
```

### How the four AI surfaces relate

You already have three. This plan adds one and upgrades one.

| Surface | Purpose | Status | What changes |
|---|---|---|---|
| **Hero agent** (dashboard) | Start an open-ended task from login | **NEW** — this plan | Add |
| **Side agent** (right panel, global) | Contextual help on the current page / take actions | **Upgrade of existing ChatPanel** (today just a chat drawer) | Upgrade into full side agent with tool-use + Intent Preview + per-page context |
| **⌘K contract-scoped palette** (detail page) | Quick grounded Q&A on the open contract | ✅ B.5.9 already built | Keep as-is. Narrow purpose: fast Q&A, not action. |
| **⌘/ global search palette** (every page) | Find an entity, jump there | ✅ B.6.25 already built | Keep as-is. Pure navigation. |

Two agents share the same memory + thread list + toolset. Differences are defaults: Hero opens a *fresh thread* with *no context*; Side agent opens with *current page as context* and you can switch to any thread. A user can start a task in the hero, then walk through the app with the side agent continuing the same thread.

---

## 4. User journeys (JTBD)

Five journeys cover 80% of volume. The plan is validated against these.

### JTBD-1 — "Start my day"
*"I just logged in. Tell me what needs me and queue up the fastest thing."*

1. Land on `/dashboard`. Hero agent shows starter chips pulled from the "Your day" band: `[Review 1 approval]`, `[Send 2 expiring renewals]`, `[Triage 2 drafts]`.
2. Click `Review 1 approval` → hero routes to `/approvals` with a side-panel primer: "You have 1 approval from submitterX on Zynga MSA; risk 75%; top blocker is liability cap."
3. User decides → approve/reject/delegate, still inside the side panel.

### JTBD-2 — "I need to draft a contract right now"
*"Draft an NDA for Acme, mutual, 2-year term, California law."*

1. Hero agent composer → user types the sentence. Agent's **plan surface**: "I'll (1) search for an NDA template, (2) draft with these variables, (3) open the draft for review."
2. User confirms. Agent calls `contract_create_from_template` → artifact opens as a **draft card** inline in the thread.
3. Apply → land on `/contracts/:id` with side panel still active, thread preserved.

### JTBD-3 — "Ask about my portfolio"
*"Which of my MSAs have uncapped liability?"*

1. Hero agent. Agent picks `contract_search` with filter `clause_flag:uncapped_liability`.
2. Returns a tabular artifact with 7 contracts + clickable links. User clicks a row → opens contract detail; side panel comes along with the thread.

### JTBD-4 — "Help me on this page"
*I'm reading a contract. "Is the indemnification one-sided?"*

1. On `/contracts/:id`, open side panel. Context auto-populated: `📄 WPT Enterprises — Zynga Agreement`.
2. Agent calls `clause_search` + `playbook_check` in parallel, returns answer with a clickable citation that highlights the clause in the canvas.

### JTBD-5 — "Do something at scale"
*"Send all MSAs over $100k in US jurisdiction for Legal-Tier-2 approval."*

1. Hero. Agent returns **plan surface**: 5-step plan, identifies 8 matching contracts, shows the list.
2. User reviews the list in an artifact, maybe removes one.
3. Confirm → agent calls `approval_route` 7 times, each one a single transaction with a receipt. Action receipts stack in the thread. Total elapsed: 15 seconds instead of 10 minutes of clicking.

Each journey must work with both surfaces. The side-panel variant of JTBD-3 is: open side panel from any page, ask the same question — the answer is identical because tools + memory + model are shared.

---

## 5. The side panel — anatomy (from research)

Docked right-side pane. 420 px default, 360-640 range, user-resizable + persisted. Collapses to a 48 px edge rail. Below 1024 px it becomes a full-screen drawer. Components (top → bottom):

1. **Header** — agent avatar, "New thread", thread picker (history), model picker (power-user, hidden by default), close / collapse.
2. **Context chip row** — visible pills showing what's in scope: auto-populated `📄 current page` + any `@mentions` the user added. Each pill removable.
3. **Conversation area** — user messages, assistant text, tool-call trace blocks, artifact cards, citations. Auto-scroll with "jump to bottom" button on overflow.
4. **Tool-call trace block** — one per tool, collapsed by default for read tools ("🔍 Searched contracts (1.2s)"), expanded by default for write tools ("✏️ Routing approval — see details").
5. **Thinking block** — if the model emits thinking tokens, render above answer in muted italic, collapsible. Don't hide.
6. **Action-preview card (Intent Preview)** — dedicated card when the agent wants to *mutate*: proposed change, before/after diff, `Apply` + `Edit & Apply` + `Cancel`. This is the single highest-leverage trust component.
7. **Citation surface** — inline superscripts / "Sources" footer linking to the underlying contract / clause / record. Clickable = highlight on the source.
8. **Composer** — multi-line, `Shift+Enter` for newline, `/` slash commands, `@` mentions, file attachment. Shows streaming state.
9. **Context-window meter** — `15K / 200K` small bar at bottom. Power-user info; tells them when to start a new thread.
10. **Quick-action rail** — above the composer, scoped to the current page. On contract detail: `Summarise risks`, `Compare to playbook`, `Draft counter-redline`. On dashboard: `What needs me today?`, `Create request`.
11. **Autonomy toggle** — at minimum two stops: **Ask** (read-only, no tools execute) vs **Act** (tools execute with Intent-Preview confirmation). Power users can later unlock **Act autonomously**.
12. **Footer keyboard hints** — `Esc` to close, `↵` to send, `⌘/` for global search.

The hero agent is visually similar but lives full-width on the dashboard and has no context chip row (no current-page context). Thread list is shared.

---

## 6. Tool catalog

### Principle

Per Anthropic's engineering guidance (["Writing effective tools for AI agents"](https://www.anthropic.com/engineering/writing-tools-for-agents)): target **12-20 tools active per turn**; prefer **workflow-shaped tools** (`schedule_event`) over **CRUD tools** (`list_events + create_event`); namespace (`contract_search`, `approval_route`). Use `defer_loading` + tool search for anything beyond the core 20.

### Starter catalog (15 tools)

Every tool already has a backing API endpoint with `requirePermission()` enforced — agent inherits RBAC automatically.

#### Read (parallel-safe)

| Tool | Backing endpoint | Purpose |
|---|---|---|
| `contract_search(query, filters{status, counterparty, value_range, jurisdiction, owner, date_range, clause_flag}, top_k, response_format)` | `GET /contracts`, `POST /search/advanced` | "Find me contracts matching X" — one broad tool, rich filters |
| `contract_get(contract_id, include{metadata, clauses, parties, obligations, approvals, history, risks})` | `GET /contracts/:id` + extensions | Full record + composable `include` set so agent asks for what it needs |
| `contract_summarize(contract_id, focus{risk, obligations, key_terms, deviations_from_playbook}, length)` | `POST /contracts/:id/ask` with canned prompt | Focused summaries, not a generic summary |
| `clause_search(query, scope{this_contract, playbook, org_library}, top_k)` | Wraps `/search/advanced` + `/clauses` + pgvector | Clause-level RAG; the #1 CLM Q&A pattern |
| `playbook_check(contract_id, playbook_id?)` | New — wraps `playbook_agent` | Deviations with severity + quoted span |
| `approval_list(filters{status, assignee, overdue_only, matter_id})` | `GET /approvals/my-queue` + ext | "What's on my plate?" |
| `counterparty_get(counterparty_id_or_name, include{contracts, last_activity})` | `GET /counterparties/:id` | Relationship summary |
| `audit_log_query(entity_id, actions, date_range)` | New endpoint — needed for compliance questions | Enterprise must-have |

#### Write (each passes through Intent Preview)

| Tool | Backing endpoint | Purpose |
|---|---|---|
| `contract_create_from_template(template_id, counterparty, variables, matter_id)` | `POST /templates/:id/generate` | Workflow-shaped; the 80% draft-from-template flow |
| `contract_update(contract_id, action{set_status, assign_owner, add_tag, link_to_matter, retype}, payload)` | `PATCH /contracts/:id`, `POST /contracts/:id/retype`, `POST /contracts/:id/analyze` | Action-enum pattern keeps catalog small; UI routes action → action-specific Intent Preview |
| `redline_propose(contract_id, playbook_id|instructions)` | Wraps `redline_agent` | Returns a **redline set as preview artifact** — never applies directly |
| `redline_apply(contract_id, redline_set_id, mode{accept_all, selected}, selected_ids)` | New — applies via OOXML tracked-changes | Separate tool = UI slots Intent Preview card between propose and apply |
| `approval_route(contract_id, workflow_id|approvers, note)` | `POST /approvals` + workflow engine | Routes via existing workflow — does not create a new one |
| `request_create(title, type, counterparty, description, priority)` | `POST /requests` | Agent can file intake on user's behalf |
| `comment_add(entity_id, body, mentions)` | `POST /comments` | Low-risk write — good first agent action |

#### Deferred / tool-search-loaded (load on demand, not active per turn)

- Integration tools: `salesforce_opportunity_get`, `slack_notify`, `gmail_send`
- Admin tools: `user_invite`, `role_assign`, `playbook_edit`
- Rare-use tools: `signature_send` (hardest-gated — requires type-to-confirm), `contract_archive`, `version_promote`

### Action UX pattern (Intent Preview)

For each write tool, the agent's turn emits:
1. A **plan message** ("I'll route this to Legal-Tier-2 for $150k threshold review")
2. A **tool_use block** with `dry_run: true` → backend returns what *would* happen
3. The UI renders an **Intent Preview card** with diff / proposed values / `Apply` / `Edit & Apply` / `Cancel`
4. On Apply → the *same* tool fires with `dry_run: false`
5. Tool returns an **action receipt** (append-only audit row + undo hook where reversible)

For destructive-external actions (`signature_send`) require **type-to-confirm** ("type 'SEND' to confirm") — never single-click.

---

## 7. Memory + threads

### Three layers (same logic as context)

- **Per-conversation (ephemeral)** — a single thread. Default for hero.
- **Per-entity thread (persistent-scoped)** — one thread per contract / counterparty / matter. Agent remembers what was discussed about that entity across sessions.
- **Workspace memory** — per-org knowledge base (playbook library, templates, past deals). Org-scoped, never cross-tenant. This replaces "ChatGPT-style user memory" — we scope to org, not user, so privilege/confidentiality stay clean.

### Recommended default

**Per-Matter thread** is the primary unit. A Matter owns contracts, approvals, tasks, *and* conversation threads. A user returning to a matter sees prior conversations as a sidebar list.

- When you're on `/dashboard` → hero opens a fresh thread (not scoped).
- When you're on `/contracts/:id` → side agent defaults to the thread for that contract's parent Matter. Create a new thread inside the matter or continue the existing one.
- A "Threads" drawer at the top of the side panel shows recent threads scoped to the current entity.

Matches **Harvey Shared Spaces** and **Claude/ChatGPT Projects**.

---

## 8. Architecture

Adapts the reference architecture from docs/28 with Anthropic's native Tool Runner pattern.

### Agents service (Python / FastAPI)

- **Anthropic Messages API directly** with the `ToolRunner` helper. Handles the agentic loop, parallel tool calls, `tool_use_id` bookkeeping automatically. No LangGraph for the app-agent — this is a single agent with many tools, not a multi-agent orchestration, and LangGraph is over-engineered for that.
- **Prompt caching** on system prompt + tool definitions (stable across turns, huge — 70-90% token cost cut).
- **Extended thinking** ON with `tool_choice: auto`. Surface thinking blocks as collapsible in the UI.
- **Tool search + `defer_loading`** for any tools beyond the core 15.
- **`strict: true`** on every write tool; add **`input_examples`** (3-5 per tool) for complex tools with many filters.
- **Per-tool audit** — every tool call captured with resolved user/org/matter scope, prompt, result.

### API layer (Node / Fastify)

- **Tool execution lives here**, not in the agents service. Agents service emits `tool_use` blocks; Fastify resolves each against our domain (contracts, approvals, comments), enforces RBAC, returns `tool_result`. Keeps LLM out of RBAC decisions.
- **SSE** endpoint for streaming. Proxy Anthropic's stream through to the client — don't terminate + re-emit.
- **Idempotency keys** on mutating tool endpoints. Agent might retry; we don't want duplicate side effects.
- **Per-tenant daily cap** + per-tool rate limit.

### Frontend (React + Vite)

- **`@assistant-ui/react`** or **Vercel AI SDK 5/6**. Both ship streaming, auto-scroll, retries, attachments, markdown, tool-call UI. `assistant-ui` is more composable (Radix-style primitives) and has **Generative UI** for tool calls — custom components per tool-call type, which is exactly what Intent Preview cards are.
- **Custom tool-call UI components** for the high-value tools: `<RedlinePreview />`, `<ApprovalRouteCard />`, `<ContractSearchResults />`. The agent calls the tool; we render a typed card, not raw JSON.
- **Panel shell**: shadcn/ui `Sidebar` with `side="right"`, resizable (360-640 px), collapsible to a 48 px rail. Full-screen drawer < 1024 px.
- **Shared store (Zustand)** for both surfaces — the hero and side panel read/write the same `threads`, `activeThreadId`, `contextChips`.

### Observability + evals

- **Langfuse** (shared with docs/28 Wave 0) — every agent run traced.
- **Per-tool latency + success metrics** broken down by tool name. How we find the `contract_search` that times out 10% of the time.
- **Evaluation suite** for agent behaviour: golden journeys (JTBD-1 through 5), expected tool sequence, expected final artifact. Run in CI on every prompt / tool change.

---

## 9. Model selection for the app agent

From docs/28 model work, refined for this use case:

| Situation | Model | Reason |
|---|---|---|
| **Default** | **Claude Sonnet 4.6** | 1M ctx now GA at flat pricing; $3/$15; strong tool-use; fast enough for interactive |
| **Hard reasoning / plan surface** | **Claude Opus 4.7** | Literal instruction-following, better at multi-step plans. Escalate when tool loop > 3 steps or when the user toggles "Deep thinking" |
| **Triage / route / cheap classifier** | **Haiku 4.5** | $1/$5, near-Opus on structured output; runs the "which tool should I pick?" classifier in parallel |
| **Streaming ghost-text / low-latency completions** (from docs/28 E) | **Haiku 4.5** | Lowest-latency frontier |
| **Avoid** | Any Gemini in the authoritative path | 86% hallucination rate on AA-Omniscience unknowns; US courts have sanctioned attorneys for Gemini-fabricated citations. Use as retriever only if at all. |

One backend config per flow — hero agent Sonnet 4.6, "Deep thinking" toggle → Opus 4.7, side-panel default → Sonnet 4.6. All reversible per-flow.

---

## 10. Trust + safety

- **Role-based tool gating at the service boundary**. Agents service filters the `tools` array per request based on caller's role. Don't let the model see tools it isn't allowed to call — don't rely on it to refuse.
- **Dry-run first on all mutating tools** — `dry_run: true` returns "what would happen" without mutating. Powers Intent Preview.
- **Undo / rollback** — every reversible action produces an action receipt with a rollback hook (15-min window min, until end of session for sensitive).
- **Scope lock** — every tool call carries `scope_id` (matter, org, tenant) enforced at tool-execution boundary, not in prompt.
- **Audit log** — every prompt, every response, every tool call + params + result, every reviewer action, all captured in our existing append-only audit log (hash-chained — see docs/28 Wave 7).
- **Confidence surfacing** — when the model is uncertain, render low-confidence answers with visible warning; require citations.
- **Loop detection** — max iterations cap (default 15 steps); repeat-call detection; short loops with user checkpoints.
- **Safety drift mitigation** — re-inject guardrails after every N steps; keep system prompt short + explicit; prefer short agent loops over long runaway chains.

---

## 11. Failure modes to design against (from research)

1. **False-confidence hallucinated actions** — mitigation: Intent Preview + confidence signal + citations
2. **Scope creep** ("was asked to do X, also does Y") — plan surface before multi-step
3. **Cascading errors** (hallucinated step 1 → wrong step 2) — staged apply, user checkpoints
4. **Context loss mid-task** — per-matter threads, explicit TODO list rendered in panel
5. **Tool parameter hallucination** — strict mode + input_examples + resolved IDs not names
6. **Operational hallucination** (infinite tool loops) — loop detection, max iterations, repeat-call guard
7. **Safety drift** in long loops — re-inject system prompt, keep loops short
8. **Bad citations** (cited clause says opposite of claim) — verify citations server-side before rendering
9. **Over-eager escalation** (everything flagged as high risk) — calibrate with real examples, not rule-only
10. **"I'll do it for you" without asking** — every mutating action must pass confirmation unless user has explicit autonomy-on toggle

---

## 12. Rollout waves

Same methodology as docs/27 and docs/28 — one commit per item, JTBD + reference + verify + screenshots. C = "Conversational/app agent", distinct from B (UX polish) and the contract AI waves in docs/28.

### Wave C0 — Foundation (shared with docs/28 Wave 0; no user-facing change)

- **C.0.1** Langfuse tracing on all agent calls
- **C.0.2** Model registry refresh (Opus 4.7, Sonnet 4.7, Haiku 4.5 across the board)
- **C.0.3** Per-tenant cost cap + per-tool rate limit
- **C.0.4** Zustand `useAgentStore` — threads, activeThreadId, contextChips

### Wave C1 — Side agent foundation (highest-leverage for existing users)

- **C.1.1** Upgrade `ChatPanel` → `SideAgent`: shadcn Sidebar right, 420 px default, collapsible
- **C.1.2** Auto-context chip from URL (`/contracts/:id` → `📄 {title}`)
- **C.1.3** Wire Anthropic Messages API + ToolRunner server-side; SSE stream to client
- **C.1.4** First three read tools: `contract_search`, `contract_get`, `contract_summarize`
- **C.1.5** Tool-call trace block component (collapsible); citation chip component
- **C.1.6** Thread picker + "New thread" button; threads persist per user
- **C.1.7** Quick-action rail keyed on current page type

Demo: open any contract, side agent auto-knows which one, ask "summarise risks", get streamed answer with clickable citations.

### Wave C2 — Hero agent on the dashboard (the "above dashboard" ask)

- **C.2.1** `HeroAgent` component on `/dashboard`, above KPIs, below greeting
- **C.2.2** Starter chips pulled from user state (approvals, expiring, drafts) — dynamic, not static
- **C.2.3** Shared thread store with Side agent (same memory, different default context)
- **C.2.4** First two write tools behind Intent Preview card: `comment_add`, `request_create`
- **C.2.5** Plan surface component — when the agent plans multi-step work, show plan card before first tool call

Demo: land on dashboard, type "Draft an NDA for Acme Corp", see plan, confirm, draft opens.

### Wave C3 — Actions + Intent Preview

- **C.3.1** Intent Preview card framework: `<ActionPreview tool={...} payload={...} onApply onEdit onCancel />`
- **C.3.2** Tools: `contract_update` (action enum: set_status, assign_owner, …), `approval_route`
- **C.3.3** Type-to-confirm speed bump for destructive actions (hook for `signature_send` later)
- **C.3.4** Action receipts with undo hook (15-min window)
- **C.3.5** Audit log entries for every tool call

### Wave C4 — Playbook, redline, portfolio-level actions

- **C.4.1** `playbook_check(contract_id)` tool — calls docs/28 Wave 2 playbook compare
- **C.4.2** `redline_propose` + `redline_apply` as propose/apply pair with RedlinePreview card
- **C.4.3** Multi-contract artefacts — `contract_search` result renders as tabular artifact with row-click-to-open
- **C.4.4** Batch actions — agent can apply same action across a search result set (with staged-apply summary)

### Wave C5 — Memory, scope, Matters

- **C.5.1** Matter model (migration): Matter owns contracts + requests + approvals + threads
- **C.5.2** Per-matter thread sidebar in the side agent
- **C.5.3** `@mention` in the composer — pull a contract / counterparty / approval into context
- **C.5.4** Org knowledge base — playbook + templates + past deals — as a global memory layer

### Wave C6 — Power + polish

- **C.6.1** Autonomy toggle (Ask / Act) in side-panel header
- **C.6.2** Slash commands in composer (`/summarise`, `/redline`, `/search`, …)
- **C.6.3** Voice input
- **C.6.4** Deep-thinking toggle — swaps Sonnet 4.6 → Opus 4.7 for hard tasks
- **C.6.5** Agent-as-assignee (Linear pattern) — mention the agent on a contract/request, it picks up the task

### Wave C7 — Enterprise

- **C.7.1** PII redactor at the boundary if VPC mode
- **C.7.2** Per-tool role-based gating + documentation for security review
- **C.7.3** Workspace memory boundaries documented + audit-ready

---

## 13. Bets + passes

### Bets (high-yield, evidence-backed)

1. **Hero agent above dashboard is the single most-differentiating entry-point decision** — no CLM does it today, Attio proves it works for the adjacent CRM category. Real opportunity.
2. **Dual-surface with shared memory** — hero + side panel. Notion explicitly unified for this reason. Matches how users actually work.
3. **Intent Preview card** — more trust-leverage than any other UX component for enterprise. Smashing's 2026 guide calls it table-stakes.
4. **Workflow-shaped tool catalog (15 tools)** — Anthropic guidance is explicit; CRUD-shaped catalogs bloat and confuse the model. Start with 15.
5. **Per-Matter threads** as the default memory unit — matches Harvey Shared Spaces, Claude/ChatGPT Projects.
6. **Anthropic Messages API + ToolRunner** — not LangGraph for this single-agent case. Less code, handles parallel tool calls, more reliable.

### Passes (at least for v1)

1. **Agent-first landing (Pattern A)** — CLM users have operational queues; replacing the dashboard with a composer breaks the product's value. Revisit if we launch a creation-only mode.
2. **Multi-agent orchestration** (CrewAI / specialist sub-agents) — over-engineered for this. Our "7 LangGraph agents" are domain pipelines (extract / redline / draft), not user-facing agents. One user-facing agent with a rich tool catalog is cheaper and more debuggable.
3. **Autonomous mode by default** — Ask + Act-with-confirmation are enough for v1. Autonomous mode opens a much bigger surface for safety drift.
4. **Voice as a primary modality** — nice to add (C.6.3) but not load-bearing for v1.
5. **Agent Store / third-party plugin catalog** (Microsoft-style) — category-defining but requires MCP + plugin review + admin UI. Two quarters of work before it pays off.
6. **Full global memory** across the user's history (ChatGPT-style) — privilege / confidentiality risk. Scope to org + matter instead.
7. **"Replace the dashboard" experiment** — rejected by research; reviews of AI-first CRM that removed dashboards were uniformly bad.

---

## 14. Open questions for you

Before I start building, confirm:

1. **Pattern B + E approved?** Hero agent above the dashboard + global side agent sharing memory. (Vs "just a side panel" or "just a hero" or "replace dashboard"?)
2. **Matter model** — do you want me to introduce `Matter` as a new entity (groups contracts + threads + approvals), or keep thread-scope as `Contract` for v1 and add Matter later?
3. **Wave ordering** — start with **C1 (side agent upgrade)** or **C2 (hero on dashboard)** first?
 - My recommendation: **C1 first**. The side agent is invisible today (ChatPanel is a chat drawer); upgrading it unlocks JTBD-4 ("help me on this page") immediately. Hero can follow a week later once the shared thread + tool-call plumbing is built.
4. **Model default for the app agent** — Sonnet 4.6 default, Opus 4.7 for deep-thinking toggle. OK, or prefer Opus everywhere?
5. **Autonomy default** — Ask (read-only) vs Act-with-confirmation. My recommendation: **Act-with-confirmation** — we get more value and the Intent Preview guard is strong. OK?
6. **Tool catalog cut** — start with the 15, or trim to a tighter 10 for v0 (read-only) and add writes in C3?
7. **Frontend library** — `@assistant-ui/react` (more composable, generative-UI first-class) or **Vercel AI SDK 5/6** (simpler, wider ecosystem). I lean `assistant-ui` for the tool-call UI. Your call.

---

## 15. Links worth keeping

### Product references (for design inspiration)
- [Attio — the live "hero above dashboard" reference](https://attio.com/help/reference/attio-ai/ask-attio/chat-with-ask-attio)
- [Harvey Assistant — agent-first for legal](https://www.harvey.ai/platform/assistant)
- [Harvey Shared Spaces](https://www.harvey.ai/blog/shared-spaces-and-collaboration-in-harvey) — per-matter thread precedent
- [Ironclad Jurist](https://support.ironcladapp.com/hc/en-us/articles/27720356105239-Use-Jurist) — dashboard + contextual agent
- [Salesforce Agentforce](https://www.salesforce.com/agentforce/einstein-copilot/) — agent-as-utility-panel in a dashboard-first app
- [Notion 3.0 — inline + sidebar + home agents with shared memory](https://www.notion.com/releases/2025-09-18)
- [Claude Projects](https://www.anthropic.com/news/projects) — per-project persistent memory

### Engineering
- [Anthropic — Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Anthropic — Building Effective AI Agents](https://www.anthropic.com/research/building-effective-agents)
- [Anthropic — Tool-use overview](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)
- [Anthropic — Extended thinking with tools](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Anthropic — Programmatic tool calling (Tool Runner)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)

### UX patterns
- [Smashing Magazine — Designing for Agentic AI, Feb 2026](https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/)
- [AI UX Design Guide — Intent Preview pattern](https://www.aiuxdesign.guide/patterns/intent-preview)
- [UX Collective — Where should AI sit in your UI?](https://uxdesign.cc/where-should-ai-sit-in-your-ui-1710a258390e)

### Frontend
- [assistant-ui — React primitives for AI chat](https://www.assistant-ui.com/)
- [assistant-ui — Generative UI for tool calls](https://www.assistant-ui.com/docs/guides/ToolUI)
- [Vercel AI SDK 5](https://vercel.com/blog/ai-sdk-5)

### Failure modes
- [NimbleBrain — AI agent failure modes](https://nimblebrain.ai/why-ai-fails/agent-governance/agent-failure-modes/)
- [Arize — Why AI agents break](https://arize.com/blog/common-ai-agent-failures/)

---

*End of plan. Waiting on direction — answer the 7 open questions in §14 and I'll build Wave C1.*
