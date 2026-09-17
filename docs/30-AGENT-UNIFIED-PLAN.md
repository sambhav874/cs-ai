# 30 — Agent-first CLM: unified plan

> **What this is**: ONE integrated plan that ties together:
> - the app-wide agent (hero + side panel + palettes) from `docs/29`
> - the contract-AI pipeline (extraction, clauses, RAG, playbook, drafting) from `docs/28`
> - a **Skills** paradigm — reusable workflows users and admins create
> - the **DB structure** the agent queries
> - the **multi-provider strategy** (LangChain) with **OpenAI-only** for now
>
> Follows the same method we've been using: **JTBD → user journey → best-in-class reference → why → execute → verify.**
>
> Supersedes `docs/29` directional framing; `docs/28` remains the detailed contract-AI pipeline spec and is referenced throughout. Nothing in the current codebase is degraded — all 7 existing LangGraph agents, all B.5/B.6 UI, and the ⌘K/⌘/ palettes stay. Written 2026-04-24.

---

## 0. The big picture in one screen

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      THE AGENT (one agent, two surfaces)                 │
│                                                                          │
│   HERO on /dashboard       +       SIDE PANEL on every page             │
│   (open-ended start)              (contextual, knows current entity)    │
│   — starter chips from queue      — Intent Preview for actions          │
│   — shares memory with side       — skills as @-mentions / chips        │
│                                                                          │
│                        Both share: threads, memory, tool catalog         │
└──────────────────────────────────────────────────────────────────────────┘
                │                              │
                ▼                              ▼
         ┌──────────────────────────────────────────┐
         │   SKILLS  (reusable workflows)           │
         │   Built-in · org-created · user-created  │
         │   @review-nda · @prep-for-approval · …   │
         │   system prompt + allowed tools + context│
         └──────────────────────────────────────────┘
                         │
                         ▼
         ┌──────────────────────────────────────────┐
         │   TOOLS (15 workflow-shaped tools)       │
         │   contract_search · contract_summarize   │
         │   playbook_check · redline_propose/apply │
         │   approval_route · request_create · …    │
         │   Each RBAC-enforced at call-site.       │
         └──────────────────────────────────────────┘
                         │
                         ▼
         ┌──────────────────────────────────────────┐
         │   CONTRACT AI BACKEND (docs/28)          │
         │   • Extraction → metadata + clauses      │
         │   • pgvector (clause embeddings)         │
         │   • Elasticsearch (BM25 + structured)    │
         │   • Playbook as structured rules         │
         │   • Multi-version redline                │
         │   • Draft flows (template/scratch/redline)│
         └──────────────────────────────────────────┘
                         │
                         ▼
         ┌──────────────────────────────────────────┐
         │   POSTGRES (source of truth)             │
         │   contracts · clauses · requests ·       │
         │   approvals · templates · playbook ·     │
         │   custom_fields · threads · tool_calls · │
         │   skills · audit_events · …              │
         └──────────────────────────────────────────┘

         ┌──────────────────────────────────────────┐
         │   MODEL ROUTER (LangChain)               │
         │   Today: only OpenAI key set              │
         │   Tomorrow: route per task across         │
         │     OpenAI / Anthropic / Google / local  │
         │   Every call tagged for Langfuse trace   │
         └──────────────────────────────────────────┘
```

---

## 0.5 — Where we are (as of 2026-04-24)

**Today:** ~30% feature-coverage of a best-in-class CLM. Shipped the
agent shell (D1/D2), Intent Preview writes (D3), Skills v1 (D4), and a
partial D5 (playbook_check + contract_update + approval_route). Full
commit trail in [Appendix D](#appendix-d--d3--d4--d5-build-trail-2026-04-24).

The **~60% gap to best-in-class** is almost entirely:
1. **Negotiation** — redline propose/apply/preview (D.5.2/3/4)
2. **Enterprise input** — OCR + structural PDF + binder split (Wave F)
3. **Trust** — citations + RAG upgrade (D.5.7/8)
4. **Structure** — matters + entity mentions (D7)
5. **Post-signature** — obligations + reminders + renewal (Wave H)

### Path to 90%+ — six phases, ~26 days to 92%, ~31 days to 95%+

Sequenced for **shortest path to credible competition**, not for
engineering preference. Each phase's gain is gated by the **customer
segment it unlocks**, not by line count.

| Phase | Unblocks | Days | Cumulative |
|---|---|---|---|
| **P1 — Negotiation** (D.5.2/3/4 + structured playbook + template tool) | Every in-house Legal team · no CLM pitch without redline | 7 | ~55% |
| **P2 — Enterprise input** (Wave F.1–F.5) | Enterprise customers with scanned archives (~40% of mid-market) | 6 | ~75% |
| **P3 — Trust + scale** (D.5.7/8/9/10 + RAG upgrade + citations) | Legal trust threshold · binary "I can verify" | 4 | ~82% |
| **P4 — Enterprise gating** (Matter model + entity mentions + read-tool wrappers) | Procurement RFPs · "do you have matters?" | 5 | ~88% |
| **P5 — Post-signature** (Wave H obligations + reminders + renewal) ✅ **SHIPPED 2026-04-25** | Renewal-revenue pitch · Sirion's moat · Gartner MQ | 4 | ~92% ← **90% bar crossed** |
| **P6 — Premium tier** (Wave G editor magic) ✅ **SHIPPED 2026-04-25** | Ironclad/Harvey parity on in-editor AI | 5 | **~95%+** |

### Phase 1 — Unblock negotiation (7 days, highest leverage)

| # | Item | docs ref | d | Customer blocked if missing |
|---|---|---|---|---|
| 1 | Wire `contract_create_from_template` tool | new D.5.x | 0.5 | every drafting flow; `@draft-from-template` is theater without it |
| 2 | Structured playbook schema (`must_have`/`must_not`/`bounds`/`variables`) | docs/28 C.2.1 | 1.5 | in-house Legal — today's keyword matching is shallow |
| 3 | Two-stage compare (embedding narrow → LLM judge) | docs/28 C.2.2 | 1 | long-contract quality bar |
| 4 | `redline_propose` (least/moderate/aggressive) | D.5.2 | 1.5 | **Ironclad's wedge** — THE differentiator |
| 5 | `redline_apply` (OOXML tracked-changes emit) | D.5.3 + C.4.4 | 2 | Legal — they live in Word |
| 6 | `<RedlinePreview />` UI | D.5.4 | 1 | inline Accept/Reject per change |

### Phase 2 — Unblock enterprise input (6 days)

| # | Item | docs ref | d | Customer blocked if missing |
|---|---|---|---|---|
| 7 | OCR pass (Tesseract/Textract) | Wave F.1 | 1.5 | any customer with pre-2018 contracts (~40% of mid-market) |
| 8 | Structural HTML extractor (PDF → semantic tree) | Wave F.2 | 2 | citations + anchoring |
| 9 | Multi-doc binder split | Wave F.3 | 1 | enterprise (60-page binder = MSA+SOW+DPA) |
| 10 | Clause bbox preservation | Wave F.4 | 1 | foundation for citations |
| 11 | HITL queue for low-confidence fields | Wave F.5 | 0.5 | trust signal for Legal |

### Phase 3 — Trust + scale (4 days)

| # | Item | docs ref | d | Customer blocked if missing |
|---|---|---|---|---|
| 12 | Native Claude Citations API + bbox highlight | D.5.8 + C.3.5/3.6 | 1 | Legal won't trust un-cited AI; binary threshold |
| 13 | RAG upgrade: RRF fusion + adaptive router | D.5.7 + C.3.3/3.4 | 1.5 | portfolio-scale questions; ~20% recall lift |
| 14 | Counterparty memory + severity grouping | D.5.9 + C.2.4/2.5 | 1 | "you've done 5 prior NDAs with Acme" — context for free |
| 15 | Draft-path validators (lexicon + cross-ref resolver) | D.5.10 + C.4.2/4.3 | 0.5 | cheap quality win on drafts |

### Phase 4 — Enterprise gating (5 days)

| # | Item | docs ref | d | Customer blocked if missing |
|---|---|---|---|---|
| 16 | `Matter` entity migration | D.7.1 | 1 | Procurement RFPs ask "do you have matters?" |
| 17 | Matter view + per-matter threads | D.7.2/7.3 | 1.5 | sidebar grouping UI |
| 18 | `@contract`/`@counterparty`/`@approval` entity mentions | D.7.4 | 1 | Notion-style context pull |
| 19 | Org memory layer (playbook/templates/past deals as tools) | D.7.5 | 1 | "what's our typical liability cap?" from real data |
| 20 | Remaining read-tool wrappers (approval_list, counterparty_get, request_list, custom_field_list) | docs/30 §5 backlog | 0.5 | every agent surface richer for cheap |

### Phase 5 — Post-signature (4 days) ✅ SHIPPED

| # | Item | docs ref | d | Customer blocked if missing | Status |
|---|---|---|---|---|---|
| 21 | Obligation extractor (payment/SLA/renewal/audit_rights/report_delivery) | Wave H.1 + C.6.1 | 1.5 | foundation for all post-signature value | ✅ P5.1 — `/extract_obligations` LLM + `obligations_list` tool + `ObligationsRailSection` |
| 22 | Reminder + escalation agent (daily cron) | Wave H.2 + C.6.2 | 1.5 | reconstructable "we told you X, escalated Y to Z" | ✅ P5.2 — `scanObligations()` + `POST /cron/obligations` + `OBLIGATION_DUE` notifications in bell |
| 23 | Renewal advisor (auto-flag 90 days out) | Wave H.3 | 1 | stops auto-renewals customers wanted to renegotiate | ✅ P5.3 — `scanRenewals()` + `/renewal_advice` LLM + `renewal_advice` tool + `RenewalAdviceRailSection` + decision logging |

### Phase 6 — Premium tier (5 days, optional) ✅ SHIPPED

| # | Item | docs ref | d | Customer blocked if missing | Status |
|---|---|---|---|---|---|
| 24 | Ghost-text completion in TipTap (Copilot-style) | Wave G.1 | 1.5 | "editor feels alive" | ✅ P6.1 — `/complete` fast-tier LLM + `GhostCompletion` extension + Tab-accept/Esc-dismiss |
| 25 | Background classifier (margin badges) | Wave G.2 | 1 | catch deviations before send-for-review | ✅ P6.2 — `/classify_clause` LLM + `ClauseClassifier` extension + MARKET/AGGR/WEAK/OFF badges |
| 26 | Bubble-menu AI streaming | Wave G.3 | 0.5 | token-stream on existing palette | ✅ P6.3 — `/assist_stream` NDJSON + `BubbleAiPopover` with Replace / Insert below / Copy |
| 27 | Defined-term guard | Wave G.4 | 1 | lexicon watcher with "apply everywhere" | ✅ P6.4 — `DefinedTermGuard` pure-client extension + `DefinedTermsRailSection` + `normalizeDefinedTerms()` |
| 28 | Inline deviation drawer (B.5.6 reuse) | Wave G.5 | 1 | click badge → focused-review drawer | ✅ P6.5 — Clickable classifier badges + `ClauseDeviationPopover` handing off to the streaming rewrite popover |

**Ordering rationale:**
- **P1 first, always.** Without redline, we can't pitch this as a CLM.
  Every other gain is rounding error compared to closing this.
- **P2 second.** Opens the enterprise pipeline (where revenue lives).
- **P3 + P4** are roughly tied — pick based on first 5 customer
  conversations. If they all ask "how do you cite?", do P3. If they all
  ask "do you support matters?", do P4.
- **P5** unlocks the renewal-revenue pitch (the #1 expansion lever).
- **P6** only after P1–P5. Editor magic is meaningless if redline
  doesn't exist.

---

## 1. Seven user journeys (the design test)

Nothing in the plan survives if it doesn't serve at least one of these end-to-end. We'll run every design decision through this list.

### JTBD-1 — "Start my day"
A Legal Ops lead logs in at 9am. They want to know what needs them *today*, quickly.
- **Hero shows Your Day band** (already built — B.6.15) with counts
- **Starter chips in hero agent** pulled from those counts: `Review 1 approval`, `Send 2 expiring renewals`, `Triage 2 drafts`
- Click chip → agent routes the user to the right page + **side panel pre-loads context** for the first item
- Whole-team scan takes < 60 seconds

### JTBD-2 — "Is this contract OK?" (review a single contract)
Someone uploaded WPT Enterprises — Zynga License Agreement. Legal Ops needs to review.
- Open `/contracts/:id` → side panel auto-context `📄 WPT Enterprises - Zynga Agreement`
- **Quick-action chips are skills**: `[Review vs playbook]`, `[Summarise risks]`, `[Find similar precedents]`, `[Prep for approval]`
- Click `Review vs playbook` → skill invokes `playbook_check` (docs/28 Wave 2) → returns deviations with severity + 3-variant redline proposals → reviewer picks variant → **Intent Preview card → Apply** to open draft in editor

### JTBD-3 — "Draft a new contract"
Sales ops: "Draft an NDA for Acme Corp, mutual, 2-year, California law."
- Type in hero agent, press Enter
- Agent shows **plan surface**: "1) find NDA template, 2) bind variables, 3) open draft"
- User confirms → tool call `contract_create_from_template` → draft opens inline as an artifact → click to land on `/contracts/:id` with side panel open on the new draft

### JTBD-4 — "Ask across my portfolio"
CFO: "Which of our MSAs have uncapped liability and expire in Q2?"
- Hero → type the question
- Agent picks `contract_search` with filters `{type: MSA, clause_flag: uncapped_liability, expiryDate: Q2-range}`
- Returns tabular artifact (spreadsheet-of-contracts pattern — the Hebbia/Vault move) with clickable rows

### JTBD-5 — "Do this at scale"
Compliance officer: "Send every MSA over $100k in US jurisdiction to Legal-Tier-2 for review."
- Hero → plan surface: 5-step plan, 8 matching contracts, shown as artifact
- Reviewer removes one → confirms
- Agent batches `approval_route` 7× with staged summary: "Routed 7 of 7 successfully. Here are the receipts."
- 15 seconds instead of 10 minutes of clicking

### JTBD-6 — "Build my own workflow" (skill-creation)
Legal Ops lead: "Every time a vendor sends us their paper we do the same 4 things — classify, check playbook, summarise risk, file in the right matter. I want one button for that."
- Settings → Skills → **Create skill**
- Name "Incoming vendor paper", trigger `@vendor-paper`, scope: current contract
- Pick allowed tools: `contract_get`, `playbook_check`, `contract_summarize`, `comment_add`
- Write system prompt (or describe in natural language → agent drafts it), pick follow-up actions
- Save → chip appears on contract detail pages → team reuses

### JTBD-7 — "What happened? Audit" (admin)
Compliance auditor: "Show me every action the AI took on Zynga MSA in March."
- Admin page → audit log scoped to contract + AI tool calls
- Each row: who invoked, which skill, which tool, what params, what result, what action was taken, undo available?
- Export → CSV / PDF for GDPR / EU AI Act Article 12

Every wave in the rollout is validated against these seven.

---

## 2. Architecture at a glance

Four layers. Each layer is independently testable. Changes at one layer don't break others.

### Layer A — Agent shell (UI + orchestration)

- **Hero agent** on `/dashboard` (above the existing Your Day band / KPIs / Quick Actions)
- **Side agent panel** on every page, right-docked, collapsible to a 48px rail
- **⌘K contract-scoped palette** (`AiCommandPalette` — B.5.9, unchanged)
- **⌘/ global search palette** (`GlobalSearch` — B.6.25, unchanged)
- Both agents share: threads, memory, tool catalog, model router

### Layer B — Skills (reusable workflow layer)

- **Built-in** skills shipped with the product (see §4)
- **Org skills** created by admins (visible to whole org)
- **User skills** created by power users (private by default, shareable)
- Skill = `{name, trigger, context_scope, system_prompt, allowed_tools, follow_ups}`
- Agent resolves `@skill_name` or quick-action chip → loads skill → narrows tool set + injects prompt

### Layer C — Tools (the agent's hands)

- 15 workflow-shaped tools in v1 (see §5)
- Each tool maps to existing REST endpoints + future docs/28 pipeline calls
- RBAC enforced at the tool-execution boundary (not in the prompt)
- Destructive tools pass through **Intent Preview** card before executing

### Layer D — Contract AI + data backend (docs/28)

- **Extraction pipeline** — produces `contract.keyTerms`, `contract.clauseFlags`, `contract.riskScore`, clause-level embeddings, audit trail
- **pgvector** — per-clause dense embeddings, used by `clause_search`
- **Elasticsearch** — BM25 + structured filters on contracts, used by `contract_search`
- **Playbook** — structured rules (docs/28 Wave 2), used by `playbook_check`
- **Redline pipeline** — multi-version proposals, used by `redline_propose/apply`
- **Drafting pipeline** — 3 flows (template/scratch/redline-incoming), used by `contract_create_from_template`
- **Custom field definitions** (`ContractFieldDefinition`) — orgs define their own structured fields; agent queries them generically

### Foundation (cross-cutting)

- **LangChain / LangGraph** — provider-agnostic LLM calls. Today OpenAI-only (we have the key); tomorrow flip to Anthropic/Google per-task by adding keys.
- **Langfuse** — trace every agent turn, every tool call, every model invocation
- **Audit log** (hash-chained, append-only) — enterprise compliance
- **Eval harness** — regression tests per prompt / model / tool change

---

## 3. The agent shell (Layer A) — concrete spec

### 3.1 Hero agent

Lives at the top of `/dashboard`. Inspired by **Attio's Home** — the only live reference in SaaS-adjacent categories that puts an agent composer above an operational dashboard. No CLM does this today; it's the product's defining identity move.

**Anatomy (top-to-bottom on dashboard)**:

```
─ Greeting ("Welcome back, Admin")
─ HERO AGENT COMPOSER (NEW)                             ← Wave D2
  ┌──────────────────────────────────────────────────┐
  │  ✨ Ask me anything about your contracts         │
  │                                                  │
  │  [Review 1 approval]  [Send 2 expiring renewals] │  ← Starter chips from Your Day
  │  [Triage 2 drafts]    [Draft a new NDA]          │     — dynamic, not static
  │                                                  │
  │  ⚡ @review-nda  @prep-for-approval  ...         │  ← Quick-invocable skills
  └──────────────────────────────────────────────────┘
