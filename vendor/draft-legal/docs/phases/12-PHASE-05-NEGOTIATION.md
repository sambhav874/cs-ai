# Phase 05 — Negotiation & Collaboration

**Goal**: Build the negotiation engine — redlining, version comparison, internal/external collaboration, and the external portal. This is where contracts go back and forth until agreement.

**Duration estimate**: 3 weeks  
**Depends on**: Phase 4 (Editor exists)

---

## What You Build

### Backend
- [ ] Version diff engine: compute differences between any two contract versions
- [ ] Comment Service: threaded comments anchored to specific clauses, internal/external visibility
- [ ] Real-time collaboration: WebSocket server for collaborative editing (OT/CRDT via TipTap/Yjs)
- [ ] External portal backend: guest access tokens, secure link generation, counterparty action processing
- [ ] Negotiation status tracker: track agreed vs open items across versions

### Agent Layer
- [ ] Redline Agent (full): compare counterparty changes to playbook, generate counter-proposals with rationale
- [ ] Playbook enforcement: real-time monitoring during editing, alerts on violations
- [ ] Negotiation summary generation: AI summary of current negotiation state
- [ ] Chat flow CHAT-005 (enhanced): process incoming vendor contract, generate counter-proposals

### Frontend
- [ ] **SCR-010: Redline View** — inline diff and side-by-side views, change navigation, per-change accept/reject/counter, risk badges, summary panel
- [ ] **SCR-012: Version History** — version list with diff between any two versions, restore capability
- [ ] **SCR-011: External Negotiation Portal** — branded guest page, document viewer, redline tools, commenting, no-account access
- [ ] **SCR-006 enhancements**: collaborative editing (multi-cursor, presence indicators), commenting panel (inline anchored comments, threading, @mentions, resolve)
- [ ] Negotiation status panel: agreed items vs open items tracker

### Acceptance Criteria

1. **Receive counterparty redlines** → upload new version → see visual diff
2. **Generate counter-proposals** → agent analyzes redlines vs playbook → suggests counter-language with rationale
3. **Accept/reject individual changes** → per-change action in redline view
4. **Send contract to external party** via portal → counterparty clicks link → views and redlines without account
5. **Collaborative editing** → two internal users edit simultaneously → see each other's cursors and changes
6. **Internal comments** → add comment on specific clause → team discusses in thread → counterparty cannot see
7. **Version comparison** → compare v2 vs v5 → visual diff with change summary
8. **Playbook enforcement** → edit a clause beyond acceptable threshold → real-time warning appears
9. **Negotiation summary** → agent generates status report: "5 items agreed, 3 open"
10. **External counterparty submits changes** → internal team notified, deviations mapped to playbook

---

## Feature IDs Covered

`NG-001` through `NG-008`, `CHAT-005` (enhanced)

## Screens Built

SCR-010, SCR-011, SCR-012, SCR-006 (enhanced with collaboration + comments)
