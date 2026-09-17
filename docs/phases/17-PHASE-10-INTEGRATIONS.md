# Phase 10 — Integrations, Mobile & Scale

**Goal**: Connect the platform to the outside world — CRM, ERP, Slack/Teams, email integrations. Build team management, bulk operations, and the guided setup wizard. This phase makes the platform enterprise-ready.

**Duration estimate**: 3–4 weeks  
**Depends on**: All previous phases

---

## What You Build

### Backend
- [ ] Database migrations: `integration_connections`
- [ ] Integration framework: connector abstraction, OAuth flow handler, field mapping engine, sync scheduler
- [ ] Salesforce connector: bidirectional sync (opportunities ↔ contracts, contacts ↔ counterparties)
- [ ] SAP/Oracle/NetSuite connector: contract terms → purchase orders, vendor records sync
- [ ] DocuSign connector enhancement: fully bidirectional (not just send — also pull existing envelopes)
- [ ] Slack connector: send/receive messages, approval requests via emoji, slash commands
- [ ] Teams connector: similar to Slack — messages, approvals, notifications
- [ ] Gmail/Outlook connector: email-to-request, calendar sync for deadlines, notification delivery
- [ ] Webhook framework: incoming/outgoing webhooks for custom integrations
- [ ] MCP server implementation: expose CLM as MCP server for external agent consumption
- [ ] Bulk import service: batch upload, parallel extraction, verification queue, progress tracking
- [ ] CRM-triggered requests: monitor CRM events → auto-create contract requests

### Agent Layer
- [ ] Integration Agent (full): bidirectional sync via MCP connectors, error handling, retry logic
- [ ] Slack bot: full conversational agent accessible via Slack — all CHAT flows work in Slack
- [ ] Bulk extraction pipeline: process 1000s of documents with parallel agent workers

### Frontend
- [ ] **SCR-037: Integration Config** — connector marketplace with "Connect" buttons, field mapping builder (drag fields between systems), sync rules, connection health, error logs, test mode
- [ ] **SCR-038: RBAC Manager** — role editor, permission matrix (role × action × contract type), user assignment, test-as-user mode
- [ ] **SCR-031: Team Workload** — team member cards, assignment counts, overdue indicators, drag-to-reassign, workload balance chart, OOO indicators
- [ ] **SCR-034: Deal Review Workspace** — shared cross-functional workspace (legal + sales + finance)
- [ ] **SCR-039: Alert Rules** — configure triggers, channels, escalation chains
- [ ] **SCR-040: AI Configuration** — agent autonomy boundaries, confidence thresholds
- [ ] **SCR-041: System Dashboard** — system health monitoring (agent performance, API health, queue depth)
- [ ] **SCR-042: Import Manager** — batch upload, extraction verification, bulk correction
- [ ] **SCR-043: Data Management** — export, backup, retention policy
- [ ] **SCR-044: Setup Wizard** — 10-step guided onboarding (org profile → integrations → upload contracts → workflows → templates → clauses → playbook → invite team → test run → go live)
- [ ] **SCR-045: Knowledge Hub** — process maps, template catalog, FAQ, guided walkthroughs, agent Q&A

### Acceptance Criteria

1. **Connect Salesforce** → OAuth flow → field mapping → bidirectional sync works
2. **CRM trigger** → opportunity hits "Contracting" stage in SFDC → auto-creates contract request with deal data
3. **Contract execution → CRM update** → when contract is signed → SFDC opportunity updated to "Closed Won"
4. **Slack bot** → message the bot "Draft an NDA for Acme" → full flow works in Slack channel
5. **Slack approval** → approval request sent in Slack → react ✅ to approve → system updates
6. **Email integration** → forward vendor contract to intake email → request created with extracted details
7. **Bulk import** → upload 500 legacy PDFs → extraction runs → verification dashboard shows accuracy → correct errors → confirm import
8. **Team workload** → see team assignments → drag contract from overloaded person to available person
9. **Setup wizard** → new org signs up → complete all 10 steps → system ready for use
10. **RBAC** → create custom "Junior Legal" role → limited permissions → verify access restrictions work
11. **Integration health** → see all connectors with health status → test connection → view error logs
12. **Alert rules** → configure "obligation overdue → escalate to legal director after 3 days" → verify escalation fires

---

## Feature IDs Covered

`CL-001`, `CL-004`, `CFG-006` through `CFG-010`, `AD-001` through `AD-005`, `INT-001` through `INT-008`, `CHAT-006` (Slack native)

## Screens Built

SCR-031, SCR-034, SCR-037, SCR-038, SCR-039, SCR-040, SCR-041, SCR-042, SCR-043, SCR-044, SCR-045