─ Your Day band (B.6.15 — unchanged)
─ KPI cards (unchanged)
─ Quick Actions (unchanged)
─ Recent Activity (B.6.4 — unchanged)
```

**Behaviour**:
- Starter chips are *dynamic*. If `approvals=0` and `expiring=0`, the chips pivot to "Draft new", "Ask about portfolio", etc.
- Typing + pressing Enter → response streams inline, collapsing the chips
- If the agent needs to call multiple tools, show a collapsible **plan surface** before the first tool fires
- "Open in side panel" button on long conversations → moves the thread to the side panel so the user can continue working

### 3.2 Side agent panel

Docked right, 420px default, user-resizable (360-640), collapsible to a 48px rail, full-screen drawer below 1024px. Replaces the current `ChatPanel` (today a chat drawer with a model picker and nothing else). **Existing functionality preserved** — the current chat still works as a fallback while we upgrade.

**Anatomy (12 parts, from side-panel research)**:

1. **Header** — avatar, New thread button, thread picker, model hint badge, close
2. **Context chip row** — `📄 current page`, removable. Add more via `@mention`
3. **Conversation area** — messages + tool-call traces + artifacts + citations
4. **Tool-call trace block** — collapsed by default for reads, expanded for writes
5. **Thinking block** (when the model supports it) — muted, collapsible
6. **Intent Preview card** — for every mutating action. Diff + Apply/Edit/Cancel
7. **Citation chip** — clickable → scrolls PDF to page + highlights span
8. **Composer** — multi-line, `/` for slash commands, `@` for skills + entities, attachment
9. **Context-window meter** — small indicator at the bottom
10. **Quick-action rail** — **these are skills** relevant to the current page
11. **Autonomy toggle** — Ask (read-only) / Act (write with confirmation). Default: Act.
12. **Keyboard hints** — Esc / Enter / ⌘/

**Memory**: shared with hero. Same thread list, same tools, same model config. Opening the side panel from `/contracts/:id` pre-loads the most recent thread scoped to this contract's Matter (see §7).

### 3.3 ⌘K and ⌘/ palettes — kept as-is

- `⌘K` on `/contracts/:id` (B.5.9) → fast grounded Q&A on the open contract, no tool use, minimal UI
- `⌘/` on every page (B.6.25) → pure navigation / find entity

These are not redundant with the agent — they're faster for their specific jobs (a keystroke, no thread, no history). The hero and side panel are for *doing work*; the palettes are for *finding a thing* (⌘/) or *asking one question* (⌘K).

---

## 4. Skills (Layer B) — the workflow layer

### 4.1 Why skills

**The insight**: every user's workflow is a little different. A pure chat agent makes users re-type the same setup prompts every time. Market leaders have converged on a "skills" paradigm:

- **Anthropic Claude Skills** (2025) — user-defined skills with prompts + tools + examples
- **OpenAI Custom GPTs** (GPTs Store) — system prompt + knowledge + actions + published
- **Notion 3.0 Agents** (Sep 2025) — multi-step agents users build
- **Dia Skills** — per-site reusable prompts with tab/page context
- **Cursor Rules** — repo-level instructions that customise agent behaviour per codebase

**For CLM specifically** skills are the highest-leverage feature we can ship above a basic agent — because legal ops and in-house counsel have workflows they repeat daily ("Incoming vendor paper review", "Pre-approval checklist", "Renewal prep", "Quarterly compliance sweep"). Ironclad / Harvey both ship "Workflows" as a first-class concept; ours just needs to be configurable by the user, not just engineering.

### 4.2 Skill schema

```typescript
interface Skill {
  id: string
  name: string                    // "Review NDA", "Prep for approval"
  slug: string                    // "@review-nda", "@prep-for-approval"
  ownerType: 'built_in' | 'org' | 'user'
  ownerId: string | null          // orgId for 'org', userId for 'user', null for built_in
  description: string             // one-liner shown in chip + picker

  // What the skill operates on
  contextScope: 'dashboard' | 'current_contract' | 'current_request'
              | 'selection' | 'portfolio' | 'any'

  // The prompt the agent runs under
  systemPrompt: string            // injected above the user message
  // Or: a higher-level JSON for built-ins with `promptTemplate`

  // The agent's hands are narrowed
  allowedTools: string[]          // e.g. ['contract_get', 'playbook_check']

  // Model hint (provider-agnostic)
  modelTier: 'reasoning' | 'fast' | 'default'

  // UX
  triggerTypes: ('mention' | 'chip' | 'button')[]
  followUps?: string[]            // suggested next-steps after skill completes

