# Contract Detail — Unified Canvas Wireframes

> Living design spec for the single contract detail screen.
> Author: 2026-04-23 • To be reviewed by ChatGPT + legal stakeholders.
> Supersedes: the split "detail page + Open in Editor modal" pattern.

---

## 0. Why this doc exists

Today the app has **two renderings of the same contract**:

| Surface | What it shows | Editable? | Style |
|---|---|---|---|
| Detail page | PDF viewer (`@react-pdf-viewer`) | No | Perfect (the actual PDF) |
| "Open in Editor" modal | TipTap rendering extracted HTML | Yes | Raw text, unstyled |

That split is wrong. Modern document apps (Notion, Linear, Figma, Google Docs, Ironclad, Juro) have **one canvas**. You land on it. You read. You click "Edit" — or just start typing — and edit happens in place. No second screen.

This doc defines the unified canvas: **one screen, two modes (View / Edit), intelligence always on the side, inline risk markers on the document itself.**

---

## 1. Personas & Jobs-to-be-Done

Cross-functional teams — 5 internal personas + 2 external.

| Persona | Primary JTBD on contract detail | Secondary JTBD |
|---|---|---|
| **Legal Counsel** | Review uploaded contract → fix risks → send back / submit for approval | Draft from template, redline, compare vs playbook, manage negotiation cycle |
| **Legal Ops** | Configure playbook, templates, workflows (different screen); audit risk exposure across portfolio | — |
| **Sales Rep** | "Where is my contract? What's the status? Who's it with?" | Track signature status; nudge counterparty; download signed PDF |
| **Procurement** | Review vendor contract → flag non-standard terms → route to legal | Track renewal terms; obligations |
| **Finance / Approver** | Decide: approve / reject / delegate. See $ value, risk, recommendation. | Track payment terms; renewal revenue impact |
| **Executive (Approver)** | 30-second read → approve / escalate | Delegate |
| **Counterparty (external)** | Read the contract we sent; redline if needed; sign when asked | Comment; upload counter-version |
| **Signer** (internal or external) | Sign the finished document | — |

**The detail screen serves the first five internal personas + the two external ones.** Legal Ops uses different screens (templates/playbook config) so is excluded from the canvas.

---

## 2. Three non-negotiable principles

Every state below obeys these:

1. **One canvas.** No separate editor. No modal hops. Same layout always. Only what's *inside* the main area changes.
2. **Intelligence is ambient.** AI runs continuously. Risks are marked *on the document itself* (inline underlines / margin markers). Details live in the rail. Nothing the user has to go find.
3. **Primary CTA always answers "what's next for me?"**. State-aware. Default for Legal drafting: `Send for Review`. Default for Approver: `Approve`. Default for Signer: `Sign`. One button. No choice paralysis.

---

## 3. Core states

Each state is the SAME layout — only the main area's content and the primary CTA change. The eight states below cover every JTBD.

### STATE 1 — View Mode (the default landing)

**When:** Every internal user lands here by default.
**Who:** Legal, Sales, Procurement, Finance.

```
┌─ CLM Platform ──────────────────────── 💬 Assist · 🔔 · Admin User ▾ ─┐
│                                                                          │
│  ← Contracts ▸ WPT Enterprises – Zynga License Agreement                │
│  ● Draft ▾ · LICENSE · ▓▓░ Risk 75% · ✎                                 │
│                                      [● Styled | Original]   [Risks: Summary ▾] │
│                                                                          │
│  ↪ You → Sent to Zynga · waiting 2d · Last: comment on §8.1 ✎          │
│                                    [✏ Edit] [Actions ▾] [Send for Review ▸]│
├─────────────────────────────────────────────────────┬──────────────────┤
│                                                     │ REVIEW PROGRESS   │
│  JOINT CONTENT LICENSE AGREEMENT                    │ ▓▓░░░░ 2 / 7      │
│                                                     │                  │
│  This JOINT CONTENT LICENSE AGREEMENT ("Agreement") │ ▾ OVERVIEW       │
│  dated February 1, 2018 …                           │   AI summary …   │
│                                                     │                  │
│  8.  LIMITATION OF LIABILITY                        │ ▾ KEY TERMS      │
│  ┌────────────────────────── ⚠ missing cap ────────┐│   Counterparty   │
│  │ 8.1 Neither party shall be liable…   (red line) ●││   Zynga Inc.     │
│  └──────────────────────────────────────────────────┘│   Value $12M     │
│                                                     │                  │
│  8.2 Liability cap is 5x fees ≈≈≈≈ (blue line) ◆   │ ▸ RISKS (3) ⚠    │
│      ↑ deviation from playbook (standard = 2x)      │ ▸ DEVIATIONS (2) │
│                                                     │ ▸ CLAUSES (24)   │
│  [signature block]                                  │ ▸ HISTORY        │
│                                                     │ ▸ COMMENTS       │
│                                                     │ ▸ ACTIVITY       │
├─────────────────────────────────────────────────────┴──────────────────┤
│  💬 Ask about this contract …                                   [⌘K]   │
└────────────────────────────────────────────────────────────────────────┘
```

