# 04 — API Design

## Conventions

- **Base URL**: `/api/v1/`
- **Auth**: Bearer JWT in `Authorization` header. Internal HS256 JWT (Phase 01). Auth0/Clerk SSO/SAML planned for Phase 10 enterprise.
- **Multi-tenancy**: `org_id` extracted from JWT claims. All queries auto-scoped.
- **Format**: JSON request/response. `Content-Type: application/json`.
- **Pagination**: Cursor-based. `?cursor=xxx&limit=25`. Response includes `next_cursor`.
- **Filtering**: Query params. `?status=active&type=nda&counterparty_id=xxx`.
- **Sorting**: `?sort=created_at&order=desc`.
- **Errors**: RFC 7807 Problem Details. `{ type, title, status, detail, instance }`.
- **Versioning**: URL path (`/v1/`). Breaking changes get new version.
- **Rate limiting**: 1000 req/min per org (configurable). `X-RateLimit-*` headers.
- **Idempotency**: `Idempotency-Key` header for POST/PUT operations.

## Endpoint Catalog

### Contracts `/api/v1/contracts`

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| GET | `/contracts` | List contracts (filtered, paginated, sorted) | SR-001, SR-003 |
| POST | `/contracts` | Create contract (from template or blank) | DR-002 |
| GET | `/contracts/:id` | Get contract detail with metadata | SR-005 |
| PATCH | `/contracts/:id` | Update contract metadata | SR-005 |
| DELETE | `/contracts/:id` | Soft-delete contract | SR-005 |
| GET | `/contracts/:id/versions` | List all versions | NG-006 |
| POST | `/contracts/:id/versions` | Save new version (document upload) | DR-004, NG-005 |
| GET | `/contracts/:id/versions/:vid` | Get specific version | NG-006 |
| GET | `/contracts/:id/versions/:v1/diff/:v2` | Get diff between two versions | NG-002 |
| GET | `/contracts/:id/comments` | List comments | NG-003 |
| POST | `/contracts/:id/comments` | Add comment | NG-003 |
| PATCH | `/contracts/:id/comments/:cid` | Update/resolve comment | NG-003 |
| GET | `/contracts/:id/obligations` | List obligations for contract | PS-001 |
| GET | `/contracts/:id/timeline` | Get audit timeline | SR-006 |
| POST | `/contracts/:id/clone` | Clone contract | SR-005 |
| POST | `/contracts/:id/amend` | Create amendment (linked to parent) | PS-007 |

### Requests `/api/v1/requests`

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| GET | `/requests` | List requests (queue view) | IN-006 |
| POST | `/requests` | Create new request (from form or agent) | IN-002 |
| GET | `/requests/:id` | Get request detail | IN-007 |
| PATCH | `/requests/:id` | Update request (assign, priority, status) | IN-005 |
| POST | `/requests/:id/draft` | Start draft from request | DR-001 |

### Templates `/api/v1/templates`

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| GET | `/templates` | List templates | CFG-004 |
| POST | `/templates` | Create template | CFG-004 |
| GET | `/templates/:id` | Get template with sections | CFG-004 |
| PUT | `/templates/:id` | Update template | CFG-004 |
| POST | `/templates/:id/generate` | Generate contract from template + data | DR-002 |
| GET | `/templates/:id/preview` | Preview with sample data | CFG-004 |

### Clauses `/api/v1/clauses`

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| GET | `/clauses` | List clauses (with category filter) | CFG-005 |
| POST | `/clauses` | Create clause | CFG-005 |
| GET | `/clauses/:id` | Get clause detail | CFG-005 |
| PUT | `/clauses/:id` | Update clause (creates new version) | CFG-005 |
| GET | `/clause-categories` | Get category tree | CFG-005 |
| POST | `/clause-categories` | Create category | CFG-005 |

### Playbook `/api/v1/playbook`

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| GET | `/playbook/positions` | List all positions | CFG-003 |
| GET | `/playbook/positions/:id` | Get position detail | CFG-003 |
| PUT | `/playbook/positions/:id` | Update position | CFG-003 |
| POST | `/playbook/test` | Test playbook against sample clause | CFG-003 |

### Approvals `/api/v1/approvals`

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| GET | `/approvals/pending` | My pending approvals | AP-003 |
| GET | `/approvals/instances/:id` | Get approval instance detail | AP-006 |
| POST | `/approvals/instances/:id/steps/:sid/decide` | Approve/reject a step | AP-003 |
| POST | `/approvals/instances/:id/steps/:sid/delegate` | Delegate to another user | AP-007 |
| POST | `/contracts/:id/submit-for-approval` | Initiate approval workflow | AP-001 |