  // Governance
  requiresRole?: string[]         // skill hidden/denied if user lacks role
  createdAt: Date
  updatedAt: Date
}
```

### 4.3 Built-in skill catalog (v1)

Ship with these seven. Admins can edit the system prompts; users cannot. Gives immediate out-of-box value.

| Skill | Trigger | Scope | Allowed tools | What it does |
|---|---|---|---|---|
| `@review-contract` | mention + chip on detail | current_contract | `contract_get`, `playbook_check`, `contract_summarize`, `clause_search` | End-to-end review: summary + risks + playbook deviations + suggested redlines |
| `@review-nda` | mention + chip | current_contract (type=NDA) | same as above | NDA-tuned prompt — 5 checks (mutuality, term, carve-outs, IP, jurisdiction) |
| `@prep-for-approval` | chip on detail | current_contract | `contract_get`, `clause_search`, `approval_route` (dry-run) | Build a one-page brief: value, counterparty, top risks, recommended approvers, then `approval_route` Intent Preview |
| `@renewal-check` | mention | current_contract | `contract_get`, `clause_search`, `audit_log_query` | Is this renewal advisable? What changed since last version? |
| `@draft-from-scratch` | hero chip | dashboard | `contract_create_from_template`, `clause_search` | Wizard-style variable collection → draft |
| `@compliance-sweep` | hero chip | portfolio | `contract_search`, `playbook_check`, `audit_log_query` | Scan portfolio for deviations from a chosen playbook |
| `@explain-clause` | mention in editor selection | selection | `clause_search`, `playbook_check` | In-line explainer for a selected clause |

### 4.4 Skill creation UX (admin + user)

**Settings → Skills**:

- **Browse library** — built-in + org + user, filterable by scope
- **Create skill**:
 1. Choose scope (current contract / portfolio / dashboard / …)
 2. Name + slug + description
 3. Write a natural-language description of what the skill should do → **agent drafts the system prompt** (self-bootstrap; "skill that builds skills")
 4. Pick allowed tools (recommended defaults based on scope)
 5. Optional: attach example conversations as few-shot
 6. Optional: define follow-up suggestions
 7. Publish: `private` (user-only) / `org` (everyone) / `review` (admin approval required)

**Audit**: every skill edit is logged; the effective skill version at any point in time can be recovered. Skills are immutable at invocation time (we snapshot the version so an edit mid-run doesn't change behaviour).

### 4.5 How skills interact with the agent

Skills are *not* a separate agent. They are **thin wrappers**: the same LangChain model + tool catalog, but with a narrowed tool-list and an injected system prompt. Anatomically:

```python
def invoke_skill(skill: Skill, user_message: str, context: AgentContext):
    # Narrow tool catalog
    tools = [t for t in TOOL_CATALOG if t.name in skill.allowedTools]
    # Inject skill's system prompt above user turn
    system = resolve_system_prompt(skill, context)
    # Pick model tier
    model = model_router.get(skill.modelTier)
    # Proceed as normal agent loop
    return agent_loop(model, tools, system, user_message, context)
```

This means:
- Zero new orchestration complexity
- Zero new failure modes
- Users get a "skill" experience but it's the same agent underneath

---

## 5. Tool catalog (Layer C) — concrete

Every tool already has a backing REST endpoint with `requirePermission()` enforced — the agent inherits RBAC automatically. New tools that need new endpoints are called out.

Per Anthropic engineering guidance: **workflow-shaped over CRUD**, **12-20 active per turn**, use `defer_loading` for the long tail. All tools defined with `strict: true` + `input_examples` for the complex ones.

### 5.1 Read (parallel-safe, dry_run not needed)

| Tool | Backing | Notes |
|---|---|---|
| `contract_search(query, filters, top_k, response_format)` | existing `POST /search/advanced` + `GET /contracts` | Rich filter shape: status, type, counterparty_id, value_range, expiry_range, jurisdiction, owner_id, clause_flag, custom_field |
| `contract_get(contract_id, include[])` | existing `GET /contracts/:id` | `include`: metadata, clauses, parties, obligations, approvals, history, risks. Composable so agent fetches only what it needs |
| `contract_summarize(contract_id, focus, length)` | existing `/contracts/:id/ask` with canned prompt, calls docs/28 Wave 1 | Focus: risk, obligations, key_terms, deviations_from_playbook |
| `clause_search(query, scope, top_k)` | existing pgvector `searchClauses` + Elasticsearch | Scope: this_contract, playbook, org_library, portfolio |
| `playbook_check(contract_id, playbook_id?)` | **NEW** — calls docs/28 Wave 2 playbook_agent | Returns deviations with severity + quoted span |
| `approval_list(filters)` | existing `GET /approvals/my-queue` | filters: status, assignee_id, overdue_only, matter_id |
| `counterparty_get(identifier, include)` | existing `GET /counterparties/:id` | Also accepts name for fuzzy match |
| `request_list(filters)` | existing `GET /requests` | By status, assignee, priority, type |
| `audit_log_query(entity_id, action, date_range)` | **NEW** endpoint required | Enterprise must-have for compliance JTBDs |
| `custom_field_list(contract_type?)` | existing `GET /field-definitions` | So agent discovers what orgs define |

### 5.2 Write (each passes through Intent Preview card)

| Tool | Backing | Notes |
|---|---|---|
| `contract_create_from_template(template_id, counterparty, variables, matter_id)` | existing `POST /templates/:id/generate` | Workflow-shaped; the 80% draft flow |
| `contract_update(contract_id, action, payload)` | existing `PATCH /contracts/:id`, `POST /:id/analyze`, `POST /:id/retype` | Action enum: set_status, assign_owner, add_tag, retype, re_analyze |
| `redline_propose(contract_id, playbook_id|instructions)` | **NEW** — calls docs/28 redline pipeline | Returns redline set as *preview artifact*; never applies |
| `redline_apply(contract_id, redline_set_id, mode, selected_ids?)` | **NEW** — wraps OOXML-tracked-changes emit | Propose/apply pair so Intent Preview can slot in |
| `approval_route(contract_id, workflow_id|approvers, note)` | existing workflow + `POST /approvals` | Uses existing workflow engine |
| `request_create(title, type, counterparty, description, priority, matter_id?)` | existing `POST /requests` | Agent files intake on user's behalf |
| `comment_add(entity_id, body, mentions)` | existing `POST /comments` | Low-risk first-agent-action |

### 5.3 Deferred (loaded only when tool search picks them)

- `signature_send` — type-to-confirm speed bump, highest risk
- `contract_archive`, `version_promote`, `task_create`
- Integration tools: `slack_notify`, `salesforce_opportunity_get` (future)
- Admin tools: `user_invite`, `role_assign`, `playbook_edit`

### 5.4 Tool design invariants

Every tool definition in code includes:

- **`name`** — namespaced (`contract_search`, `approval_route`)
- **JSON schema** — required fields, types, enums, descriptions
- **`strict: true`** (OpenAI function-calling; LangChain passes through)
- **`input_examples`** — 3-5 realistic calls for complex tools (OpenAI uses these in the system prompt; LangChain can surface them too)
- **`response_format`** — `concise` | `detailed` where relevant
- **`dry_run` flag** on mutating tools — returns "what would happen" without executing
- **Audit hook** — every call (dry-run or real) logged with resolved user, tenant, scope, params, result

---

## 6. Contract AI backend (Layer D) — reference to docs/28

Everything in `docs/28-AI-PLAN.md` remains the blueprint for the AI **operating on contracts**. This plan reuses it as the tool backend. The interface between this plan and `docs/28`:

| Agent tool (this plan) | Calls (docs/28 component) |
|---|---|
| `contract_summarize` | docs/28 Wave 1 — `review_agent` 3-step output |
| `clause_search` | docs/28 Wave 3 — hybrid retrieval + rerank |
| `playbook_check` | docs/28 Wave 2 — structured playbook compare |
| `redline_propose` | docs/28 Wave 2 — multi-version redline |
| `redline_apply` | docs/28 Wave 4 — surgical OOXML-tracked changes |
| `contract_create_from_template` | docs/28 Wave 4 — split drafting flows |
| `contract_update(action=re_analyze)` | existing `POST /contracts/:id/analyze` + docs/28 Wave 1 OCR tier |

### Priority adjustments to docs/28 given the agent is coming

Docs/28 Waves 0, 2, 3 become higher-priority because the agent's best tools depend on them:

- **Wave 0** (eval harness + task-based model routing + Langfuse) — **absolutely first**. Cannot ship agent without.
- **Wave 2** (structured playbook + multi-version redline) — the #1 agent demo moment (JTBD-2)
- **Wave 3** (embeddings upgrade + rerank) — quality of *every* read tool depends on this. The OpenAI-only constraint today doesn't block this: stay on `text-embedding-3-large` for now; rerank step is LLM-rerank with `gpt-4.1-mini` until we have Cohere/Voyage keys.

### What we're NOT degrading

- All 7 existing LangGraph agents (`review_agent`, `redline_agent`, `assist_agent`, `draft_agent`, `approval_agent`, `portfolio_agent`, `ask_agent`) stay. They become the backend pipelines that the app agent's tools invoke.
- All existing REST endpoints stay. The agent's tools are thin wrappers, not replacements.
- The existing `ChatPanel` stays functional as a fallback while we build the new side agent (we can feature-flag the switch).

---

## 7. DB structure — what changes

### 7.1 Existing schema (23 models) — unchanged

All tables in `apps/api/prisma/schema.prisma` stay. Nothing removed. Zero breaking migrations.

### 7.2 New tables for agent state

```prisma
// ─── Agent state ─────────────────────────────────────────────────────────────

model AgentThread {
  id              String    @id @default(cuid())
  orgId           String
  userId          String    // owner — but others in the matter can view if shared
  title           String    // auto-generated from first user message, editable
  // Optional anchor — a thread can be bound to an entity so next-time you open
  // /contracts/:id the side agent lands on the relevant prior thread.
  scopeType       String?   // 'matter' | 'contract' | 'request' | null (free)
  scopeId         String?
  // Which skill, if any, originated this thread (null = free chat)
  originSkillId   String?
  // Which LLM path (today always openai; later anthropic, etc.)
  providerHint    String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  archivedAt      DateTime?

  org             Organization     @relation(fields: [orgId], references: [id])
  user            User             @relation(fields: [userId], references: [id])
  skill           Skill?           @relation(fields: [originSkillId], references: [id])
  messages        AgentMessage[]
  toolCalls       ToolCall[]

  @@index([orgId, userId, updatedAt])
  @@index([orgId, scopeType, scopeId])
  @@map("agent_threads")
}

model AgentMessage {
  id              String    @id @default(cuid())
  threadId        String
  role            String    // 'user' | 'assistant' | 'system' | 'tool'
  // Rich content: text blocks, tool_use blocks, tool_result blocks, thinking blocks
  content         Json      // Array of content blocks (LangChain / Anthropic shape)
  // Model used for this assistant turn (null for user/system/tool)
  provider        String?   // 'openai' | 'anthropic' | 'google' | 'local'
  model           String?   // 'gpt-5' | 'claude-opus-4-7' | ...
  // Token accounting for cost attribution
  inputTokens     Int?
  outputTokens   Int?
  costUsd         Decimal?  @db.Decimal(10, 6)
  // Links into Langfuse trace
  traceId         String?
  createdAt       DateTime  @default(now())

  thread          AgentThread @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@index([threadId, createdAt])
  @@map("agent_messages")
}

model ToolCall {
  id              String    @id @default(cuid())
  threadId        String
  messageId       String    // links to AgentMessage containing the tool_use
  toolName        String    // 'contract_search', 'playbook_check', ...
  input           Json      // The tool input from the model
  dryRun          Boolean   @default(false)
  status          String    // 'pending' | 'awaiting_confirmation' | 'running' | 'success' | 'error' | 'cancelled'
  // What actually happened
  output          Json?     // The tool result
  error           String?
  // Which entity was touched (for audit + undo)
  entityType      String?   // 'contract' | 'approval' | ...
  entityId        String?
  // Undo plumbing
  reversible      Boolean   @default(false)
  rollbackHook    Json?     // Serialized rollback instructions (op, before, after)
  rolledBackAt    DateTime?
  rolledBackById  String?
  latencyMs       Int?
  createdAt       DateTime  @default(now())

  thread          AgentThread  @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@index([threadId, createdAt])
  @@index([entityType, entityId])
  @@map("tool_calls")
}

// ─── Skills ──────────────────────────────────────────────────────────────────

