# Doc 32 — Final Agent UX Redesign (single-shot)

> **Decision (locked):** Ship the entire redesign in one push. No phased "keep+delete later" path. The doc below describes the **final state** plus everything we'll fix in the same release.
> **All 15 product/UX decisions locked** in §14 — no remaining design questions before build.
> **Owner:** Aniket. **Drafted:** 2026-04-26. **Status:** ready to plan.
> **Companion screenshots:** `scripts/screenshots/ux-deep/` (54 shots) + `scripts/screenshots/agent-audit/` (12 shots).

---

## 1 · The end state in one sentence

> **One global Assistant for "do work" + one contextual Ask rail for "answer about this page" + one inline ✨ bubble for selected text. Everything else is deleted.**

That's it. Three AI surfaces, total.

```
┌─ End state ─────────────────────────────────────────────────────────────┐
│  1. Sidebar "Assistant"  →  /agent route, full-screen studio with       │
│                              chat + threads + artifact pane on right    │
│  2. Right rail "Ask"     →  contextual companion on every other route,  │
│                              auto-pinned to the resource you're on      │
│  3. Bubble ✨            →  text-selection only, inline rewrite menu    │
└──────────────────────────────────────────────────────────────────────────┘

Plus the cross-cutting hotkey:
  ⌘K       focuses the rail composer (or opens it if collapsed)
```

---

## 2 · The two AI front doors, side-by-side

|  | **Assistant** (`/agent`) | **Ask** (right rail) |
|---|---|---|
| **Purpose** | Multi-step work with artifacts | Quick answers about the current page |
| **Where** | Dedicated full-screen route | Right column on every non-`/agent` route |
| **Header** | "Assistant" + thread title | "Ask" + Context chip (current resource) |
| **Layout** | 3-zone: threads / chat / artifact | Single column |
| **Reply length** | Long; opens artifact when output ≥ a paragraph | Short; long answers offer "Open in Assistant →" |
| **Generates artifacts** | Yes — Doc / Table / Diff / Form / Card | No |
| **Writes (creates / sends / signs)** | Yes — via artifacts with [Save] [Send] CTAs | No — read-only by default; routes write asks to Assistant |
| **Threads list** | Yes (left rail of `/agent`) | No — single active thread |
| **Per-resource history** | Filterable in threads list | Header chip: "3 prior threads ▾" |
| **Skills (@mentions)** | Yes | Yes |
| **Quick-action filter** | `/`-slash menu in composer | `/`-slash menu in composer |

These two surfaces look, feel, and read **clearly different**. No user mistakes one for the other.

---

## 3 · JTBD coverage matrix

Every user need maps to **exactly one** surface. If a JTBD doesn't land anywhere, the design is incomplete.

| User says | Surface | Result type |
|---|---|---|
| "What's in my approval queue?" | Assistant | Table artifact |
| "Summarise this Zynga MSA" (while on contract) | Ask rail | Inline answer + citations |
| "Compare §8 to our playbook" (on contract) | Ask rail (short) → opens Assistant w/ Diff artifact | Diff artifact |
| "Find every NDA expiring in 90 days" | Assistant | Table artifact |
| "Draft an SOW for Zynga Year-3" | Assistant | Doc artifact (editable) |
| "Write me a counter to §8.1" (on contract) | Ask rail → spawns Doc/Diff in Assistant | Diff artifact |
| "Send the Pacific MSA to John + Jane" | Assistant | Decision card (preview + Confirm) |
| "Add Acme as a counterparty" | Assistant | Form artifact |
| "Show Q1 cycle time by owner" | Assistant | Table or Card |
| "Export executed contracts as CSV" | Assistant | File card |
| "What's the cap on this contract?" (on contract) | Ask rail | Inline answer |
| "Rewrite this paragraph in plain English" (text selected) | Bubble ✨ | Inline replacement |
| "Run compliance sweep" (skill) | Either, via @-mention | Table artifact |
| "Show me the contract I asked about three weeks ago" | Assistant threads list with `by resource ▾` filter | Thread restored |