### Workflows `/api/v1/workflows`

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| GET | `/workflows` | List workflow definitions | CFG-001 |
| POST | `/workflows` | Create workflow definition | CFG-002 |
| GET | `/workflows/:id` | Get workflow with nodes and edges | CFG-002 |
| PUT | `/workflows/:id` | Update workflow | CFG-002 |
| POST | `/workflows/:id/test` | Simulate workflow with sample data | CFG-002 |

### Obligations `/api/v1/obligations`

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| GET | `/obligations` | List obligations (filtered) | PS-002 |
| GET | `/obligations/:id` | Get obligation detail | PS-002 |
| PATCH | `/obligations/:id` | Update obligation (status, owner) | PS-004 |
| POST | `/obligations/:id/complete` | Mark complete with evidence | PS-004 |

### Signatures `/api/v1/signatures`

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| POST | `/contracts/:id/send-for-signature` | Initiate signing | EX-002 |
| GET | `/signatures/:id/status` | Get signing status | EX-004 |
| POST | `/signatures/:id/remind` | Send reminder to signers | EX-004 |
| POST | `/signatures/:id/void` | Void/cancel signing | EX-004 |

### Search `/api/v1/search`

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| POST | `/search` | Full-text + semantic search | SR-002, SR-003 |
| POST | `/search/portfolio-query` | Natural language portfolio query | SR-004 |

### Analytics `/api/v1/analytics`

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| GET | `/analytics/dashboard` | Dashboard metrics (configurable) | AN-001 |
| POST | `/analytics/query` | Custom analytics query | AN-002 |
| GET | `/analytics/reports` | List saved reports | AN-003 |
| POST | `/analytics/reports` | Create/save report | AN-003 |
| GET | `/analytics/kpis` | KPI metrics | AN-006 |

### Agent `/api/v1/agent`

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| POST | `/agent/chat` | Send message to agent (streaming SSE response) | All CHAT-* flows |
| GET | `/agent/chat/history` | Get conversation history | CHAT-* |
| POST | `/agent/extract` | Extract terms from uploaded document | DR-008 |
| POST | `/agent/compare` | Compare document against playbook | DR-009 |
| POST | `/agent/draft` | Generate contract draft | DR-002 |
| POST | `/agent/review` | AI review of contract | NG-001 |
| POST | `/agent/counter-propose` | Generate counter-proposals | NG-001 |

### Users & Org `/api/v1/users`, `/api/v1/org`

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| GET | `/users/me` | Current user profile + preferences | CFG-008 |
| PATCH | `/users/me/preferences` | Update preferences | CFG-008 |
| GET | `/users` | List org users (admin) | CFG-007 |
| GET | `/org/roles` | List roles | CFG-007 |
| POST | `/org/roles` | Create role | CFG-007 |
| PUT | `/org/roles/:id` | Update role permissions | CFG-007 |

### Integrations `/api/v1/integrations`

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| GET | `/integrations` | List configured integrations | CFG-006 |
| POST | `/integrations` | Connect new integration | CFG-006 |
| GET | `/integrations/:id` | Get integration detail + health | CFG-006 |
| PUT | `/integrations/:id` | Update configuration | CFG-006 |
| POST | `/integrations/:id/test` | Test connection | CFG-006 |
| GET | `/integrations/:id/logs` | Get sync/error logs | CFG-006 |

### Notifications `/api/v1/notifications`

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| GET | `/notifications` | List notifications for current user | CL-002 |
| PATCH | `/notifications/:id/read` | Mark as read | CL-002 |
| PATCH | `/notifications/read-all` | Mark all as read | CL-002 |
| GET | `/notifications/preferences` | Get notification preferences | CL-003 |
| PUT | `/notifications/preferences` | Update preferences | CL-003 |

---

## WebSocket Events

Connection: `wss://api.yourclm.com/ws?token=JWT`

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `editor.join` | `{ contract_id, version_id }` | Join collaborative editing session |
| `editor.change` | `{ operations }` | Send document changes (OT/CRDT ops) |
| `editor.cursor` | `{ position }` | Update cursor position |
| `presence.ping` | `{}` | Heartbeat |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `editor.remote_change` | `{ user_id, operations }` | Other user's changes |
| `editor.remote_cursor` | `{ user_id, position, color }` | Other user's cursor |
| `editor.users` | `[{ user_id, name, color }]` | Active collaborators |
| `notification` | `{ type, title, body, resource }` | Real-time notification |
| `agent.stream` | `{ token }` | Agent response token (streaming) |
| `agent.complete` | `{ message_id }` | Agent response complete |
| `contract.status_changed` | `{ contract_id, new_status }` | Contract status update |
| `approval.decision` | `{ approval_id, decision }` | Approval decision made |