model Skill {
  id              String    @id @default(cuid())
  orgId           String?   // null for built-in
  ownerUserId     String?   // null for built-in / org
  name            String
  slug            String    // '@review-nda', '@prep-for-approval'
  description     String
  ownerType       String    // 'built_in' | 'org' | 'user'
  contextScope    String    // 'dashboard' | 'current_contract' | 'current_request' | 'selection' | 'portfolio' | 'any'
  systemPrompt    String
  allowedTools    String[]
  modelTier       String    // 'reasoning' | 'fast' | 'default'
  triggerTypes    String[]  // subset of ['mention', 'chip', 'button']
  followUps       String[]  @default([])
  requiresRole    String[]  @default([])
  // Versioning — edits bump version; thread snapshots version at invoke time
  version         Int       @default(1)
  isPublished     Boolean   @default(true)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  deletedAt       DateTime?

  org             Organization?    @relation(fields: [orgId], references: [id])
  owner           User?            @relation(fields: [ownerUserId], references: [id])
  threads         AgentThread[]
  invocations     SkillInvocation[]

  @@index([orgId, ownerType, isPublished])
  @@unique([orgId, slug])
  @@map("skills")
}

model SkillInvocation {
  id              String    @id @default(cuid())
  skillId         String
  skillVersion    Int       // snapshot of Skill.version at invocation time
  threadId        String
  userId          String
  orgId           String
  contextType     String?
  contextId       String?
  inputMessage    String
  createdAt       DateTime  @default(now())

  skill           Skill        @relation(fields: [skillId], references: [id])

  @@index([orgId, userId, createdAt])
  @@index([skillId, createdAt])
  @@map("skill_invocations")
}
```

### 7.3 How agent tools query the data

No new query engines. The agent's tools call:
- **Elasticsearch** via existing `/search/advanced` — for BM25 + structured filters
- **pgvector** via existing `searchClauses()` — for semantic clause search
- **Postgres** via existing REST endpoints — for structured data (lists, aggregates)
- **Extraction output** is already stored in `Contract` columns (`keyTerms`, `riskScore`, `clauseFlags`, `metadata`) + `ContractClause` rows — all already indexed for agent queries

The agent becomes a router. It does not bypass the existing API; it speaks the same HTTP + auth.

### 7.4 Custom fields — the "orgs define their own" story

`ContractFieldDefinition` already exists. Values live in `contract.metadata` (JSONB). For the agent:

- `custom_field_list(contract_type?)` returns the org's definitions
- `contract_search(filters.custom_field={key: 'survivalPeriod', op: 'eq', value: '5 years'})` gets translated to a JSONB query + Elasticsearch filter on a dynamic sub-field
- Agent can reason about org-specific concepts without hardcoding

---

## 8. Multi-provider with OpenAI-only today

### 8.1 Strategy

Build the abstraction from day one, but honour the single-key constraint.

- **LangChain's `BaseChatModel`** is the interface. We already use it (see `apps/agents/app/providers.py`).
- **Provider router** (new): per-task-tier config. Today every tier resolves to the OpenAI option because that's the only key set. Tomorrow, any of the below lines flips to a different provider by setting the corresponding env var.
- **Graceful degradation**: at startup, detect which provider keys are set. Log the resolved routing. Never silently fall back to a provider without a key.

```python
# apps/agents/app/router.py (new)
MODEL_TIERS = {
    'reasoning': [
        ('anthropic', 'claude-opus-4-7'),       # preferred when ANTHROPIC_API_KEY set
        ('openai',    'gpt-5'),                 # today's reality
    ],
    'default': [
        ('anthropic', 'claude-sonnet-4-6'),
        ('openai',    'gpt-4.1'),               # today's reality
    ],
    'fast': [
        ('anthropic', 'claude-haiku-4-5'),
        ('openai',    'gpt-4.1-mini'),          # today's reality
    ],
    'embed': [
        ('voyage',    'voyage-law-2'),          # preferred
        ('openai',    'text-embedding-3-large'), # today's reality
    ],
    'rerank': [
        ('voyage',    'voyage-rerank-2.5'),
        ('cohere',    'rerank-english-v3.0'),
        ('llm',       'gpt-4.1-mini'),          # today's fallback: LLM-as-reranker
    ],
    'vision_ocr': [
        ('mistral',   'mistral-ocr-3'),
        ('openai',    'gpt-4.1-vision'),        # today's reality
    ],
}

def build_llm(tier: str) -> BaseChatModel:
    for provider, model in MODEL_TIERS[tier]:
        if has_key(provider):
            return instantiate(provider, model)
    raise RuntimeError(f"No key configured for any provider in tier={tier}")
