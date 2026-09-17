# Phase 06 — Approval Workflows

**Goal**: Build the approval engine — visual workflow builder, rule-based routing, approval UX (web + mobile + Slack), delegation, and escalation. Contracts can now move from "draft" through "approved."

**Duration estimate**: 2.5 weeks  
**Depends on**: Phase 4 (contracts exist to approve)

---

## What You Build

### Backend
- [ ] Database migrations: `workflow_definitions`, `workflow_nodes`, `workflow_edges`, `approval_instances`, `approval_steps`
- [ ] Workflow Engine: evaluate routing rules, create approval instances, advance through workflow, handle parallel/sequential/conditional paths
- [ ] Approval Service: create steps, process decisions (approve/reject/delegate), escalation timers
- [ ] Delegation service: auto-delegate when OOO, manual delegation
- [ ] Escalation service: configurable timeouts, auto-escalate to next level
- [ ] Auto-approval rules: contracts matching certain criteria (standard NDA, low value) skip human approval

### Agent Layer
- [ ] Approval Agent: generate executive summaries for approvers, provide approval recommendation with confidence score
- [ ] Chat flow CHAT-006: approval request via Slack with emoji reactions
- [ ] Proactive reminders: agent reminds overdue approvers via preferred channel

### Frontend
- [ ] **SCR-035: Workflow Builder** — drag-and-drop canvas, node toolbox (start, approval, condition, notification, escalation, timer, end), connector lines, condition editor, test mode, publish/versioning
- [ ] **SCR-013: Approval View** — contract summary card, AI recommendation, full document (expandable), approval history, action buttons (approve/reject/delegate/request changes)
- [ ] **SCR-014: Mobile Approval Card** — push-optimized summary, one-tap approve/reject, swipe gestures
- [ ] **SCR-013 (tracker tab)**: approval workflow status visualization — who approved, who's pending, who's overdue
- [ ] "Pending Approvals" in sidebar with count badge
- [ ] Approval notification banners within the app

### Acceptance Criteria

1. **Build a workflow** → drag approval nodes, set conditions ("if value > $100K → requires VP"), test with sample contract → publish
2. **Submit contract for approval** → workflow engine evaluates rules → routes to correct approvers
3. **Approve via web** → see summary + AI recommendation → click Approve with comments
4. **Approve via mobile** → push notification → summary card → one-tap approve
5. **Approve via Slack** → formatted message with summary → emoji reaction to approve
6. **Reject with comments** → requestor notified with rejection reason
7. **Delegation** → approver delegates to colleague → delegate receives request
8. **Auto-delegation** → set OOO → incoming approvals auto-routed to delegate
9. **Escalation** → approver doesn't respond in 48 hours → escalated to manager
10. **Auto-approval** → standard NDA under $0 value → auto-approved, logged in audit trail
11. **Parallel approval** → CFO and VP Legal both need to approve → both receive simultaneously → contract advances when both approve
12. **Conditional paths** → if risk score > 0.7, add Chief Legal Officer to approval chain

---

## Feature IDs Covered

`AP-001` through `AP-007`, `CFG-001`, `CFG-002`, `CHAT-006`

## Screens Built

SCR-013, SCR-014, SCR-035