**Coverage check:** 14 / 14 mapped. No JTBD left without a home.

---

## 4 · The 8-button explosion → 2 doors + 1 bubble + 1 hotkey

Today's contract page has **8 distinct AI controls**, **3 verbal labels**, **5 different destinations**. Final state has **3 surfaces, 2 verbal labels, 3 destinations**.

### Today's surfaces (deleted in this release)

| # | Surface | Today's label | Today's destination | Status |
|---|---|---|---|---|
| 1 | Sidebar nav | "AI Assistant" | `/agent` | **Renamed** to "Assistant" |
| 2 | Header pill (top right) | "AI Assistant" | Toggles right rail | **Deleted** — rail toggles itself |
| 3 | Rail header label | "AI Assistant" | (label only) | **Renamed** to "Ask" |
| 4 | Contract toolbar button | "✨ Ask AI ⌘K" | Opens Cmd-K modal | **Deleted** — ⌘K focuses rail |
| 5 | Actions menu item | "Ask AI" | Switches right tab | **Deleted** |
| 6 | "Ask" tab in tab bar | "Ask" | Per-contract chat tab | **Deleted** — rail does this |
| 7 | Bubble on text selection | "Ask AI" | Inline 4-action menu | **Renamed** to ✨ icon-only |
| 8 | Hero box on dashboard | "Ask AI" | Routes to rail composer | **Deleted** — rail is right next to it |
| 9 | Cmd-K palette modal | "Ask AI anything…" | Modal with curated actions | **Deleted** — actions move into rail's `/`-slash menu |

### Final surfaces

| # | Surface | Label | Destination |
|---|---|---|---|
| 1 | Sidebar nav | **"Assistant"** | `/agent` route |
| 2 | Right rail (always-on) | **"Ask"** | Inline chat companion |
| 3 | Bubble on selection | (icon only ✨) | Inline rewrite menu |

Plus one hotkey: **⌘K** opens or focuses the rail composer from anywhere.

---

## 5 · The Assistant (`/agent`) — what's new

### 5a · Layout (3 zones)

```
┌──────────┬─────────────────┬──────────────────────────────────────────┐
│ Sidebar  │ Threads (260)   │ Chat canvas                              │
│ (60—240) │                 │                                          │
│          │ + New           │ <thread title or empty>                  │
│          │                 │                                          │
│          │ TODAY           │ <messages stream here>                   │
│          │ • Compliance…   │                                          │
│          │                 │                                          │
│          │ YESTERDAY       │ <when artifact opens, this column        │
│          │ • Renewals…     │  shrinks to ~50% and the artifact pane   │
│          │                 │  takes the rest →>                       │
│          │ FILTERS         │                                          │
│          │ ⓒ by resource ▾ │ ┌─────────────────────────────────────┐  │
│          │ ⓢ by skill ▾    │ │ Ask… · @ for skills · / for actions │  │
│          │                 │ └─────────────────────────────────────┘  │
└──────────┴─────────────────┴──────────────────────────────────────────┘
```

### 5b · With artifact open

```
┌──────────┬───────────────┬──────────────┬──────────────────────────────┐
│ Sidebar  │ Threads (260) │ Chat (480)   │ Artifact (resizes to fill)   │
│          │               │              │                              │
│          │               │ Maya:        │ ●  Draft SOW — Zynga Y3      │
│          │               │ Draft SOW…   │                              │
│          │               │              │ 1. Statement of Work          │
│          │               │ ✨ Pulled 2  │   This SOW is entered into   │
│          │               │ priors +     │   pursuant to the MSA…       │
│          │               │ playbook     │                              │
│          │               │              │ 2. Services                   │
│          │               │ Drafted v1   │   …                           │
│          │               │ on the right │                              │
│          │               │              │ 3. Fees                       │
│          │               │ Want me to   │   USD 1,200,000 / yr         │
│          │               │ tighten      │                              │
│          │               │ §3?          │ ───────────────────────────  │
│          │               │              │ [Save as draft] [Send ▾]     │
│          │               │ ┌──────────┐ │ [Edit in Contracts page]    │
│          │               │ │ Ask…    │ │                              │
│          │               │ └──────────┘ │                              │
└──────────┴───────────────┴──────────────┴──────────────────────────────┘
```