```

### 8.2 Models on the OpenAI shelf (today)

| Task | Model | Rationale |
|---|---|---|
| Reasoning (agent loop, plan, playbook judge, drafting) | **GPT-5** (or `gpt-4.1` if 5 unavailable) | Best OpenAI tier for structured tool calls + reasoning |
| Default (side-agent answers, Q&A) | **GPT-4.1** | Balanced, supports strict function calling |
| Fast (triage, classify, summary, ghost-text) | **GPT-4.1-mini** | $0.15/$0.60 per 1M; low latency |
| Embeddings | **text-embedding-3-large** | Already in use; adequate for legal until we have Voyage |
| Rerank | **GPT-4.1-mini as LLM-reranker** | Workaround: score query-doc pairs via LLM until Cohere/Voyage key |
| OCR / vision | **GPT-4.1 vision** | Handles scanned PDFs; swap to Mistral OCR 3 when key arrives |

### 8.3 What we lose by OpenAI-only (and how we compensate)

- **No Claude Citations API** — we roll our own: tool returns chunks with `{chunk_id, page, bbox}`; LLM emits `{claim, evidence_ids[]}`; we verify quotes server-side.
- **No Anthropic prompt caching (90% off)** — mitigate by (a) OpenAI's own response cache for identical prompts + (b) pre-computing tool definitions once per process start.
- **No native thinking blocks** — render reasoning from OpenAI's `response.choices[].message.reasoning` (available on `o`-series models) or just display the final answer.
- **Tokenizer differences** — 4.x's tokenizer is more efficient than Anthropic's newer ones; pricing comparisons will flip again when we add Anthropic.

### 8.4 Why LangChain (not Anthropic SDK direct)

In `docs/29` I recommended Anthropic's Messages API + ToolRunner directly. **Revising given your constraint**: use LangChain's multi-provider abstraction instead.

- Keeps code provider-agnostic from day 1
- Existing `providers.py` already wires LangChain for all three vendors
- LangChain's `bind_tools()` + `astream()` work uniformly across OpenAI + Anthropic + Google
- Tradeoff: we give up some Anthropic-specific knobs (native thinking blocks, fine-grained cache control) but they're easy to add later via provider-specific overrides
- For the 7 existing LangGraph agents, we're already on LangGraph — no migration needed

---

## 9. Intent Preview + audit + undo

### 9.1 Intent Preview card (the high-leverage UX pattern)

For every mutating tool call:

1. Agent emits `tool_use` block with `dry_run: true`
2. Tool executes server-side in dry-run → returns "what would happen" structured result
3. UI renders an `<ActionPreview tool={...} />` card in the conversation area:
 - Plain-English summary ("I'll route this contract for Legal-Tier-2 approval")
 - Before/after diff where relevant
 - Affected entities list
 - `Apply` / `Edit & Apply` / `Cancel` buttons
4. On Apply → the same tool fires with `dry_run: false`
5. Backend writes an **Action Receipt** (ToolCall row + audit event)
6. Receipt has a rollback hook where possible (15-min window default; end-of-session for sensitive ops)

### 9.2 Audit log

- Every tool call (dry-run or real) logged to `ToolCall` table
- Every AI turn (prompt + response + model + tokens + cost) logged to `AgentMessage`
- Existing `AuditEvent` table captures the high-level "user X did Y to Z" for compliance queries
- Admin → Audit log (new page) → filterable by entity / user / skill / tool / date range
- Export CSV / PDF for e-discovery / EU AI Act Article 12

### 9.3 Undo

- Reversible actions (status change, comment add, tag, assign) store `rollbackHook` JSON
- UI surfaces Undo button on the action receipt for 15 minutes
- After 15 min, rollback hidden but log preserved
- Irreversible actions (signature send, file exports to external systems) — **never get an Undo**, instead get a **pre-flight type-to-confirm**

---

## 10. Rollout — integrated waves (sequenced for OpenAI-only today)

One commit per item. Same method as B.6 — JTBD + reference + verify + screenshots. Prefix: `D` (for "agent-first") to distinguish from `B` (UX polish), `C` (from docs/29 pre-revision), and the contract-AI sub-commits in docs/28.

### D0 — Foundation (nothing visible to users; unblocks everything)

- **D.0.1** LangChain provider router (`MODEL_TIERS` + `build_llm(tier)`); log resolved routing at startup
- **D.0.2** Add OpenAI-tier models to `MODEL_REGISTRY` (gpt-5 alias, gpt-4.1, gpt-4.1-mini, gpt-4.1-vision, text-embedding-3-large)
- **D.0.3** Langfuse tracing middleware on all LangChain calls + custom spans for tool calls
- **D.0.4** Prisma migration: `AgentThread`, `AgentMessage`, `ToolCall`, `Skill`, `SkillInvocation`
- **D.0.5** REST endpoints: `/agent/threads`, `/agent/threads/:id/messages`, `/agent/tool_calls`, `/skills`, `/skills/:id/invoke`
- **D.0.6** Per-tenant daily cost cap + per-tool rate limit (Redis counter)
- **D.0.7** Audit-log endpoint: `/audit/query` (entity + action + date filter)
- **D.0.8** Eval harness skeleton (Langfuse-based; datasets per JTBD)

**Ship criterion**: nothing user-visible, but a smoke test can send a prompt → tool_use → tool_result → final answer round-trip via LangChain, fully traced, audit-logged, cost-capped.

### D1 — Side agent v1 (highest user-visible impact)

- **D.1.1** `<SideAgent />` component: shadcn Sidebar right, 420px, collapsible rail
- **D.1.2** Auto-context chip from URL (`/contracts/:id` → `📄 {title}`)
- **D.1.3** SSE streaming endpoint from agents service → Fastify → frontend
- **D.1.4** First 4 read tools wired: `contract_get`, `contract_search`, `contract_summarize`, `clause_search`
- **D.1.5** Tool-call trace UI (collapsible); citation chip (clickable)
- **D.1.6** Thread picker + New thread button; persistence via `AgentThread`
- **D.1.7** Quick-action rail (built-in skills as chips: `@review-contract`, `@summarise-risks`)
- **D.1.8** Feature flag: `AGENT_SIDE_PANEL_V2` — old `ChatPanel` remains as fallback

**Demo**: open any contract; side agent auto-knows which one; ask "summarise risks"; streamed answer with clickable citations.

**Verify (JTBD-2 partial)**: "Is this contract OK?" via side panel on `/contracts/:id` → summary + risks surfaces correctly.

### Wave E — Extraction fixes (blocks D2)

Inserted 2026-04-24 after a 12-contract end-to-end audit through the real
`POST /contracts/upload` pipeline. The audit found the happy path finishes
(12/12 DONE) and summaries/risk/governing-law extract well, but **three P0
regressions** break D.1.4b's `clause_search` tool and the confidence-badge
UX D2/D3 expect. Wave E is bug-fix, not new feature. Full scorecard in
Appendix C.

- **E.1** `clauseSegments → ContractClause` persistence: trace why the
  agents service's per-clause rows never land in the DB (audit: 0/12
  uploads had clauses despite summaries being correct). Fix ingest path
  on `POST /api/v1/contracts/:id/versions/:versionId/clauses` or restore
  the `storeClauseSegments()` call site.
- **E.2** `fieldConfidence` persistence: the validate step computes
  per-field confidence + quote + section but none reaches
  `Contract.fieldConfidence` (audit: 0/12 populated). Fix the PATCH
  payload on the agents-service callback.
- **E.3** Counterparty disambiguation prompt fix: extractor currently
  picks "us" as counterpartyName in 5/12 audit cases. Tighten the
  prompt to explicitly pick the OTHER party or return null, never our
  own org.
- **E.4** Fail-closed on score-step failure: Tyrell DPA + Cyberdyne
  Order Form reached `DONE` with no summary/riskScore/overallConfidence
  — pipeline silently marked success despite partial extraction. Gate
  `DONE` on score-step output being present, else `FAILED`.
- **E.5** `audit-contract-ai.mjs` upgraded from diagnostic to
  regression test: set threshold gates (≥ 10/12 type-correct, ≥ 11/12
  clauses>0, ≥ 10/12 fieldConfidence populated, ≥ 32/35 facts present),
  include real 30-contract gold set (addresses docs/28 C.0.1), run as
  part of a nightly CI step — **locks these fixes in so D2-D5 prompt
  tweaks don't regress them silently**.
- **E.6** *(deferred; not strictly blocking)* Type-classifier prompt
  tightening — Partnership→OTHER and Consulting→SOW misclassifications
  observed in audit. Ship if cheap; skip if time pressure.

**Demo**: re-run `audit-contract-ai.mjs`; watch the scorecard move from
9/12/0/0/0/34 → 12/12/≥11/≥10/≥10/≥34 across the primary metrics.

**Verify**: audit scorecard hits threshold gates. `ContractClause` rows
exist for every seeded contract; `Contract.fieldConfidence` non-empty;
no `DONE` contract is missing summary/riskScore.

### D2 — Hero agent on dashboard

- **D.2.1** `<HeroAgent />` component above Your Day band on `/dashboard`
- **D.2.2** Dynamic starter chips from Your Day counts
- **D.2.3** Shared `useAgentStore` (Zustand) between hero + side panel — threads + activeThreadId + contextChips
- **D.2.4** "Open in side panel" button on long threads
- **D.2.5** Skill-invocation chips render below the composer

**Demo**: land on `/dashboard`, type "Draft an NDA for Acme Corp", agent plans, shows plan surface, user confirms.

**Verify (JTBD-1, JTBD-3)**: start my day / draft a new contract.

### Wave F — Ingestion quality (absorbs docs/28 Wave 1)

Post-D2. Covers what makes "drop a PDF and it Just Works" true for the
full PDF universe, not just clean digital docs. Blocks D5's citation
resolver (bbox must be captured at ingest time; you can't add it later).

- **F.1** **OCR tier router** (docs/28 C.1.1): at ingest, classify each
  page — digital, image-only, mixed, table-heavy. Route image pages to
  Mistral OCR 3 (primary); Textract for dense tables; pdf-parse for
  digital. Deferred test-case is a scanned PDF; without this, image-only
  PDFs silently FAIL.
- **F.2** **Calibrated confidence via dual-pass** (docs/28 C.1.2): run
  extract with temperature 0 + a slight prompt paraphrase; disagreement
  between the two → confidence proxy. Replaces today's heuristic
  confidence. Write real 0-1 score per field.
- **F.3** **HITL queue UI for low-confidence fields** (docs/28 C.1.3):
  fields with confidence < 0.7 surface an "AI unsure — verify" badge in
  the review drawer + inline edit. Every reviewer fix is a candidate
  eval example fed back to the golden set.
- **F.4** **Bbox + char-offset capture per clause** (docs/28 C.1.4):
  during extraction, stamp every `ContractClause` with `{page, bbox,
  charStart, charEnd}`. Enables D5's citation resolver — clicking a
  citation highlights the exact region on the original PDF.
- **F.5** **Binder splitter — first-class** (docs/28 C.1.5): promote
  the existing `/detect_binder` route to auto-split multi-agreement PDFs
  at ingest; link children via `parent_binder_id`. Adds confirm-before-
  split UI step so a user can adjust split boundaries.
- **F.6** **Clause taxonomy expansion** (docs/28 C.1.6): lift from ~50
  types to 200+ subtypes (e.g. `liability_cap_fees`, `uncapped_liability`,
  `indemnity_mutual`, `indemnity_one-way`, …). Ongoing; each batch of 50
  types ships with golden-set coverage.
- **F.7** **Table extractor** (docs/28 C.1.7): Textract or Docling pass
  for pricing schedules + SLA tables; structured rows persisted to
  `contract.metadata.tables`. Unlocks "what's the Year-2 price?" on
  Cyberdyne-style order forms (the audit's $1.4M miss).

**Demo**: upload a 40-page scanned PDF binder containing MSA + SOW → 
pipeline splits into 2 children → each extracts cleanly → every clause
has bbox → HITL queue lists 3 low-confidence fields with verify badges.

**Verify (JTBD-A)**: "Read this contract for me" on the full PDF universe,
not just digital.

### D3 — Intent Preview + first writes

- **D.3.1** `<ActionPreview />` card component (plain-English + diff + Apply/Edit/Cancel)
- **D.3.2** `comment_add` tool with Intent Preview
- **D.3.3** `request_create` tool with Intent Preview
- **D.3.4** Action Receipts surfaced inline in thread
- **D.3.5** Undo button on reversible actions (15-min window)
- **D.3.6** Audit events written for every tool call

### D4 — Skills v1 (built-in + admin-created)

- **D.4.1** Skill invocation engine: `invoke_skill(skill, message, context) → agent_loop`
- **D.4.2** Seed built-in skills (the 7 in §4.3) — absorbs docs/28 C.4.1
  by splitting drafting into three named skills: `draft_template`,
  `draft_from_scratch`, `draft_from_counterparty_paper` (different
  prompts, validators, UIs per flow)
- **D.4.3** `/settings/skills` admin page: browse, edit (built-in system prompts), create org skill
- **D.4.4** `@skill` mention in composer (autocomplete from `Skill` table)
- **D.4.5** Skill-version snapshot at invocation (freeze per-run)
- **D.4.6** Skill picker chip UI on relevant page types (scope-matched)

**Verify (JTBD-2, JTBD-6)**: Review NDA end-to-end; create a new org skill via admin UI.

### D5 — Deep contract-AI integration

Absorbs the bulk of docs/28 Waves 2 + 3 (playbook + grounded RAG + OOXML).
Each sub-item maps to an explicit docs/28 C.x.y for traceability.

- **D.5.1** `playbook_check` tool — structured playbook schema
  (`must_have[]`, `must_not[]`, `bounds{}`, `variables[]`) + two-stage
  compare (embedding-similarity narrow → LLM judge on top-3) — docs/28
  **C.2.1 + C.2.2**
- **D.5.2** `redline_propose` tool — multi-version redline (least /
  moderate / most-aggressive; Ironclad's wedge) — docs/28 **C.2.3**
- **D.5.3** `redline_apply` tool — OOXML-native tracked changes emit
  (not LLM-emitted XML) — docs/28 **C.4.4**
- **D.5.4** `<RedlinePreview />` custom tool-call UI component (not raw JSON)
- **D.5.5** `contract_update` tool with action enum (status change, owner assign, retype, re-analyze)
- **D.5.6** `approval_route` tool with Intent Preview
- **D.5.7** RAG upgrade: RRF fusion (BM25 + dense) + adaptive query
  router (single-doc vs portfolio vs structured-filter routing) —
  docs/28 **C.3.3 + C.3.4**
- **D.5.8** Native Claude Citations API in grounded Q&A + citation
  resolver UI that clicks → highlights exact bbox on the PDF
  (depends on Wave F.4) — docs/28 **C.3.5 + C.3.6**
- **D.5.9** Counterparty memory + severity grouping for redline surface
  — docs/28 **C.2.4 + C.2.5**
- **D.5.10** Draft-path validators: lexicon consistency (defined terms)
  + cross-reference resolver (`"Section ___"` must resolve) —
  docs/28 **C.4.2 + C.4.3**

**Verify (JTBD-2 full, JTBD-5)**: Review contract → pick redline variant → apply. Send 8 MSAs to Legal-Tier-2 in batch.

### Wave G — AI-while-editing (docs/28 Wave 5 / JTBD-E)

Post-D5. The "AI writes with me" experience — Copilot-style ghost-text,
inline deviation badges, streaming bubble-menu AI. Harvey/Ironclad/Juro
all have varying degrees of this; we go all-in.

- **G.1** Ghost-text completion in TipTap (Copilot-style): after 400ms
  idle, stream from Haiku 4.5 given last 200 chars + doc-level brief.
  Tab to accept, Esc to dismiss — docs/28 **C.5.1**
- **G.2** Background classifier (margin badge): on each clause finalised
  (2s idle), classify + compare to playbook; amber/red badge appears
  inline when it deviates — docs/28 **C.5.2**
- **G.3** Bubble-menu AI streaming upgrade: existing `✨ AI` palette
  streams tokens from the shared model router — docs/28 **C.5.3**
- **G.4** Defined-term guard: lexicon watcher flags edits that break
  defined-term consistency ("Company" → "company") + offers one-click
  "apply everywhere" — docs/28 **C.5.4**
- **G.5** Inline deviation drawer: click a margin badge → B.5.6's
  focused-review drawer slides in with the specific deviation +
  playbook comparison + suggested rewrite — docs/28 **C.5.5**

**Verify (JTBD-E full)**: edit a clause in the canvas → after a pause
get a completion suggestion; inline badge appears if the clause deviates
from playbook.

### D6 — Skills v2 (user-created + self-bootstrap)

- **D.6.1** User-level skill creation (per-user private, org-shareable toggle)
- **D.6.2** "Skill that builds skills" — agent drafts system prompt from user's NL description
- **D.6.3** Skill marketplace (browse org library)
- **D.6.4** Skill telemetry (invocations, success rate, edits)
- **D.6.5** A/B test built-in skill prompts (shadow runs)

### D7 — Matter model + per-matter threads

- **D.7.1** `Matter` entity migration — groups contracts, requests, approvals, threads
- **D.7.2** UI: Matter view (sidebar under Contracts); Matter picker on thread
- **D.7.3** Per-matter thread sidebar in side agent
- **D.7.4** `@contract` / `@counterparty` / `@approval` entity mentions pull into context
- **D.7.5** Org memory layer — playbook + templates + past deals — queryable as tools

### Wave H — Post-signature agents (docs/28 Wave 6 / Sirion's moat)

Post-D7. Post-signature value is where Gartner MQ weighting is growing
(Sirion's differentiator). Not urgent for first demo, but shipping this
meaningfully in the v1.x window widens the moat materially.

- **H.1** Obligation extractor: dedicated prompt pass for `payment`,
  `sla`, `renewal`, `audit_rights`, `report_delivery` → structured
  `obligations[]` with `{owner, due_date, recurrence}` on Contract —
  docs/28 **C.6.1**
- **H.2** Reminder / escalation agent: daily cron walks `obligations[]`,
  sends notifications to `owner` + escalation chain; each notification
  audit-logged so "we flagged you on X, you didn't respond, we
  escalated to Y on Z" is reconstructable — docs/28 **C.6.2**
- **H.3** Portfolio anomaly detection: "this renewal window is unusual
  vs peer contracts" using per-type distributions; surface as a chip in
  the hero agent's Your Day — docs/28 **C.6.3**
- **H.4** Obligations surface in the rail: new quick-action chip
  "What's due this week?" → agent calls a new `obligations_search` tool
  → grounded list. Shared thread memory from D1 applies.

**Verify (JTBD-1 extension)**: user lands on dashboard → "3 renewals due
in 30 days" card → click → agent briefs, offers to send reminder emails.

### D8 — Power polish

- **D.8.1** Autonomy toggle (Ask / Act) in side-panel header
- **D.8.2** Slash commands (`/summarise`, `/redline`, `/search`, `/draft`)
- **D.8.3** Deep-thinking toggle → `modelTier = 'reasoning'` on this turn
- **D.8.4** Streaming bubble-menu AI already in editor → upgrade to shared model router
- **D.8.5** Voice input (v1.1 nice-to-have)

### D9 — Enterprise + multi-provider flip

- **D.9.1** When Anthropic key arrives → flip reasoning tier to Opus 4.7 via env var; run eval harness as regression gate
- **D.9.2** When Voyage key arrives → flip embeddings to voyage-law-2; dual-write for a week, cut over after recall@10 gain verified
- **D.9.3** When Cohere / Voyage rerank key arrives → replace LLM-as-reranker with dedicated reranker
- **D.9.4** PII redactor at ingest boundary (Private AI or OpenAI privacy filter)
- **D.9.5** Hash-chained audit log
- **D.9.6** SOC2 documentation pack

---

## 11. Decision matrix against market (the "why" recap)

| Decision | Pattern | Evidence | Why not the alternative |
|---|---|---|---|
| Hero above dashboard | Pattern B | Attio's live CRM reference; no CLM does this today | Pattern A (agent-first) erases habitual queues users need |
| Side panel on every page | Pattern C (companion) | Salesforce Agentforce, Ironclad Jurist, Notion Q&A | Pattern D (palette-only) is invisible, undersells agent identity |
| Shared memory across hero + side | Pattern E dual-surface | Notion 3.0 explicitly unified | Two disconnected chats confuse users (reviewed poorly) |
| Skills as first-class | Claude Skills, Custom GPTs, Notion Agents | Every user's workflow differs; generic chat makes users re-prompt | Hardcoded workflows age; user customisation is the moat |
| Workflow-shaped tools (15) | Anthropic engineering guidance | "`schedule_event` beats `list_events + create_event`" | CRUD-shaped catalogs bloat and confuse the model |
| Intent Preview for writes | Smashing's 2026 agentic AI pattern | Table-stakes for enterprise trust | Silent execution = "what did the AI just do?" horror |
| LangChain multi-provider | Per your constraint | Already in use; provider-agnostic from day 1 | Anthropic direct would lock us in + require rewrite when Anthropic key arrives |
| Per-matter threads | Harvey Shared Spaces, Claude Projects | Users work on deals (multiple contracts) | Per-contract threads fragment context; global threads lose scope |
| Built-in + org + user skills | 3-tier OpenAI GPTs + Anthropic Skills precedent | Everyone's workflow differs | Only built-in = rigid; only user = unsafe defaults |
| Don't replace dashboard | Review evidence | Transactional SaaS reviews are uniformly bad when dashboard goes away | Agent-first landing kills at-a-glance awareness |

---

## 12. What we're NOT degrading

Explicit guarantees so nothing ships that regresses:

- **7 existing LangGraph agents** (review / redline / assist / draft / approval / portfolio / ask) — all remain. They become the *backend pipelines* for agent tools.
- **All B.5 + B.6 UI** — unified canvas, risk markers, focused review, compare mode, side rail, approver decision strip, counterparty portal, coach marks, Linear-style activity feed, Expiring Soon deep-link, Counterparties drill-through, global search, breadcrumbs, toast system — everything stays.
- **⌘K contract-scoped palette** (B.5.9) — stays.
- **⌘/ global search palette** (B.6.25) — stays.
- **ChatPanel** — stays functional behind a feature flag while we roll out D1 (SideAgent v2). No "big bang" cutover.
- **All existing REST endpoints** — the agent tools are wrappers, not replacements. Existing UI keeps using the same endpoints.
- **Prisma migrations are additive only** — new tables (AgentThread, Skill, etc.); no column renames or drops.

---

## 13. User-journey walk-through (plan validation)

Running each JTBD through the plan end-to-end to prove the pieces fit:

### JTBD-1 "Start my day" (D2 + D4)
1. Login → `/dashboard` — Hero agent (D.2.1) at top
2. Starter chips (D.2.2) pulled from Your Day band: `[Review 1 approval] [Triage 2 drafts] [Send 2 expiring renewals]`
3. Click `Review 1 approval` → navigate to `/approvals`, side panel opens with `@prep-for-approval` skill (D.4.2) pre-loaded on the pending item

### JTBD-2 "Is this contract OK?" (D1 + D4 + D5)
1. On `/contracts/:id`, side panel auto-context = contract (D.1.2)
2. Quick-action chip `@review-contract` (D.4.2, scope=current_contract)
3. Skill narrows tools to `contract_get`, `playbook_check`, `contract_summarize`, `clause_search` → agent runs pipeline in parallel
4. Returns artifact: 3-sentence summary + risk score + top 3 deviations + suggested multi-version redlines (D.5.2)
5. User picks "moderate" variant → Intent Preview card (D.3.1) → Apply → `redline_apply` fires, draft opens in editor
6. Thread preserved; follow-up chip `@prep-for-approval` suggested

### JTBD-3 "Draft a new contract" (D2 + D4)
1. Hero: "Draft an NDA for Acme Corp, mutual, 2-year, California law"
2. Agent picks `@draft-from-scratch` skill (D.4.2) automatically, or user typed the slug
3. Plan surface: 3 steps
4. Confirm → `contract_create_from_template` → draft artifact in thread → "Open in editor" button → `/contracts/:id`

### JTBD-4 "Ask across my portfolio" (D1 read tools)
1. Hero or side: "Which MSAs expire in Q2 with uncapped liability?"
2. Agent picks `contract_search` with filters derived from question
3. Returns tabular artifact (rows=contracts, cols=title/counterparty/expires/risk) — this is the Hebbia-Matrix UX pattern surfaced as a tool response
4. User clicks row → contract detail opens; thread follows

### JTBD-5 "Do this at scale" (D3 + D5)
1. Hero: "Send every MSA over $100k in US jurisdiction for Legal-Tier-2 approval"
2. Agent plan surface: 4 steps, 8 candidates
3. Review artifact → remove 1
4. Confirm → agent batches `approval_route` 7× with staged summary
5. Each call appears as its own receipt with Undo (D.3.5)

### JTBD-6 "Build my own workflow" (D4 + D6)
1. Settings → Skills → Create
2. Natural-language description ("each time we get a vendor's paper …")
3. Agent drafts system prompt (D.6.2) → user edits
4. Picks tools → publishes
5. Next contract upload → chip appears: `@vendor-paper`

### JTBD-7 "Audit what happened" (D0 + D3)
1. Admin → Audit log page (D.0.7 + D.3.6)
2. Filter by contract Zynga MSA → date March
3. See rows: user, skill, tool, params (sanitised), result, receipt, Undo-available?
4. Export → CSV

Every JTBD is covered by D0-D5; D6-D9 are power-user polish.

---

## 14. Risks + how we address them

| Risk | Likelihood | Mitigation |
|---|---|---|
| LangChain overhead / abstraction leak | Med | Benchmark against direct OpenAI SDK; if >15% latency cost, add thin provider-specific overrides (`OpenAIStreamingChat`) |
| OpenAI-only limits quality on hard legal tasks | Med | GPT-5 / GPT-4.1 on ContractEval is 0.64 F1 (docs/28 research) — adequate. Flip to Opus 4.7 on key arrival = instant ~5% F1 lift with zero code change |
| Skills become a dumping ground | Med | Admin review queue for org-published skills; user skills private by default; usage telemetry |
| Tool catalog bloat | Med | Cap active tools at 20 per turn; `defer_loading` for the long tail; eval harness catches regressions from adding tools |
| Intent Preview ignored ("oh just apply") | Low | Visual design that doesn't dim the preview; destructive ops require type-to-confirm regardless |
| Per-tenant cost overrun | Low | Redis hard-cap (D.0.6); alert at 80%; block at 100%; audit who triggered |
| Langfuse self-host overhead | Low | Single docker-compose service; proven scale (19k stars) |
| Privacy — agent sees other tenants | Low (bugs happen) | Scope check at tool-execution boundary (not prompt); DB-level filters; Prisma middleware enforces `orgId` on every query; unit tests |
| Multi-provider routing breaks in prod | Low | Startup check: enumerate keys + resolved routing; refuse to boot if required tier has no provider |

---

## 15. Summary / what I need from you to start building

### The shape (no approval needed — these are the recommendation)

- **Hero above dashboard + Side panel everywhere, shared memory** (Pattern B + E)
- **15-tool workflow-shaped catalog**, grown organically via `defer_loading` for tail tools
- **Skills** as a first-class layer — built-in (7) + org-configurable + user-private
- **LangChain** as the multi-provider abstraction — OpenAI-only today
- **Intent Preview + Audit + Undo** for every write
- **Per-Matter threads** (D7) — not per-contract, not global
- **Nothing degraded**: 7 existing agents stay; B.5/B.6 stays; ChatPanel stays behind flag until D1 ships

### The three decisions I'd like confirmed

1. **Start-order**: **D0 foundation → D1 side agent → D2 hero → D3 Intent Preview → D4 skills → D5 contract-AI tools**. Agreed?
2. **Model tier on OpenAI today**: GPT-5 for reasoning (or GPT-4.1 if unavailable), GPT-4.1 default, GPT-4.1-mini fast. Agreed?
3. **Skills scope for v1**: ship 7 built-in + admin-created org skills. User-created private skills land in D6. Agreed?

### Files I'll create for D0 (the foundation wave) if you say yes

- `apps/agents/app/router.py` — LangChain provider router + tier resolution
- `apps/agents/app/tools/` — one file per tool; strict schemas; tests
- `apps/agents/app/skills/` — skill engine + seed built-ins
- `apps/agents/app/tracing.py` — Langfuse hook
- `apps/api/prisma/migrations/<timestamp>_add_agent_schema/` — AgentThread / AgentMessage / ToolCall / Skill / SkillInvocation
- `apps/api/src/routes/agent.ts` — REST for threads, messages, tool_calls, SSE stream
- `apps/api/src/routes/skills.ts` — REST for skills CRUD + invoke
- `apps/api/src/lib/costCap.ts` — per-tenant Redis counter
- `docs/30-agent/evals/` — eval harness scaffold + first JTBD-1 eval case

Once D0 ships (invisible to users, but measurable via Langfuse dashboard), D1 makes the side panel visible. That's the first "wow" demo.

---

## 16. Links worth keeping (consolidated from 3 research rounds)

### Market references for the entry-point decision
- [Attio — the live hero-above-dashboard reference](https://attio.com/help/reference/attio-ai/ask-attio/chat-with-ask-attio)
- [Harvey Assistant](https://www.harvey.ai/platform/assistant) + [Shared Spaces](https://www.harvey.ai/blog/shared-spaces-and-collaboration-in-harvey)
- [Ironclad Jurist](https://support.ironcladapp.com/hc/en-us/articles/27720356105239-Use-Jurist) — dashboard + contextual agent
- [Salesforce Agentforce Assistant](https://www.salesforce.com/agentforce/einstein-copilot/)
- [Notion 3.0 release](https://www.notion.com/releases/2025-09-18) + [Notion Q&A](https://www.notion.com/blog/introducing-q-and-a)

### Skills paradigm
- [Anthropic Claude Skills — Projects doc](https://www.anthropic.com/news/projects)
- [OpenAI Custom GPTs](https://platform.openai.com/docs/guides/gpts)
- [Dia Skills — TechCrunch launch](https://techcrunch.com/2025/06/11/the-browser-company-launches-its-ai-first-browser-dia-in-beta/)

### Agent engineering (Anthropic)
- [Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents) — tool-catalog best practices
- [Building Effective AI Agents](https://www.anthropic.com/research/building-effective-agents)
- [Extended thinking with tools](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Anthropic Citations API + 1M context GA](https://claude.com/blog/1m-context-ga)

### UX patterns
- [Smashing Magazine — Designing for Agentic AI, Feb 2026](https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/)
- [AI UX Design Guide — Intent Preview](https://www.aiuxdesign.guide/patterns/intent-preview)

### Frontend / streaming
- [assistant-ui for React](https://www.assistant-ui.com/) + [Generative UI](https://www.assistant-ui.com/docs/guides/ToolUI)
- [Vercel AI SDK 5](https://vercel.com/blog/ai-sdk-5)

### Evidence behind model / stack picks
- [ContractEval (arXiv 2508.03080)](https://arxiv.org/abs/2508.03080) — CUAD clause risk benchmark
- [Harvey BigLaw Bench](https://www.harvey.ai/blog/introducing-biglaw-bench)
- [Vals AI VLAIR](https://www.vals.ai/vlair) — multi-vendor legal AI report
- [Voyage voyage-law-2](https://blog.voyageai.com/2024/04/15/domain-specific-embeddings-and-retrieval-legal-edition-voyage-law-2/)

### Failure modes
- [NimbleBrain — AI agent failure modes](https://nimblebrain.ai/why-ai-fails/agent-governance/agent-failure-modes/)
- [Arize — Why AI agents break](https://arize.com/blog/common-ai-agent-failures/)
- [Clark IEEE — Operational hallucination + safety drift](https://commons.clarku.edu/sops_fac/14/)

---

*End of unified plan. Waiting on three confirmations in §15 and I'll build D0.*

---

## Addendum A — Confirmations + scope additions (2026-04-24)

User confirmed all three. Net effect:

1. **Start-order**: D0 → D1 → D2 → D3 → D4 → D5. ✅ unchanged.
2. **Model tier today**: GPT-5 reasoning, GPT-4.1 default, GPT-4.1-mini fast. ✅ — **with three additions** that materially expand D0:
 - **(a) Configurable from admin UI** — admin can change the per-tier model default (e.g., flip everything to GPT-4.1 for cost predictability)
 - **(b) Bring-Your-Own-Key (BYOK)** — orgs can paste their own OpenAI / Anthropic / Google / Voyage / Cohere / Mistral key. When present, all calls for that provider use the org's key instead of the platform key.
 - **(c) Usage tracking** — capture tokens in/out, cost, latency, call count per org / provider / model / tier / tool. Used for cost-cap, billing later, and the AI Settings dashboard.
3. **Skills v1**: 7 built-in + admin-created org skills. ✅ unchanged.

### How (a)(b)(c) change D0

D0 grows from "invisible foundation" into a small user-visible wave too — the admin sees a new **AI Config** tab on `/admin/org`. Re-sequenced:

- **D.0.1** Prisma migration — all agent tables PLUS `OrgAiKey`, `OrgAiSettings`, `OrgUsageDaily`
- **D.0.2** Encryption helper for BYOK (AES-GCM with master key from env)
- **D.0.3** LangChain provider router with org-aware resolution:
 - Tier → tier preference for org → (provider, model) → if org has BYOK for that provider use it, else use platform key, else fall back to next tier option
 - Refuses to boot if a required tier has no available provider+key
- **D.0.4** REST endpoints (skeletal):
 - `/agent/threads`, `/agent/threads/:id/messages`, `/agent/tool_calls`
 - `/skills` (list + invoke)
 - `/admin/ai/settings` (get/update per-tier model picks + daily cost cap)
 - `/admin/ai/keys` (list + add + test-connection + delete BYOK)
 - `/admin/ai/usage` (aggregated per day / provider / model / tool)
- **D.0.5** Per-tenant cost cap (Redis daily counter, hard ceiling)
- **D.0.6** Audit-log endpoint (`/audit/query`)
- **D.0.7** Langfuse tracing middleware on all LangChain calls — every span tagged with `org_id`, `provider`, `model`, `tier`, `tool_name`
- **D.0.8** **AI Config tab UI** (`/admin/org` second tab — currently a stub):
 - Model defaults per tier (6 dropdowns: reasoning, default, fast, embed, rerank, vision_ocr). "Set all to GPT-4.1" one-click.
 - BYOK section — 6 provider cards (Platform / BYOK / Not configured), Add Key + Test buttons
 - Usage dashboard — daily/monthly cost, breakdown by provider/model/tier/tool, sparkline
 - Daily cost cap input (USD)
- **D.0.9** Eval harness scaffold (Langfuse-based; one dataset per JTBD)

### New Prisma schema for D0

```prisma
// ─── BYOK + AI Settings ──────────────────────────────────────────────────────

