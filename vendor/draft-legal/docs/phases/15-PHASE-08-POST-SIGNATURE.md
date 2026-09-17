# Phase 08 — Post-Signature Management

**Goal**: Build the post-execution engine — obligation extraction and monitoring, renewal management, amendment workflows, and invoice reconciliation. This is where the platform delivers ongoing value after contracts are signed.

**Duration estimate**: 3 weeks  
**Depends on**: Phase 7 (executed contracts exist)

---

## What You Build

### Backend
- [ ] Database migrations: `obligations` (full table with recurrence, evidence, alerts)
- [ ] Obligation Service: CRUD, status transitions, completion tracking with evidence, compliance scoring
- [ ] Alert engine: configurable alerts per obligation (30/15/7/1 day before due), escalation chains
- [ ] Renewal detection: scan for approaching expiry/renewal dates, generate renewal recommendations
- [ ] Amendment workflow: create amendment linked to parent, abbreviated draft → review → approve → sign cycle
- [ ] Invoice reconciliation engine: compare invoice line items against contract pricing terms, flag variances

### Agent Layer
- [ ] Obligation Agent (full): extract obligations from executed contracts (NLP), create structured records, monitor 24/7, send proactive alerts, track completion
- [ ] Invoice Agent: match invoices to contract terms, flag overcharges, calculate financial impact
- [ ] Insight Agent (basic): generate renewal recommendations based on performance data and spend history
- [ ] Chat flow CHAT-004: proactive renewal alert with recommendation
- [ ] Chat flow CHAT-008: "Set up alerts for obligations due in 60 days"
- [ ] Chat flow CHAT-009: "Draft amendment to add SOW to Acme MSA"

### Frontend
- [ ] **SCR-020: Obligation Dashboard** — summary metric cards (total, overdue, due this week, compliance %), obligation table with traffic-light status, calendar view toggle, filter panel, detail side panel with completion action
- [ ] **SCR-022: Renewal Workspace** — per-renewal: contract summary, performance history, spend data, agent recommendation, action buttons (renew/renegotiate/terminate)
- [ ] **SCR-023: Invoice Reconciliation** — exception list with variance details, contract vs invoice comparison, approve/dispute actions, financial impact summary
- [ ] **SCR-024: Performance Dashboard** — supplier/contract performance scorecards, SLA compliance tracking, trend charts
- [ ] Contract Editor (amendment mode): amendment-specific UI that links to parent contract, shows only changed sections
- [ ] Obligation tab in contract detail (SCR-025) — obligations for this specific contract

### Acceptance Criteria

1. **Auto-extraction** → contract executed → agent extracts all obligations, milestones, payment dates → structured records created
2. **Obligation dashboard** → see all obligations across all contracts, traffic-light status, filter by supplier/date/type/owner
3. **Calendar view** → see obligations on a monthly calendar, drag to reschedule (with approval)
4. **Proactive alerts** → obligation due in 7 days → owner gets Slack/email notification from agent
5. **Mark complete** → upload evidence (deliverable, payment receipt) → mark obligation as complete
6. **Compliance scoring** → % of obligations completed on time per contract and per supplier
7. **Renewal alerts** → contract expiring in 60 days → agent sends proactive alert with renewal recommendation
8. **Renewal decision** → review performance data + agent recommendation → decide to renew/renegotiate/terminate
9. **Amendment creation** → from contract detail → "Create Amendment" → abbreviated lifecycle (draft → approve → sign)
10. **Invoice reconciliation** → upload invoice → agent compares to contract terms → flags $5K overcharge on line item 3
11. **Chat: set alerts** → "alert me about all obligations due in 60 days" → agent configures alert rules
12. **Chat: create amendment** → "add a new SOW to the Acme MSA" → agent drafts amendment linked to parent

---

## Feature IDs Covered

`PS-001` through `PS-010`, `CHAT-004`, `CHAT-008`, `CHAT-009`

## Screens Built

SCR-020, SCR-022, SCR-023, SCR-024, SCR-006 (amendment mode)