**Callouts:**
1. **Breadcrumb** — no mystery about where you are.
2. **Status row** — status pill (click = lifecycle popover) + type + risk meter + edit-type pencil. One line.
3. **`[● Styled | Original]` segmented toggle** — switches the document view between TipTap (styled, editable in Edit mode) and the original PDF (exact fidelity, read-only). Persists per user. Edit mode auto-forces Styled. **This is critical for Legal trust — they default to Original PDF; Sales/Approvers default to Styled.**
4. **Risk-visibility toggle** — `[Risks: Off | Summary | Full ▾]`. Off = no markers. Summary = margin dots only. Full = inline underlines + margin dots. Role sets default; user override persists.
5. **Negotiation Status strip** — conditional (only shown when status ∈ {UNDER_NEGOTIATION, PENDING_APPROVAL}). Shows last action, who we're waiting on, for how long, what's next. Small pencil lets user post a reply. *Sales watches this.*
6. **`[✏ Edit]`** — default reads as "Edit" (you're viewing). One click → edit mode (State 2).
7. **`[Actions ▾]`** — renamed from the bare `⋯` kebab for clarity. Parallel actions (Share, Ask AI, Download .docx, View original PDF, Delete).
8. **Primary CTA** — state-aware. DRAFT → `Send for Review`; PENDING_REVIEW → `Nudge reviewer`; APPROVED → `Send for Signature`; EXECUTED → `Download signed PDF`.
9. **Review Progress bar** — top of rail. `▓▓░░░░ 2 / 7 reviewed`. Counter comes from per-clause `reviewState` field (Unreviewed / Reviewed / Resolved).
10. **Document as styled paper** — TipTap rendering with contract CSS: serif, 2.5cm margins, numbered sections, signature block. Read-only (editable=false).
11. **Inline risk underline (red)** — objectively bad clause per industry norms or playbook rules. Margin dot. Hover tooltip. Click → State 3.
12. **Inline deviation underline (blue)** — differs from our playbook but not necessarily bad (e.g. 5x cap vs standard 2x). Distinct from risk. Also clickable → State 3.
13. **Rail RISKS / DEVIATIONS** — separate sections with separate counts.
14. **Rail sections** — Review Progress + Overview + Key Terms default-open; everything else collapsed.
15. **Persistent Ask AI bar** — bottom. ⌘K triggers the command palette (State 8).

**JTBD covered:**
- Legal: read, spot risks, decide whether to engage.
- Sales: see status + AI summary + who's blocking (rail's APPROVAL section).
- Procurement: scan for non-standard terms (inline highlights).
- Finance: see value + risk at a glance (key terms + risk meter in rail + header).

---

### STATE 2 — Edit Mode

**When:** User clicks `[✏ Edit]` from State 1.
**Who:** Legal Counsel (primary), Legal Ops (occasional).

```
┌─ CLM Platform ──────────────────────── 💬 Assist · 🔔 · Admin User ▾ ─┐
│                                                                          │
│  ← Contracts  ▸  WPT Enterprises – Zynga License Agreement              │
│  ● Draft ▾  ·  LICENSE  ·  Risk 75%  ·  ✎       [✏ Editing ●] [↶ Undo] [Send for Review ▸]│
├─────────────────────────────────────────────────────┬──────────────────┤
│                                                     │ ▾ OVERVIEW       │
│  JOINT CONTENT LICENSE AGREEMENT                    │   AI re-analyzing│
│                                                     │   ● updating…    │
│  This JOINT CONTENT LICENSE AGREEMENT ("Agreement") │                  │
│  dated February 1, 2018 …                           │ ▾ KEY TERMS      │
│                                                     │                  │
│   ┌─ Bubble menu (on text selection) ─────────┐     │ ▸ RISKS (3) ⟳   │
│   │  B  I  U  ·  🔗  ·  H2  ·  ✨ AI          │     │   (recomputing)  │
│   └─────────────────────────────────────────────┘     │                  │
│                                                     │ ▸ CLAUSES (24)   │
│  8.1 Neither party shall be liable for any direct   │                  │
│      damages exceeding two times the fees paid      │                  │
│      under this Agreement in the preceding twelve   │                  │
│      months. |cursor                                │                  │
│                                                     │                  │
│  [/] → insert menu opens on empty line:             │                  │
│       · Heading      · List       · Table            │                  │
│       · Clause from library        · Variable       │                  │
│       · AI draft from prompt (⌘K)                   │                  │
│                                                     │                  │
│                                                     │ Saved ✓ 3s ago   │
├─────────────────────────────────────────────────────┴──────────────────┤
│  💬 Ask AI to …                                                 [⌘K]   │
└────────────────────────────────────────────────────────────────────────┘
```

**What changes vs State 1:**
- `[✏ Editing ●]` — red dot indicates live typing state. Click or Esc → back to View.
- `[↶ Undo]` + `[↷ Redo]` appear next to Edit toggle. Don't clutter View mode.
- **Bubble menu** appears on text selection — 6 controls max (B, I, U, Link, Heading, ✨ AI).
- **Slash `/`** on empty line opens an insert menu.
- Rail's OVERVIEW / RISKS / CLAUSES show "recomputing…" indicators while background AI reruns.
- Risk underlines update live as user edits — clauses that no longer have the flagged problem lose the underline.
- Save indicator bottom-right ("Saved ✓ 3s ago" or "Saving…").