model OrgAiKey {
  id              String    @id @default(cuid())
  orgId           String
  provider        String    // 'openai' | 'anthropic' | 'google' | 'voyage' | 'cohere' | 'mistral'
  encryptedKey    String    // AES-GCM ciphertext (base64)
  keyPrefix       String    // first 8 chars for UI display (e.g., "sk-proj-")
  isActive        Boolean   @default(true)
  lastTestedAt    DateTime?
  testStatus      String?   // 'success' | 'failed' | null
  testError       String?
  createdById     String
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  org             Organization @relation(fields: [orgId], references: [id])
  createdBy       User         @relation(fields: [createdById], references: [id])

  @@unique([orgId, provider])
  @@index([orgId, isActive])
  @@map("org_ai_keys")
}

model OrgAiSettings {
  id              String    @id @default(cuid())
  orgId           String    @unique
  // Per-tier overrides; null = use platform default for that tier
  reasoningModel  String?   // "openai/gpt-5", "anthropic/claude-opus-4-7", etc.
  defaultModel    String?
  fastModel       String?
  embedModel      String?
  rerankModel     String?
  visionOcrModel  String?
  // Daily cost ceiling (USD); null = use platform default
  dailyCostCapUsd Decimal?  @db.Decimal(10, 2)
  // Hard cap behaviour: 'block' (refuse calls) | 'warn' (alert admin)
  capPolicy       String    @default("block")
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  org             Organization @relation(fields: [orgId], references: [id])

  @@map("org_ai_settings")
}