### 5c · Five artifact types (covers ~95% of JTBDs)

| Type | Use case | Renderer |
|---|---|---|
| 📄 **Doc** | Draft / summary / advice memo | TipTap editable |
| 📊 **Table** | Queue / search / export | Sortable grid + row-click drill |
| ⚖ **Diff** | Redline / version compare | DiffViewer + Accept/Reject |
| 📝 **Form** | Create matter / counterparty / share-link | Pre-filled form + Save |
| 🎯 **Decision card** | Approve/reject/sign preview | Decision strip with Approve/Reject CTAs |

Every artifact has **action buttons** that hit real tools (Save → creates draft contract, Send → opens send-for-review flow, etc.). Not previews.

---

## 6 · The Ask rail — what's new

### 6a · Always shows context

```
┌──────────────────────────────────────────────┐
│ Ask                                       ⓧ │
│ Context: Zynga MSA · Approval state          │ ← always tells you what
│ 3 prior threads on this contract ▾           │   it's focused on
├──────────────────────────────────────────────┤
│                                              │
│ ✨ How can I help?                           │
│    I'm focused on this contract.             │
│                                              │
│ Try (curated for this contract):            │
│ • Summarise risks                            │
│ • Compare to playbook                        │
│ • Liability cap                              │
│ • Auto-renewal terms                         │
│ • Termination conditions                     │
│                                              │
│ ──── conversation ────                       │
│                                              │
│ You: what's the cap?                         │
│ ✨ Capped at 6 months of fees with a         │
│    carve-out for confidentiality. [§12.1]    │
│                                              │
│ → Want a redline? [Open in Assistant →]      │
│                                              │
│ ┌──────────────────────────────────────┐     │
│ │ Ask… · @ for skills · / for actions  │     │
│ └──────────────────────────────────────┘     │
└──────────────────────────────────────────────┘
```

### 6b · Rules

- Replies cap at ≈200 words. Anything longer → "Open in Assistant →" link.
- **Read-only**. Writes (draft / send / approve / sign) always punt to Assistant with a one-click handoff.
- Per-resource thread history exposed via the dropdown at top.
- `/`-slash menu in composer = same curated actions the Cmd-K modal used to host.
- @-mentions = skills (compliance sweep, draft NDA, etc.).
- ⌘K from anywhere focuses the composer.

### 6c · Collapsed state

Vertical 32px sliver on the right edge: `💬 Ask · ⌘K`. Click expands; the kbd hint teaches the shortcut.

---

## 7 · The Bubble ✨ — selection only

Unchanged in function; re-skinned to icon-only. No "Ask AI" wording. Hovers reveal a tooltip "Rewrite / Tighten / Lean our way / Check (⌘K for full chat)".

---

## 8 · Bugs we fix in the same release (no separate cleanup)

These are P0/P1 issues from the audit. Rolled into the same release because the redesign touches their code paths anyway.