**Crucially: no new screen, no modal.** Same layout. Same chrome (plus undo/redo). Same rail. Document is the same rendering — it just became editable.

**JTBD covered:**
- Legal: redline a clause.
- Legal: accept or reject a counterparty's proposed change.
- Legal: draft new clauses from library or AI prompt.
- Legal: fix typos, names, dates, values quickly.

---

### STATE 3 — Focused Review Drawer

**When:** User clicks an inline risk underline OR a risk item in the rail.
**Who:** Legal Counsel (guided review), Approver (understanding a risk).

```
┌─ CLM Platform ──────────────────────── 💬 Assist · 🔔 · Admin User ▾ ─┐
│                                                                          │
│  ← Contracts  ▸  WPT – Zynga License Agreement                          │
│  ● Draft  ·  LICENSE  ·  Risk 75%             [✏ Edit] [⋯] [Send ▸]    │
├─────────────────────────────────────────────────────┬──────────────────┤
│                                                     │ ◀ Prev │ 1/3 │ Next ▶│
│  (doc scrolls to the clicked clause, which is       │──────────────────│
│  highlighted + shown with diff markers)             │ ⚠ HIGH RISK       │
│                                                     │ Limitation of    │
│  8.1 Neither party shall be liable to the other for │ Liability        │
│      any indirect, incidental, special,             │ Missing liability│
│      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━       │ cap              │
│      consequential, or punitive damages arising     │                  │
│      out of or relating to this Agreement.          │ WHY THIS IS A    │
│      [strikethrough = what AI proposes to remove]   │ RISK             │
│                                                     │ Clause has no cap│
│  ✚ Neither party shall be liable for any direct    │ on direct dmgs.  │
│    damages in excess of the total fees paid by     │ WPT could face   │
│    WPT to Zynga in the twelve (12) months before   │ unlimited        │
│    the claim.                                       │ liability.       │
│    [green highlight = what AI proposes to add]      │                  │
│                                                     │ ◆ PLAYBOOK GAP   │
│                                                     │ Your standard:   │
│                                                     │  2x fees cap     │
│                                                     │ This contract:   │
│                                                     │  No cap          │
│                                                     │ Deviation: HIGH  │
│                                                     │                  │
│                                                     │ AI SUGGESTION    │
│                                                     │ ┌──────────────┐ │
│                                                     │ │ Neither party │ │
│                                                     │ │ shall be…     │ │
│                                                     │ └──────────────┘ │
│                                                     │                  │
│                                                     │ PLAYBOOK         │
│                                                     │ WPT Standard     │
│                                                     │ "Most favored    │
│                                                     │  customer (cap)" │
│                                                     │                  │
│                                                     │ State: Unreviewed▾│
│                                                     │ [✓ Accept]       │
│                                                     │ [✎ Edit manually]│
│                                                     │ [✗ Reject]       │
│                                                     │ [○ Mark reviewed]│
│                                                     │                  │
│                                                     │ ──────────────── │
│                                                     │ 💬 Comments (0)  │
│                                                     │ + Add comment    │
├─────────────────────────────────────────────────────┴──────────────────┤
│  💬 Ask AI …                                            [Esc] closes   │
└────────────────────────────────────────────────────────────────────────┘
```

**Key additions in this revision:**