// ─── Usage tracking (aggregated daily for fast dashboards) ───────────────────

model OrgUsageDaily {
  id              String    @id @default(cuid())
  orgId           String
  date            String    // 'YYYY-MM-DD' (org's UTC day)
  provider        String
  model           String
  tier            String    // 'reasoning' | 'default' | 'fast' | 'embed' | 'rerank' | 'vision_ocr'
  toolName        String?   // null for non-tool agent calls
  inputTokens     Int       @default(0)
  outputTokens    Int       @default(0)
  costUsd         Decimal   @default(0) @db.Decimal(10, 6)
  callCount       Int       @default(0)
  // True if calls used a BYOK key (cost is informational rather than billable to platform)
  isByok          Boolean   @default(false)

  @@unique([orgId, date, provider, model, tier, toolName, isByok])
  @@index([orgId, date])
  @@map("org_usage_daily")
}
```

These join the agent tables (AgentThread / AgentMessage / ToolCall / Skill / SkillInvocation) defined in §7.2. All purely additive.

### Provider router resolution (pseudo-code)

```python
# apps/agents/app/router.py
async def resolve_llm(tier: str, org_id: str) -> ResolvedLLM:
    # 1. Look up org's per-tier preference (or platform default)
    settings = await get_org_ai_settings(org_id)
    pref = settings.get(f"{tier}Model")  # "openai/gpt-5" or null
    candidates = [pref] if pref else PLATFORM_TIER_DEFAULTS[tier]

    for cand in candidates:
        provider, model = cand.split("/")
        # 2. Check org BYOK first
        api_key = await get_org_byok(org_id, provider)
        used_byok = api_key is not None
        # 3. Fall back to platform key
        if not api_key:
            api_key = PLATFORM_KEYS.get(provider)
        if not api_key:
            continue  # no key for this provider → try next candidate
        # 4. Cost cap check (only when not BYOK)
        if not used_byok and await cost_cap_exceeded(org_id):
            raise CostCapExceededError(org_id)
        # 5. Build LangChain model
        return ResolvedLLM(
            llm=build_langchain_llm(provider, model, api_key),
            provider=provider, model=model, used_byok=used_byok, tier=tier,
        )
    raise NoProviderAvailable(tier=tier)
```

### Usage tracking write path

LangChain's response callback → middleware writes to `OrgUsageDaily` (UPSERT on the unique key) → daily aggregation is automatic. Nightly cron compacts older days into a separate monthly table if volume warrants (skip for v1).

### What ships visible in D0

After D0:
- `/admin/org` has a populated **AI Config** tab. Admin can flip model defaults, paste BYOK keys, see usage.
- No agent panel yet (that's D1).
- All existing flows unchanged.

This is the right shape: the user asked for the foundation to be configurable + cost-trackable from day 1, not bolted on later. D1's side agent will be the first place where AI behaves *differently* per org based on what the admin configured.

### Three small choices I'm making (call out for veto)

1. **Encryption master key** — env var `AI_KEY_ENCRYPTION_KEY` (32 bytes, base64). Set once, never rotated unless you want re-encryption tooling. OK to add a basic re-encryption migration in v1.1 if you want rotation.
2. **BYOK provider list** — start with OpenAI, Anthropic, Google for D0. Voyage / Cohere / Mistral added in D9 when those tiers actually need them (and you can paste their keys earlier — UI shows them but with a "Not yet used" badge).
3. **Cost-cap default** — $50/day per org as the platform default. Easy to override per org. BYOK calls don't count against the platform cap (they go against the org's own provider account).

If any of those three need a different default, say so before I start D.0.1.

---

## Addendum B — Docs/28 items → docs/30 wave landing map (2026-04-24)

After the audit, every open item in docs/28 is accounted for below. This
exists so that when a v1.x roadmap review asks "what happened to OCR?"
or "when do we get multi-version redline?", there's a single table to
consult instead of rereading two plans.

**P0** = must for v1 GA · **P1** = must for "best in market" · **P2** =
v1.5 competitive moat.

| docs/28 | What | Prio | Lands in |
|---|---|---|---|
| C.0.1 | Extraction eval gold set + CI gate | P0 | **Wave E.5** (regression test + 30-contract gold set) |
| C.0.2 | Model registry update | P0 | ✅ Done in D.0.3 |
| C.0.3 | Task-based model routing | P0 | ✅ Done in D.0.3 |
| C.0.4 | Langfuse tracing | P0 | ✅ Done in D.0.7 |
| C.0.5 | Per-tenant cost cap | P0 | ✅ Done in D.0.5 |
| C.1.1 | OCR tier router (Mistral OCR 3) | P1 | **Wave F.1** |
| C.1.2 | Calibrated confidence (dual-pass) | P1 | **Wave F.2** |
| C.1.3 | HITL queue UI | P1 | **Wave F.3** |
| C.1.4 | Bbox/char-offset capture | P1 | **Wave F.4** (ingest) + D.5.8 (UI) |
| C.1.5 | Binder splitter first-class | P2 | **Wave F.5** |
| C.1.6 | 1000+ clause taxonomy | P2 | **Wave F.6** (iterative) |
| C.1.7 | Table extractor | P2 | **Wave F.7** |
| C.2.1 | Structured playbook schema | P0 | **D.5.1** |
| C.2.2 | Two-stage playbook compare | P1 | **D.5.1** |
| C.2.3 | Multi-version redline | P0 | **D.5.2** |
| C.2.4 | Counterparty memory | P2 | **D.5.9** |
| C.2.5 | Severity grouping | P2 | **D.5.9** |
| C.3.1 | voyage-law-2 embeddings | P1 | ✅ Already in D.9.2 |
| C.3.2 | voyage-rerank-2.5 | P1 | ✅ Already in D.9.3 |
| C.3.3 | RRF fusion BM25+dense | P1 | **D.5.7** |
| C.3.4 | Adaptive query router | P1 | **D.5.7** |
| C.3.5 | Claude Citations API | P1 | **D.5.8** |
| C.3.6 | Citation resolver UI | P1 | **D.5.8** (depends on F.4) |
| C.4.1 | Split draft into 3 named graphs | P1 | **D.4.2** (three built-in skills) |
| C.4.2 | Lexicon validator | P2 | **D.5.10** |
| C.4.3 | Cross-reference resolver | P2 | **D.5.10** |
| C.4.4 | Surgical OOXML tracked-changes | P1 | **D.5.3** |
| C.4.5 | Word-native round-trip | P2 | Post-v1 (candidate Wave J) |
| C.5.1 | Ghost-text completion | P1 | **Wave G.1** |
| C.5.2 | Background classifier margin badge | P1 | **Wave G.2** |
| C.5.3 | Bubble-menu AI streaming | P1 | **Wave G.3** (also covered by D.8.4) |
| C.5.4 | Defined-term guard | P2 | **Wave G.4** |
| C.5.5 | Inline deviation drawer wiring | P1 | **Wave G.5** |
| C.6.1 | Obligation extractor | P1 | **Wave H.1** |
| C.6.2 | Reminder / escalation agent | P1 | **Wave H.2** |
| C.6.3 | Portfolio anomaly detection | P2 | **Wave H.3** |
| C.7.1 | PII redactor at ingest | P1 | ✅ Already in D.9.4 |
| C.7.2 | Hash-chained audit log | P1 | ✅ Already in D.9.5 |
| C.7.3 | VPC deployment mode (Bedrock/Azure) | P2 | D9 (expand when first enterprise deal triggers it) |
| C.7.4 | SOC 2 controls + DPIA | P1 | ✅ Already in D.9.6 |

### Updated wave sequence (reflects Waves E/F/G/H insertions)

```
D0 ✅ → D1 ✅ →  E  → D2 →  F  → D3 → D4 → D5 →  G  → D6 → D7 →  H  → D8 → D9
        done    bugs  hero ingest IP skills deep  edit      matter post-sig polish enterprise
