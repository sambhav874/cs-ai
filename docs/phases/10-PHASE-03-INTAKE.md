# Phase 03 — Intake & Request Management

**Goal**: Build the front door — how contracts get requested, triaged, and assigned. Both via web form and via agent chat. This is where work enters the system.

**Status**: `[x] Done` — Completed 2026-03-19

**Duration estimate**: 1.5–2 weeks
**Depends on**: Phase 1, Phase 2

---

## What Was Built

### Backend
- [x] Database migrations: `contract_requests`, `counterparties`
- [x] Request Service: CRUD, status transitions, assignment
- [x] Auto-numbering: `REQ-2026-0001` sequence per org
- [x] `POST /api/v1/requests` — handles multipart (optional file attachment to S3) or JSON
- [x] `GET /api/v1/requests` — list with status filter + cursor pagination
- [x] `GET /api/v1/requests/:id` — detail
- [x] `PATCH /api/v1/requests/:id` — status transitions + assignment
- [x] `POST /api/v1/requests/:id/convert` — request → Contract (sets ACCEPTED); if attachments present, creates ContractVersion + queues parse-document (full pipeline)
- [x] ClassifyRequestJob type + queueClassifyRequest() in queue.ts
- [x] classify-request handler in agent.worker.ts — fetches request → POST /intake-classify → updates request.type if confidence ≥ 0.75, stores `_aiClassification` in metadata
- [x] Audit events: request.created, request.status_changed, request.assigned
- [x] `GET/POST/PATCH/DELETE /api/v1/counterparties` full CRUD

### Agent Layer
- [x] **Intake Classify Agent** — `POST /intake-classify` (Haiku, first 3K chars): returns `{ contractType, confidence, extractedTerms: { counterpartyName, value, jurisdiction, priority } }`
- [ ] Chat flow CHAT-001: "I need an NDA for Acme" → agent creates request *(deferred)*
- [ ] Email-to-request: IMAP listener *(deferred to Phase 10)*
- [ ] Routing intelligence: suggest assignee based on workload + expertise *(deferred)*

### Frontend
- [x] **RequestsPage** — status tabs (All / Submitted / In Review / Accepted / Rejected), table with type/priority/status badges, 5s polling while SUBMITTED, New Request button
- [x] **NewRequestModal** — 6 fields (title, type, counterparty, description, value, priority) + optional file attachment (FormData when file present, JSON otherwise)
- [x] **RequestDetailPanel** — slide-over: AI classification card with confidence bar + extracted terms, assignee dropdown from `/users`, action buttons (Accept/Need More Info/Reject), Accept → POST /convert → navigate to new contract
- [x] **CounterpartiesPage** — table + debounced search + add/delete modal
- [x] Sidebar: Requests + Counterparties nav items with routes

### API Endpoints (Built)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/requests` | List requests (status filter, cursor pagination) |
| POST | `/api/v1/requests` | Create request (JSON or multipart with file) |
| GET | `/api/v1/requests/:id` | Get detail |
| PATCH | `/api/v1/requests/:id` | Update (assign, status, priority) |
| POST | `/api/v1/requests/:id/convert` | Convert request → Contract; queues pipeline if attachment |
| GET/POST/PATCH/DELETE | `/api/v1/counterparties` | Full counterparty CRUD |

---

## Deferred Items (Phase 10)

- Email-to-request: IMAP listener (imapflow) → creates request from forwarded email
- Routing rules engine: JSON config → auto-assign to queue/person
- Chat flow: "I need an NDA for Acme" → agent creates request (CHAT-001)
- CRM trigger: Salesforce opportunity close → auto-create request

---

## Acceptance Criteria (Verified)

1. **Submit a request via form** → appears in queue with correct metadata ✅
2. **AI classification** → within 5s, request shows extracted type + confidence + terms ✅
3. **Assign a request** → assignee dropdown updated → they see it in their list ✅
4. **Request detail** → full info + AI card + action buttons ✅
5. **Accept → convert** → Contract created, user navigated to contract detail, pipeline begins ✅
6. **Attach document** → file uploaded to S3, stored in request.attachments ✅
7. **Accept with attachment** → contract created + parse-document queued → flows through full AI pipeline ✅
8. **Priority badges** → urgent requests visually highlighted ✅