| # | Severity | Issue | Where | Fix in this release |
|---|---|---|---|---|
| 1 | P0 | Original PDF view crashes "Invalid PDF structure" on text-only contracts | Contract detail | Disable toggle when `currentVersion.s3Key` null; show empty state |
| 2 | P0 | Maya's Approvals queue empty while dashboard says "1 pending" | Approvals + dashboard | Reconcile the count query — same source of truth |
| 3 | P0 | Click a starter prompt on `/agent` does nothing visible | Assistant home | Wire starter click → send → stream |
| 4 | P0 | Forgot password is a stub modal | Login | Either build SendGrid reset OR remove link |
| 5 | P1 | Send-for-Review silently flips state without modal | Contract detail | Open dialog: workflow + reviewers + message |
| 6 | P1 | 1024px responsive collapse on contract page (header wraps, rail overlaps user menu) | All routes with rail | Rail collapses to drawer at <1280px |
| 7 | P1 | Counterparty list shows test-script garbage rows | Counterparties | Filter `^[A-Z0-9]+-Verify-` from list + cleanup script |
| 8 | P2 | Settings page is mostly empty | Settings | Add Notifications + General tabs with real content |
| 9 | P2 | "Review Queue" vs "Approvals" naming confusion | Sidebar | Rename Review Queue → "Extraction Queue"; add tooltip |
| 10 | P2 | No badge counts on Approvals / Requests in sidebar | Sidebar | Show count chip when ≥1 |
| 11 | P2 | Inconsistent button verbs ("New X" vs "Add X") | Multi-page | Standardise on "New" everywhere |
| 12 | P2 | No keyboard shortcut for create flows | Global | `c` = create menu (matters Linear) |

---

## 9 · Per-screen sweep (specific UX nits)

Bundled into the same release because the redesign visits these files anyway.

### Login (A01–A05)
- Hero/wordmark — keep ✅
- "Sign in to *Demo Org, Inc.*" — only when org context known (post-invite). Keep generic otherwise.
- Password field placeholder dots → `placeholder="Your password"` (empty when unfocused)
- Forgot password — see #4 above

### Dashboard (B01–B03)
- HeroAgent box — **deleted** (rail does this)
- Hero chips — **moved** into rail's `/`-slash menu + starter chips
- "Your day" band stays — it's not an AI surface

### Sidebar (B05)
- "AI Assistant" → "Assistant"
- "Review Queue" → "Extraction Queue" + tooltip
- Section labels: TitleCase ("Core", "Legal", "Coming soon") instead of UPPERCASE
- Badge counts on Approvals / Requests when ≥1

### Header (B06)
- Delete "AI Assistant" pill
- Keep ⌘ search bar; show ⌘K hint inline
- User dropdown gets email + role + "Switch workspace" (when applicable)