```

**P0 path to "good enough to charge"**: E → D2 → D3 → D4 → D5.
**P1 differentiators that win deals**: F + G + multi-version redline (D5.2) + obligations (H).
**Enterprise unlock** (>$1M ACV): D9.

Anything NOT in this table has been explicitly deferred to post-v1.x
(e.g. agent-to-agent autonomous negotiation, full fine-tune, built-in
legal research). See docs/28 §8 "Passes" for rationale.

---

## Appendix C — Contract AI audit (2026-04-24)

**Why Wave E exists:** this scorecard from
`scripts/audit-contract-ai.mjs`, which uploads 12 realistic contracts
through the real `POST /api/v1/contracts/upload` pipeline and measures
what makes it into the DB vs docs/28 promises.

```
━━━ Aggregate ━━━
  uploaded:                12
  DONE:                    12/12
  FAILED:                   0/12
  TIMEOUT:                  0/12
  type correctly inferred:  9/12
  counterparty extracted:   7/12    ← 5 cases picked our org as counterparty
  governing law extracted:  7/7
  value extracted:          4/5
  summary present:         10/12
  riskScore present:       10/12
  overallConfidence:       10/12
  fieldConfidence:          0/12    ← P0 regression: computed but not persisted
  clauses > 0:              0/12    ← P0 regression: extracted but not stored
  per-fixture facts:       34/35
  mean time to completion: 64.5s
```

Three P0 regressions surfaced:
1. `ContractClause` rows never written (0/12) even though the agents
   service extracts them.
2. `Contract.fieldConfidence` never populated (0/12) even though the
   validate step computes the values.
3. Two contracts (Tyrell DPA, Cyberdyne Order Form) reached `DONE` with
   no summary/riskScore — silent partial-success.

Plus one prompt-quality issue (counterparty picks "us" in 5/12 cases).

These are fixed in **Wave E**. The 12 fixture files live at
`apps/api/scripts/fixtures/ai-demo/*.txt` and the full audit artifact
at `scripts/audit-contract-ai.mjs`. Re-running the audit after Wave E
should produce clauses >0 and fieldConfidence populated on every row —
that's the Wave E exit criterion.

### Post-Wave-E scorecard (2026-04-24)

Run `scripts/audit-contract-ai.mjs --regress` against the 12-fixture
suite. Regression gates floor is the minimum the pipeline must hold for
CI to pass; ideal is the aspirational target.

```
  uploaded:                12
  DONE:                    12/12   (was 12/12, still)
  FAILED:                   0/12   (was 0/12)
  TIMEOUT:                  0/12

  clauses > 0:             12/12   ← E.1 revealed false positive
  summary present:         12/12   (was 10/12) ← E.4 dropped silent fallback
  riskScore present:       12/12   (was 10/12) ← E.4
  overallConfidence:       12/12   (was 10/12) ← E.4
  fieldConfidence:         12/12   (was  0/12) ← E.2 schema fix
  counterparty extracted:  12/12   (was  7/12) ← E.3 org-name filter
  governing law extracted:  7/7    (was  7/7)  + now in jurisdiction column
  value extracted:          5/5    (was  4/5)  ← found Cyberdyne $1.4M
  per-fixture facts:       35/35   (was 34/35) ← E.6 prompt tightening
  type correctly inferred:  9/12   (was  9/12) ← E.6 swapped wins: Acme MSA +
                                                  Wayne Partnership now
                                                  correct; LLM sampling
                                                  jitter on the remaining 3
  mean time to completion: ~70s per contract
```

The 9/12 type gate floors at 7/12 to tolerate LLM sampling nondeterminism;
tightening to 10/12 is a candidate for Wave F.6 (taxonomy expansion +
few-shot classification).

Post-fix proof-of-work: `scripts/wave-e-user-journey.mjs` uploads one
fixture through the real pipeline, waits for DONE, opens the contract
detail page — screenshot `77-wave-e-populated-contract.png` shows every
KEY TERMS row populated (Acme Corporation counterparty, Jan 15 2026
effective, Delaware jurisdiction, $250,000 value) + an AI summary in
OVERVIEW.

**Wave E commit trail** (all on `feature/agent-first-clm`):

| commit | scope |
|---|---|
| `6563d44` | docs(30): Waves E/F/G/H + integration map + audit appendix |
| `93f7c5f` | E.1 — fix audit measurement (clauses false positive) |
| `95dd0f3` | E.2 — fieldConfidence + jurisdiction + analysisStatus Zod |
| `751916f` | E.3 + E.4 — counterparty + ContractType enum alignment |
| `4e389d7` | E.4 hardening — remove silent-FAILED fallback + regression gates |
| `7a86bb6` | E.6 — type-classifier prompt tightening + multi-valid fixtures |

D2 (Hero agent on dashboard) is now unblocked — every tool D2 will call
has trustworthy extraction data underneath it.

---

## Appendix D — D3 / D4 / D5 build trail (2026-04-24)

Status as of commit `273286a`. Everything in this table ships with a
scripts/d{NN}-verify.mjs that exits non-zero on any gate failure, and at
least one screenshot under `scripts/screenshots/desktop/`. The D5
walkthrough (`scripts/d5-walkthrough.mjs`) runs all eight acts end-to-end
in one scripted user journey with 9 screenshots (110–118).

### D3 — Intent Preview + first writes

| Item | commit | surface | reversible? |
|---|---|---|---|
| **D.3.1** `<ActionPreview />` card | `ad49c2e` | rail inline | n/a (UI only) |
| **D.3.2** `comment_add` tool | `ddaf1e3` | Intent Preview | yes (soft-delete) |
| **D.3.3** `request_create` tool | `82e8749` | Intent Preview | yes (→ CANCELLED) |
| **D.3.4** Action Receipts inline | (folded into D.3.1) | rail | n/a |
| **D.3.5** Undo button + 15-min window | `0279956` | receipt chip | n/a |
| **D.3.6** AuditEvent rows per apply/undo | `3493573` | audit trail | n/a |

### D4 — Skills v1 (built-in + admin-created)

| Item | commit | surface |
|---|---|---|
| **D.4.1** Skill invocation engine (resolve → snapshot → narrow → inject) | `37dad22` | `/agent/chat` + Python orchestrator |
| **D.4.2** Seed the 9 built-in skills | `bd622b7` | `seed-skills.ts` + `GET /skills` |
| **D.4.3** `/admin/skills` admin page | `d6dcbfb` | React — list / edit / create |
| **D.4.4** `@skill` mention autocomplete | `7381be6` | rail composer |
| **D.4.5** Skill-version snapshot | (folded into D.4.1) | SkillInvocation.skillVersion |
| **D.4.6** Skill picker chip UI | `a7b1d4b` | hero + rail |

Built-in catalog (9 slugs, docs/30 §4.3 + docs/28 C.4.1 drafting-split):
`@review-contract`, `@review-nda`, `@prep-for-approval`, `@renewal-check`,
`@draft-from-template`, `@draft-from-scratch`, `@draft-from-counterparty-paper`,
`@compliance-sweep`, `@explain-clause`.

### D5 — Deep contract-AI integration (partial)

| Item | commit | notes |
|---|---|---|
| **D.5.1** `playbook_check` tool | `273286a` | returns `{checks[], unmapped[]}` without calling judge-LLM inline; agent LLM does the reasoning |
| **D.5.2** `redline_propose` | **deferred** | depends on docs/28 C.2.3 redline pipeline |
| **D.5.3** `redline_apply` (OOXML) | **deferred** | depends on docs/28 C.4.4 |
| **D.5.4** `<RedlinePreview />` UI | **deferred** | pairs with D.5.2/3 |
| **D.5.5** `contract_update` tool | `141ffe4` | action enum: set_status / assign_owner / add_tag / remove_tag (reversible) + retype / re_analyze (not) |
| **D.5.6** `approval_route` tool | `17a74b4` | inline happy path — escalation + AI summary queues skipped for the agent-driven route (callback to cron) |
| **D.5.7** RAG upgrade (RRF + adaptive) | **deferred** | infra-heavy |
| **D.5.8** Citations API | **deferred** | needs Wave F bbox work |
| **D.5.9** Counterparty memory | **deferred** | small but out of v1.x critical path |
| **D.5.10** Draft validators | **deferred** | needs drafting tool chain |

The redline triplet (D.5.2/3/4) is the biggest still-deferred chunk —
explicit dependency on docs/28 Wave 2+3. Everything else in D5 is
either shipped or a standalone follow-up that doesn't block the D4 user
experience.

### End-to-end proof

`scripts/d5-walkthrough.mjs` drives the full journey in one scripted
run:

1. Dashboard lands with hero skill chips + YourDay chips.
2. Contract detail shows rail skill chips.
3. `@rev` → autocomplete → Enter inserts `@review-contract`.
4. Agent replies; tool-trace chips visible; SkillInvocation row written.
5. `contract_update(set_status)` → Apply → DB flips → Undo → reverts.
6. `approval_route` → Apply → instance created → Undo → cancels.
7. Admin visits `/admin/skills`, sees 9+ rows.
8. Back on dashboard, hero shows "Continue: <thread>" pill.

Screenshots: `scripts/screenshots/desktop/110-walkthrough-dashboard.png`
through `118-walkthrough-hero-continue.png` (9 frames).

### Tool catalog shipped vs docs/30 §5

| docs/30 §5 entry | status |
|---|---|
| `contract_search`  | shipped (D.1.4b) |
| `contract_get`     | shipped (D.1.4a) |
| `contract_summarize` | shipped (D.1.4b) |
| `clause_search`    | shipped (D.1.4b) |
| `playbook_check`   | shipped (D.5.1) |
| `approval_list`    | REST endpoint exists (`/approvals/my-queue`); no tool wrapper yet |
| `counterparty_get` | REST endpoint exists; no tool wrapper yet |
| `request_list`     | REST endpoint exists; no tool wrapper yet |
| `audit_log_query`  | endpoint + tool wrapper deferred (enterprise-compliance feature) |
| `custom_field_list`| REST endpoint exists; no tool wrapper yet |
| `contract_create_from_template` | REST exists; tool deferred (D.4.2 `@draft-from-template` skill currently describes the draft, doesn't fire the tool) |
| `contract_update`  | shipped (D.5.5) |
| `redline_propose`  | deferred (D.5.2) |
| `redline_apply`    | deferred (D.5.3) |
| `approval_route`   | shipped (D.5.6) |
| `request_create`   | shipped (D.3.3) |
| `comment_add`      | shipped (D.3.2) |

Five read + four write tools live through the write-pauses-on-Intent-
Preview pattern. The remaining read-tool wrappers are mechanical — each
takes a half-day to wire up.