- **`State:` picker** per risk: `Unreviewed · Reviewed · Resolved`. Distinct from Accept/Reject. Drives the Review Progress counter (top of State 1's rail).
- **`◆ PLAYBOOK GAP`** section — only appears when the issue is a *deviation* (blue underline in State 1), not a core risk. Shows *your standard · this contract · deviation severity*.
- **`[○ Mark reviewed]`** — lets the user say "I looked, current text is fine, no action needed." Advances progress counter without touching content. Replaces the implicit "do nothing and move on" flow which leaves the counter stuck.

**Critical design choice:** the drawer **replaces the normal right rail** — it is *not* a modal, *not* a third panel. Same layout, rail content changes. Esc returns to the regular rail.

**Callouts:**
1. Document scrolls to and highlights the clicked clause (diff markers visible).
2. Prev/Next navigates through all issues in severity order.
3. `Why this is a risk` — plain-English explanation.
4. `AI suggestion` — proposed replacement text.
5. `Playbook` reference — shows which org-playbook rule this maps to.
6. Actions: `Accept` (apply suggestion, continue), `Edit manually` (enter Edit Mode at that clause), `Reject` (dismiss, note reason).
7. Clause-scoped comments inline.

**JTBD covered:**
- Legal: fix one risk at a time with AI guidance (the 80% flow).
- Legal: accept/reject bulk with one click + Next.
- Approver (in State 4): understand a specific flag before deciding.

---

### STATE 4 — Approver Mode

**When:** Approver clicks a contract from their approval queue.
**Who:** Finance, Executive, any user in `APPROVER` role.

```
┌─ CLM Platform ──────────────────────── 🔔 (1 to approve) · Finance User ▾┐
│                                                                           │
│  ← Approvals  ▸  WPT – Zynga License Agreement                           │
│  ● Pending your approval  ·  Risk 75%   [✓ Approve] [✗ Reject] [Delegate ▾]│
├───────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  DECISION STRIP                                                            │
│  AI Confidence: Medium   ·   Risk: HIGH   ·   Recommend: Approve w/ changes│
│  Top blocker: §8.1 Missing liability cap   [jump to clause →]              │
│                                                                            │
├───────────────────────────────────────────────────────────────────────────┤
│  ⏱ Submitted by Admin User 2d ago — your deadline in 1d                   │
├──────────────────────────────────────────────────┬────────────────────────┤
│                                                  │ PRECEDENTS             │
│  (contract, read-only — approvers don't edit)   │ ✓ Similar approved     │
│                                                  │   Stripe MSA · $8M     │
│  Risky clauses are amber-highlighted inline —    │   Jan 2025             │
│  hovering shows the flag.                        │ ✓ Similar approved     │
│                                                  │   Shopify · $15M       │
│  [document content — can be scrolled, read,      │   Nov 2024             │
│   and commented on]                              │ ⚠ 20% higher risk than │
│                                                  │   peer average          │
│                                                  │                        │
│                                                  │ 🔵 AI RECOMMENDS       │
│                                                  │ Approve with caution   │
│                                                  │                        │
│                                                  │ WHY (3 concerns)       │
│                                                  │ • Liability uncapped   │
│                                                  │ • Auto-renew 12 mo     │
│                                                  │ • Broad indemnity      │
│                                                  │                        │
│                                                  │ KEY TERMS              │
│                                                  │ Counterparty  Zynga    │
│                                                  │ Value         $12M     │
│                                                  │ Term           3 yrs   │
│                                                  │                        │
│                                                  │ ▸ Full risk report     │
│                                                  │ ▸ All clauses (24)     │
│                                                  │ ▸ History              │
├──────────────────────────────────────────────────┴────────────────────────┤
│  💬 Ask AI "should I approve this?"                                [⌘K]    │
└──────────────────────────────────────────────────────────────────────────┘
```

**What changes vs State 1:**
- No `Edit` button. Approvers don't edit; they approve / reject.
- Primary CTAs: `[✓ Approve]` (green filled) + `[✗ Reject]` + `[Delegate ▾]`.
- **`DECISION STRIP`** (NEW, top of page) — four pieces of info an approver needs before scrolling: AI Confidence · Risk Level · Recommendation · Top blocking clause with a `jump to →` link. Forces guided navigation instead of free-scroll. Approvers who don't read the whole contract still make the right call.
- **`PRECEDENTS`** (NEW, top of rail) — answers "have we signed something like this before?". Shows top 2–3 similar contracts + approval outcomes, plus a relative-risk indicator. Powered by contract-level embedding similarity search. This is the trust layer that turns AI recommendation into evidence-backed judgement.
- Rail reordered: PRECEDENTS → AI RECOMMENDS → WHY → KEY TERMS → ... (approver-first).
- Risky clauses amber-highlighted inline (not red) — soft, not alarming.

**JTBD covered:**
- Finance: understand, decide, done — in < 2 minutes.
- Executive: 30-second scan of Decision Strip + Precedents — no need to scroll the contract at all.
- Either: delegate to a colleague if not the right approver.

---

### STATE 5 — Signer View

**When:** A signer (internal or external) follows a signature request link.
**Who:** Any signer — not always a CLM user.

```
┌─ Please sign: WPT – Zynga License Agreement ────────────────────────────┐
│                                                                            │
│  Sent by Admin User · 2026-04-25 · Expires in 30 days                    │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  (contract content — read-only; signers can't edit)                       │
│                                                                            │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━       │
│                                                                            │
│  WPT Enterprises, Inc.          Zynga Inc.                               │
│  ┌─────────────────────────┐    ┌─────────────────────────┐            │
│  │ [Click here to sign]    │    │ /Christine Gardner/     │            │
│  │      ↑ your field       │    │ Christine Gardner       │            │
│  └─────────────────────────┘    │ CFO · signed 2026-04-22 │            │
│  By: _____________________      └─────────────────────────┘            │
│  s/ Victor A. Bozzo                                                       │
│                                                                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                         [SIGN THIS CONTRACT] (sticky)     │
└──────────────────────────────────────────────────────────────────────────┘
```

**Minimal chrome.** No sidebar, no rail, no AI. Just the document and a big `SIGN` button.

**JTBD covered:**
- Signer: sign with absolute minimum friction. One screen, one button.

---

### STATE 6 — Counterparty Portal (external, no account)

**When:** Counterparty opens our share link (no account required).
**Who:** External counterparty.

```
┌─ YourCounsel LLC shared this contract with you ────────────────────────┐
│                                                                           │
│  ✓ Verified sender: YourCounsel LLC                                       │
│  🔒 Secure link · expires in 7 days                                       │
│                                                                           │
│  Contract: WPT – Zynga License Agreement                                 │
│  You can read, comment, download, propose changes, or sign.             │
│                                                                           │
│  [📄 Download original PDF]   [📝 Download .docx to redline]              │
│  [↑ Upload revised version]                                               │
├────────────────────────────────────────────────────┬─────────────────────┤
│                                                    │ YOUR PROGRESS       │
│  (contract rendered normally)                      │ ✓ Viewed            │
│                                                    │ ☐ Comments added    │
│  Select any text → floating menu:                  │ ☐ Changes proposed  │
│    [💬 Comment]  [✏ Suggest change]                 │                     │
│                                                    │ ──────────────────  │
│  Proposed changes show with your name in margin    │ YOUR COMMENTS       │
│                                                    │ You: "Section 8.1   │
│                                                    │  needs a cap"       │
│                                                    │                     │
│                                                    │ [+ Add comment]     │
│                                                    │                     │
│                                                    │ ──────────────────  │
│                                                    │ [Send feedback to   │
│                                                    │  YourCounsel LLC]   │
├────────────────────────────────────────────────────┴─────────────────────┤
```

**Differences vs State 1:**
- No app nav (no left sidebar).
- No internal AI analysis visible (counterparty doesn't see OUR risk flags).
- No Edit toggle on our copy — counterparty can: comment, suggest changes inline (tracked separately), upload a counter-version, or download Word to redline.
- **Trust signals prominent at top** — Verified sender, lock icon, expiry. External users are paranoid about phishing; legitimacy must be obvious.
- **`[Download .docx to redline]`** — critical enterprise escape hatch. Large counterparty legal teams live in Word; forcing them into our portal means losing deals. Gotenberg already exports DOCX (existing `/export` route).
- **`[Upload revised version]`** — completes the round-trip. Their redlined .docx comes back into our system as a new version with attribution ("counterparty via portal").

**JTBD covered:**
- Counterparty: read, comment, counter-redline in the portal OR in Word, upload the result, eventually sign (State 5 flow).
- Counterparty: verify they're not being phished.

---

### STATE 7 — Tablet & Mobile Breakpoints

**When:** Any persona on a smaller screen.
**Who:** All.

| Width | Behavior |
|---|---|
| ≥1280px | Full desktop: document + 320px rail (State 1 as drawn). |
| 1024–1279px | Rail narrows to 280px. Everything else unchanged. |
| 768–1023px (tablet) | Rail collapses into a **right-edge slide-in drawer**. Pill trigger on the right margin labelled `[Details ▸]` with counts. Tap to open. Document full-width when closed. |
| 375–767px (mobile) | **Bottom sheet** pattern. Document fills viewport. A 64px peek at the bottom shows status pill + next CTA. Drag up reveals the full rail as a sheet. |

**JTBD covered:**
- Sales rep on phone between meetings: glance at status + owner + deadline.
- Legal on iPad on a flight: read + highlight + leave comments (no heavy editing on mobile).
- Signer on phone: sign from email link (State 5 is already thin).

---

### STATE 8 — ⌘K AI Command Palette

**When:** Any user presses ⌘K (or ✳ on the bottom bar), from any state.
**Who:** All.

```
                     ┌──────────────────────────────────────────────┐
                     │ 💬 Ask AI anything about this contract        │
                     │ ┌──────────────────────────────────────────┐ │
                     │ │ rewrite 8.1 with a 2x fees cap_          │ │
                     │ └──────────────────────────────────────────┘ │
                     │                                               │
                     │ SUGGESTIONS                                   │
                     │   ✨ Rewrite this clause more restrictively    │
                     │   🔍 Summarize top risks in plain English     │
                     │   ⚖  Compare to WPT Standard playbook         │
                     │   ❓ What is the notice period?               │
                     │   📊 Show obligations after execution         │
                     │                                               │
                     │ Enter to run · Esc to close                   │
                     └──────────────────────────────────────────────┘
```

**Single entry point replaces:**
- The current 5 AI pill-buttons in the editor toolbar (Rewrite / Simplify / Expand / Check Compliance / Suggest Alternative)
- The standalone "Ask AI" tab
- The floating bottom-bar AI input (which invokes the same thing)

**Behavior:**
- Reads / queries don't require confirmation ("what's the notice period?" → answer inline).
- Writes require plan-preview + Confirm before applying ("rewrite 8.1" → shows diff preview → [Apply / Edit / Cancel]).
- Keyboard navigable end-to-end.

**JTBD covered:**
- All personas, all actions. This is the universal AI interface. Modeled on Linear's ⌘K, Cursor's chat, Harvey's prompt UI.

---

### STATE 9 — Compare Versions (Negotiation / Redline Mode)

**When:** User opens Compare from the History section, or toggles `[Compare ▾]` in the header.
**Who:** Legal Counsel (primary), Finance / Exec (reviewing what counterparty changed).

**Why this is a first-class state, not a buried feature:** without it, Legal exports to Word for redlines and negotiation leaves our system. The whole "system of record for contract negotiation" thesis depends on this.

```
┌─ CLM Platform ──────────────────────── 💬 Assist · 🔔 · Admin User ▾ ─┐
│                                                                          │
│  ← Contracts  ▸  WPT – Zynga License Agreement                          │
│  ● Under Negotiation · LICENSE · Risk 75%             [Exit Compare]    │
│                                                                          │
│  COMPARE:  [v5 (current) ▾]  vs  [v3 (counterparty) ▾]                  │
│                                    ↑ dropdown also supports:            │
│                                      · Previous version                 │
│                                      · Approved baseline                │
│                                      · Any version                      │
├─────────────────────────────────────────────────────┬──────────────────┤
│                                                     │ CHANGES (14)     │
│  8.1 Neither party shall be liable for any         │                  │
│      ━━━━━━━━ direct ━━━━━━━━  indirect damages    │ ● §8.1 Liability │
│       [removed "direct"; added "indirect"]          │   Zynga · 2d ago │
│       Attribution: Zynga · 2d ago                   │   [Accept][Rjct] │
│       [Accept this change] [Reject]                 │                  │
│                                                     │ ● §12.3 Auto-    │
│  12.3 This Agreement shall automatically renew ✚    │   renewal        │
│       for successive one-year terms unless either   │   Legal · 4d ago │
│       party provides 90 days' prior written notice. │   Accepted ✓     │
│       [Zynga added this entire clause]              │                  │
│                                                     │ ● §3.2 Territory │
│       Attribution: Zynga · 2d ago                   │   Zynga · 2d ago │
│       [Accept this change] [Reject]                 │   [Accept][Rjct] │
│                                                     │                  │
│                                                     │ FILTER:          │
│                                                     │ [All | Theirs |  │
│                                                     │  Ours | Pending] │
├─────────────────────────────────────────────────────┴──────────────────┤
│  💬 Ask AI "summarize what changed"                             [⌘K]    │
└────────────────────────────────────────────────────────────────────────┘
```

**Callouts:**
1. **`COMPARE: v5 vs v3`** — two dropdowns at top. Each lists all versions + three logical baselines: Previous, Approved baseline (last approved), Counterparty's version.
2. **Inline diff** — red strike-through = removed, green highlight = added. Word Track Changes behaviour, embedded.
3. **Attribution per change** — "Zynga · 2d ago" / "Legal · 4d ago". Who made this change and when.
4. **Per-change Accept / Reject** in both the doc and the rail. Accepting writes to current version; rejecting flags the change as declined.
5. **Change list** in the rail — navigable, filterable, shows status (pending / accepted / rejected).
6. **Filter: All / Theirs / Ours / Pending** — legal typically wants "Theirs / Pending" to triage counterparty changes fast.
7. **Exit Compare** returns to State 1.

**JTBD covered:**
- Legal: triage counterparty's redlines in minutes, not hours.
- Legal: accept/reject changes one-by-one with attribution preserved.
- Finance / Exec: answer "what changed since I approved v2?"
- All: avoid exporting to Word for redlines — negotiation stays in our system.

---

## 4. Persona → State coverage matrix

Every JTBD we identified in §1 maps to at least one state. If a row is empty, we have a gap.

| JTBD | Legal | Sales | Procurement | Finance / Approver | Exec | Counterparty | Signer |
|---|---|---|---|---|---|---|---|
| Read the contract | 1 | 1 | 1 | 1 | 1 | 6 | 5 |
| Read the *exact original PDF* | 1 (Original toggle) | — | 1 (toggle) | 1 (toggle) | — | 6 (download) | 5 |
| See risks at a glance (inline) | 1 (Full) | — | 1 (Summary) | 1 (Summary) | 1 (Summary) | — | — |
| See deviations vs playbook | 1 (blue) / 3 | — | 1 (blue) | 1 (blue) | 1 (blue) | — | — |
| See AI summary + recommendation | 1 (rail) | 1 (rail) | 1 | **4** | **4** | — | — |
| See precedents ("similar signed before?") | — | — | — | **4** | **4** | — | — |
| See status + next owner + wait time | 1 (negotiation strip) | 1 (strip) | 1 | 1 | — | — | — |
| Track review progress (3 of 7 reviewed) | 1 (top of rail) | — | — | 1 (top of rail) | — | — | — |
| Edit a clause | **2** | — | — | — | — | — | — |
| Fix a specific risk with AI help | **3** | — | — | — | — | — | — |
| Mark reviewed without changing | **3** (State picker) | — | — | — | — | — | — |
| Compare vs playbook | 3 / ⌘K | — | — | 3 | — | — | — |
| Compare versions (full, with attribution) | **9** | — | 9 | 9 | — | 6 (counter-view) | — |
| Submit for approval | 1 (CTA) | — | — | — | — | — | — |
| Approve / reject / delegate | — | — | — | **4** | **4** | — | — |
| Comment on a clause | 1 / 2 / 3 | 1 | 1 | 4 | 4 | **6** | — |
| Send for signature | 1 (CTA when APPROVED) | — | — | — | — | — | — |
| Sign | — | — | — | — | — | 5 | **5** |
| Counter-redline in our portal | 2 (on received redline) | — | — | — | — | **6** | — |
| Counter-redline in Word (escape hatch) | — | — | — | — | — | **6** (download .docx) | — |
| Ask questions about the contract | **8** | **8** | **8** | **8** | **8** | — | — |
| See obligations after exec | — | — | — | 1 (rail section added post-sig) | — | — | — |
| Renewal alert | — | 1 (banner) | — | 1 (banner + rail) | — | — | — |
| Download signed PDF | 1 (Actions ▾) | 1 (Actions ▾) | 1 (Actions ▾) | — | — | 6 (CTA) | — |
| Verify sender legitimacy | — | — | — | — | — | **6** (trust signals) | 5 |
| Mobile quick-check | **7** | **7** | — | **7** | **7** | — | — |
| Parallel secondary actions (Share without leaving Review) | 1 (Actions ▾) | 1 | 1 | 1 | 1 | — | — |

**Coverage verification:** every JTBD is served by at least one state. **This matrix is the V1 acceptance test** — every row must light up in integration testing.

---

## 5. What this design KILLS (removes from the app)

Everything below either disappears or merges:

| Currently | After unified canvas |
|---|---|
| PDF viewer as the main surface | Replaced. `[Styled \| Original]` toggle lets users switch views; Styled (TipTap) is default. Original PDF is never more than one click away. |
| "Open in Editor" full-screen modal | Gone. State 2 = edit mode on the detail page. |
| Horizontal StatusStepper row | Gone (already killed in B.1.5a). |
| 8-tab row | Gone (already killed in B.1.5f). |
| 5 colored AI pill-buttons in editor toolbar | Merged into a single ⌘K entry point (State 8). |
| Separate "Approval" tab | Replaced by State 4 (Approver mode). |
| Separate "Versions" / "Attachments" / "Contract Family" tabs | Unified HISTORY rail section (already done in B.1.5e). |
| Separate "Activity" / "Comments" / "Ask AI" tabs | Rail sections + ⌘K (already done in B.1.5f). |
| Separate external-portal layout | State 6 uses the same layout with different chrome. |
| Separate signer portal layout | State 5 is a dedicated minimal layout (different from State 1) — deliberate, signers aren't app users. |
| `⋯` kebab label | Renamed to `[Actions ▾]` — clearer that it holds parallel actions, not hidden overflow. |
| Risk as single concept | Split into **Risk** (red, objectively bad) and **Deviation** (blue, non-standard vs playbook). Different visual treatment, different decision logic. |
| Buried diff in risk context only | Promoted to **State 9 — Compare Versions** as a first-class mode with attribution + Accept/Reject per change. |

**Net: every user goal lives on one page with nine overlay states. No routing maze.**

---

## 6. Decisions (formerly open questions — now resolved)

Original questions and how we decided after ChatGPT reviews:

| # | Question | Decision |
|---|----------|----------|
| 6.1 | PDF fidelity | **Ship a `[Styled \| Original]` top-level toggle (not buried in kebab).** TipTap is default for most users; Legal can switch to Original PDF and stick there. Persisted per user. |
| 6.2 | Edit toggle for non-editors | **Disabled-visible with tooltip** ("Ask your legal team to edit"). Hiding obscures the capability. |
| 6.3 | Inline risk marker default | **User-controlled `[Risks: Off \| Summary \| Full ▾]` toggle** (not just role-gated). Role sets default, user override sticks. |
| 6.4 | Focused-review UX | **Drawer for High, inline card for Medium/Low.** Power users can tab through drawer via Prev/Next. |
| 6.5 | AI re-run cadence | **Both** — debounced auto (5s after last keystroke) + explicit `[Re-analyze]` button in rail. |
| 6.6 | Counterparty portal V1 scope | **Ship full** — view + comment + download .docx + upload counter-version. Word escape hatch is non-negotiable for enterprise. |
| 6.7 | Signer portal chrome | **Strip** — signers aren't CLM users. |

### New decisions added after round 3:

| # | Question | Decision |
|---|----------|----------|
| 6.8 | Risk vs Deviation | Split into **two concepts with distinct visual treatment**. Red = risk (objectively bad); Blue = deviation (non-standard vs playbook). State 3 drawer shows `PLAYBOOK GAP` section for deviations. |
| 6.9 | Approver context depth | **Decision Strip at top + Precedents section in rail.** Forces guided navigation; approver doesn't have to scroll. |
| 6.10 | Negotiation visibility | **Conditional strip in State 1 header** when status is UNDER_NEGOTIATION or PENDING_APPROVAL. Shows last action, who's waiting, duration, next step. |
| 6.11 | Review progress tracking | **Per-clause `reviewState` field** (Unreviewed / Reviewed / Resolved) + progress counter at top of rail. Drives "2 of 7 reviewed" feedback. |
| 6.12 | Linear vs non-linear flows | **Primary CTA + `[Actions ▾]` menu** for parallel paths (Share, Download .docx, View original PDF, etc.). |

---

## 7. Deferred to V1.5+ (explicitly tracked)

These are real concerns but not V1 blockers. Documented here so they're not forgotten:

### 7.1 Side-by-side PDF comparison
The `[Styled | Original]` toggle (§6.1) is a *switch* between views. Some enterprise deals may ask for *simultaneous* side-by-side (both panes visible, synced scroll). Estimated ~1 week of dedicated UI work when it's needed.
**Trigger to build:** first enterprise customer who explicitly requests it during procurement.

### 7.2 Performance architecture for 50+ page contracts
Current plan ships TipTap as-is, relying on:
- BullMQ for background AI jobs (already built in Phase 2.2)
- Debounced re-render on edit
- Telemetry to catch regression

If metrics show `initial_render_ms > 2s` or `first_edit_latency_ms > 100ms` on contracts beyond 30 pages, we virtualize via clause-level rendering. ~2–3 days when needed.
**Trigger to build:** telemetry regression OR first 50+ page contract upload.

### 7.3 Concurrent-edit presence (soft lock)
Two lawyers editing the same contract → silent race condition. V1 ships a read-only "Legal Counsel is also viewing" banner (cheap). Full CRDT collaboration stays deferred to Phase 5.4 (Yjs/HocusPocus).
**Trigger to build (banner):** V1. **Trigger to build (Yjs):** multi-user orgs requesting it.

### 7.4 Save-failure / offline recovery
Debounced auto-save needs retry + local-buffer recovery for connection drops. V1 ships with `Saved ✓` / `Saving…` / `Retrying…` indicator + localStorage backup of the last N edits. Full offline-first is out of scope.
**Trigger to build:** V1 (basic); full offline when field users request.

### 7.5 Error-state wireframes
What does State 1 look like when analysis failed, or extraction produced garbage, or PDF render is stuck? Today we have `ANALYSIS_FAILED` status — needs explicit layout treatment. Add as part of B.5.1 acceptance criteria.
**Trigger to build:** V1 — cover in B.5.1 implementation.

### 7.6 Contract-level onboarding
First-time user opens their first contract → what guides them? Coach-mark overlay on first visit. ~half day.
**Trigger to build:** V1.

### 7.7 Accessibility audit
Full WCAG 2.1 AA pass. Keyboard nav through all State 1–9 interactions. Screen reader labels on every inline risk marker. ~half day of audit + fixes.
**Trigger to build:** V1 — non-negotiable for enterprise procurement.

### 7.8 Telemetry hooks
Which rail sections get opened most? Where does State 3 drop off? Without telemetry we're blind on adoption. ~quarter day to add `track()` calls at key points.
**Trigger to build:** V1.

### 7.9 Internationalization
Non-English contracts. Date/currency formats per locale. Not V1 but worth flagging so we don't hardcode `en-US` everywhere.
**Trigger to build:** first non-English-primary customer.

---

## 7. What this does NOT redesign

Staying out of scope for this doc:

- Global nav (left sidebar) — unchanged.
- Dashboard / Contracts list / Requests pages — unchanged.
- Admin / settings / templates / playbook / workflows pages — unchanged.
- Agent-first Home (Phase D) — unchanged; agent still uses the unified canvas as the render target for contract cards and state transitions.

---

## 8. Build order (preview, not commitment)

If the plan is approved, a reasonable build sequence:

1. **B.5.1 — Kill the PDF viewer on detail page, render TipTap in its place.** Add contract-paper CSS. Default editable=false. (~1 day)
2. **B.5.2 — Edit toggle** (`[✏ Edit]` in header). TipTap `editable(true/false)`. (~2 h)
3. **B.5.3 — Delete the "Open in Editor" modal** and all its state. (~1 h)
4. **B.5.4 — Inline risk underlines** from the existing `clauseFlags` / `riskFactors` data. TipTap decoration plugin. (~1 day)
5. **B.5.5 — Focused Review drawer** (State 3) — clicking a risk. (~1 day)
6. **B.5.6 — Bubble menu + slash commands** (State 2 polish). (~1 day)
7. **B.5.7 — ⌘K command palette** (State 8). (~1 day)
8. **B.5.8 — Approver mode** (State 4) — primary CTA reshape + rail reorder. (~0.5 day)
9. **B.5.9 — Signer view** (State 5) — new route. (~0.5 day)
10. **B.5.10 — Counterparty portal polish** (State 6) — existing portal, add commenting + counter-redline UI. (~1 day)
11. **B.5.11 — Responsive drawer/sheet** (State 7). (~0.5 day)

**Total ≈ 8 days** to ship the full vision. The first three (~1.5 days) land the unified canvas in its simplest form and unlock everything else.

---

## 9. How to review this doc

If you're ChatGPT or another reviewer, the three things I most want critiqued:

1. **Are the personas right?** Did we miss a persona whose JTBD doesn't fit any state?
2. **Does the coverage matrix in §4 have a gap?** — a cell that should have a state number but is blank.
3. **Are the trade-offs in §6 the *right* questions to debate?** Or is there a bigger one I missed?

Small-font questions welcome too (typography, specific spacings), but those are tunable during build. The big bet is the architecture in §2 and §5.