### Contract detail (B11–B19)
- Toolbar drops "Ask AI" button (rail handles it)
- Actions menu drops "Ask AI" item (redundant)
- "Ask" tab — **deleted** from tabs (rail handles it; per-resource thread history in rail header)
- Send-for-Review opens dialog (#5 above)
- Original PDF disabled when no PDF (#1 above)
- Compare button — already-shipped fix from P7.4.15 ✓
- Tabs simplify to: Document · Clauses · Versions · Comments · Approval · Activity (no "Ask")

### Assistant (`/agent`) — full rebuild
- Empty state: persona-curated 4 starter cards (already exists ✓)
- Threads list: filter `by resource ▾` chip
- Chat canvas: artifact pane opens right
- Artifact renderers: 5 types (Doc / Table / Diff / Form / Card)
- Starter click streams (#3 above)

### Counterparties (B25, B10-nav-counterparties)
- Filter test-script rows from list (#7)
- Detail page already polished ✓

### Templates (B27)
- Card titles clickable ✓ (already shipped P7.4.11)
- Show full description on hover

### Approvals (B30, D02)
- Reconcile Maya's count (#2)

### Playbook (B31)
- Add tooltip on disabled "+ Add Position" explaining why
- Already mostly polished ✓

### Settings (B24)
- Add Notifications tab body (preferences)
- Add General tab body (org-level fields)
- Cross-link to Profile / Team / Admin Org

### Responsive (F02, F04, F05)
- Rail collapses to chip at <1280px
- Sidebar collapses to icons-only at <1024px
- Header layout fixes at all widths

---

## 10 · Risks deletion creates + the mitigations that ship in the same release

**Important — these aren't "next phase" items. They ship in the same PR.**

| Risk | What we ship to cover it |
|---|---|
| Discoverability when rail is collapsed | Persistent collapsed-rail chip on right edge with `💬 Ask · ⌘K` hint + first-visit coach mark |
| Cmd-K typeahead-filter loss | `/`-slash menu in rail composer, mirroring today's curated actions |
| Per-resource thread history loss (Ask-tab regression) | Rail header dropdown "N prior threads ▾" + Assistant threads list `by resource ▾` filter |
| First-time user finds the AI | First-visit coach mark on contract page pointing at rail; copy: *"I'm focused on this contract — ask anything or press ⌘K"* |
| Power-user keyboard flow | ⌘K hotkey + `/`-slash menu + thread filters all keyboard-navigable |

**No JTBD becomes unrecoverable. Verified in §3.**

---

## 11 · Build list (single-shot, no phasing)

One PR. One commit train. One release.

### 11a · Backend
1. **Single audit-source for "pending approvals"** — fix the count mismatch (one query, used by dashboard + queue) — *0.25d*
2. **Original-PDF guard** — return `hasOriginal: false` flag on contract detail when `currentVersion.s3Key` null — *0.25d*
3. **Forgot-password reset endpoint** + SendGrid wiring — *0.5d*
4. **Per-resource thread filter** — add `?resourceType=&resourceId=` to `/agent/threads` — *0.25d*
5. **Counterparty list filter** to drop test-script garbage rows + one-shot cleanup script — *0.25d*

### 11b · Web — delete
6. **Delete HeroAgent** + dashboard hero chips → migrate copy into rail starter chips — *0.25d*
7. **Delete header "AI Assistant" pill** → leave only ⌘ Search + ⌘K hint + bell + user — *0.25d*
8. **Delete contract toolbar "Ask AI" button** + Actions menu "Ask AI" item + "Ask" tab — *0.5d*
9. **Delete Cmd-K palette modal** + bind ⌘K to focus rail composer — *0.25d*
10. **Delete legacy ChatPanel** (V1 flag) — *0.25d*
11. **Rename sidebar "AI Assistant" → "Assistant"; rail "AI Assistant" → "Ask"** — *0.1d*

### 11c · Web — build
12. **Rail v3** — Context chip + per-resource thread dropdown + collapsed-state chip + first-visit coach mark + read-only behaviour with "Open in Assistant →" handoff — *2d*
13. **`/`-slash menu in rail composer** — replicate Cmd-K palette filter — *0.5d*
14. **Assistant `/agent` rebuild** — 3-zone layout (threads / chat / artifact) + threads `by resource ▾` filter + starter click → stream wiring (#3 fix) — *1.5d*
15. **Artifact pane** — 5 renderers (Doc / Table / Diff / Form / Card) + action wiring (Save → real tool, Send → real flow, etc.) — *3d*
16. **Send-for-Review dialog** — workflow + reviewers + message — *0.5d*
17. **Responsive: rail-as-drawer below 1280px; sidebar-icons below 1024px** — *1d*

### 11d · Web — polish
18. **Settings page** — Notifications + General tabs with real content — *0.5d*
19. **Sidebar polish** — TitleCase section labels + badge counts on Approvals/Requests + "Extraction Queue" rename — *0.25d*
20. **User-dropdown polish** — email + role + (later) workspace switch — *0.1d*
21. **Login polish** — placeholder fix + forgot-password real flow — *0.1d*
22. **Bubble ✨** — re-skin to icon-only, kill "Ask AI" wording — *0.1d*

### 11e · Verification
23. **Update walkthrough script** to cover the new flow end-to-end — *0.5d*
24. **JTBD coverage tests** — one Playwright test per row of §3 — *1d*
25. **Responsive tests** at 1024 / 1280 / 1680 for every page — *0.5d*

**Total: ~14 days.** One PR (split into commits but landing as a single release).

---

## 12 · Acceptance gates (the bar to merge)

Don't merge until every box is ticked:

- [ ] **Three AI surfaces only.** Grep `AI Assistant` returns ≤2 hits in src (sidebar nav + page title); grep `Ask AI` returns 0 hits.
- [ ] **JTBD coverage matrix (§3) green** — every row has a passing Playwright test.
- [ ] **Original-PDF empty state shows** when no PDF; toggle is disabled with a tooltip.
- [ ] **Maya's pending-approval count matches** between dashboard KPI and Approvals page.
- [ ] **Click a starter on `/agent`** → message sends + response streams + tool chips render (visible in screenshot).
- [ ] **Forgot password works** end-to-end (or the link is removed).
- [ ] **Send-for-Review opens a dialog** with workflow / reviewers / message — never a silent state flip.
- [ ] **At 1024×800**, contract page renders with no header wrap, no overlap, rail collapsed to chip.
- [ ] **Counterparty list has zero `*-Verify-*` rows.**
- [ ] **Coverage screenshots** in `scripts/screenshots/walkthrough-final/` (one per JTBD).

---

## 13 · What we're NOT doing in this release

(Listed so we don't scope-creep.)

- ❌ Multi-language support
- ❌ Mobile native app
- ❌ Real-time collaboration on artifacts (Yjs)
- ❌ Voice input
- ❌ Image generation artifacts
- ❌ Workspace switcher (org switching)
- ❌ Bulk-import wizard (CSV upload)
- ❌ E-signature X.509 + pdf-lib field injection (P7.6.1 left it as typed-name)
- ❌ Automated test-data cleanup cron (manual script in §11a item 5 is enough)

These are explicit non-goals. Anything else flagged during build that doesn't fit goes to a backlog file, not into this release.

---

## 14 · Locked product/UX decisions

I made every call. Reasoning is short on purpose — these are 2026 conventions, not opinions to debate.

### 14a · Iconography & color

**Decision 1 — Single sparkle ✨ everywhere AI is offered.**
> Notion, Linear, Framer, Vercel all chose one sparkle for the entire AI surface. The icon is the brand mark for "this is AI." Surface (full page vs rail vs popup) is what differentiates; identity stays consistent. Mixed icons would suggest separate features.

**Decision 2 — Both AI surfaces share an *indigo-violet* accent. Distinct from the product's blue.**
> Brand-blue is for app primaries (CTAs, links, focused inputs). AI gets its own hue (`indigo-500/600`) so users can tell at a glance: "this is the AI region." Same hue across rail + Assistant; Assistant uses the saturated tone, rail uses a softened tint, so they feel like the same feature in different sizes.
> Color tokens to lock during build:
> - `--ai-accent: indigo-500` (`#6366f1`)
> - `--ai-accent-soft: indigo-50` (`#eef2ff`)
> - `--ai-accent-ink: indigo-700` (`#4338ca`)

### 14b · Rail visibility

**Decision 3 — Rail visible on every route except `/agent`.** That includes `/dashboard`.
> The user explicitly asked for "contextual right rail on the app." Hiding it on dashboard would break that promise. On dashboard the rail's context is "your work today" with prompts about queues + renewals. On detail pages it auto-pins to the resource. Same component, smart context.

**Decision 4 — Rail suppressed on `/agent`.** (Already shipped P7.3, locked.)
> Two chat surfaces side-by-side is the original problem. `/agent` IS the chat. The rail's collapse-to-chip behaviour can serve the "I want a quick answer while I'm in Assistant" need (a smaller chip can pop up briefly), but the rail does NOT mount alongside the studio.

### 14c · URL & home routing

**Decision 5 — Chat lives at `/agent`. `/` redirects to `/dashboard` (unchanged).**
> Lawyers don't open a CLM to chat — they open it to find / sign / approve. Operational dashboard remains the right home. Genspark + Claude.ai chose `/` because their users come to chat; CLM users come to **act on contracts**. Move chat to `/` only if a future telemetry pass shows dashboard usage <10% — until then, `/agent` is one click away from the sidebar (and ⌘K from anywhere).

### 14d · Other decisions a UX designer must make (and I made)

**Decision 6 — Single global ⌘K behaviour.**
> ⌘K from any route does ONE thing: focus the rail composer. If rail is collapsed, expand it first. No modals, no palettes, no second hotkey.

**Decision 7 — Rail width: 380px expanded, 32px collapsed.**
> Linear/Notion converged on ~360–400px for chat rails. 380 fits ⌘K hint + chips + readable replies without dominating. Collapsed sliver is just enough for `💬 Ask · ⌘K` text rotated 90°.

**Decision 8 — Assistant 3-zone widths: 260 / 480 / fill.**
> Threads 260 (industry-standard sidebar), chat min 480 (readable line length ~70ch), artifact takes the rest. Chat shrinks to 480 once artifact opens; doesn't go below.

**Decision 9 — Artifact pane: invisible until used.**
> Don't show an empty "Artifacts will appear here…" pane on first visit. The chat takes the full canvas until an artifact is generated. After the first artifact, an artifact-strip pill below the chat (`📄 Draft SOW · 📊 Renewals table`) lets users re-open closed artifacts. Multiple artifacts persist for the thread.

**Decision 10 — Smart search bar in header doubles as chat entry.**
> If user types a question (>4 words OR ends with `?`), search results show "Ask Assistant: <query>" as the top result. Click → opens Assistant with the query pre-sent. Bridges search-to-chat without forcing users to learn a new entry point.

**Decision 11 — First-time discovery: ONE coach mark, ever.**
> First contract page visit: a one-time pulse on the rail with copy *"Focused on this contract — ask anything or press ⌘K."* Auto-dismiss after 5 seconds or first interaction. Never shown again. Multi-step onboarding tours are 2024-feel; one nudge is enough.

**Decision 12 — Errors are inline chips, never modals.**
> Stream failure / no-provider / cap-exceeded all render as a small inline banner in the chat with a retry button. No popups, no dialogs. The chat keeps moving.

**Decision 13 — Read/Write boundary in the rail.**
> Rail is read-only by default. Any write (draft / send / approve / sign) generates a "this needs the studio" handoff with a one-click "Open in Assistant →" link. Prevents the rail from becoming a power-tool that's hard to undo.

**Decision 14 — Keyboard model.**
> - ⌘K — focus rail composer (anywhere)
> - ⌘Enter — send message (in any composer)
> - Esc — close artifact pane (in `/agent`); collapse rail (elsewhere)
> - j/k — navigate threads list (in `/agent`)
> - / — open quick-action menu in composer
> - @ — open skill picker in composer

These are the same conventions Linear, Notion, GitHub use. No new keys to learn.

**Decision 15 — Empty states use "Ask" not "Try"**.
> Today: "Try: Summarise risks". Final: "Ask me to: Summarise risks". Subtle but it positions the AI as a partner ("ask me") instead of a tool ("try this"). 2026 conversational-UI convention.

### 14e · Naming, finalised

| Surface | Final name (visible to user) |
|---|---|
| Sidebar nav item | **Assistant** |
| Full-screen route | **Assistant** (page title) |
| Right rail header | **Ask** |
| Bubble (text-selection) | (icon only ✨, tooltip "Ask AI about selection") |
| Hotkey reference | **⌘K** |
| Skill picker | **@compliance-sweep**, **@draft-nda**, etc. |

The word "AI" appears in **zero** primary labels. It's marketing, not a feature name. (It survives in alt-text, ARIA labels, and admin docs.)

---

## 15 · References

- 54 audit screenshots: `scripts/screenshots/ux-deep/`
- 12 agent-surface catalog screenshots: `scripts/screenshots/agent-audit/`
- Capture script: `scripts/ux-deep-audit.mjs` (rerunnable)
- Companion catalog of all surfaces: previously in this doc, now consolidated into §4
