# Phase 02 — Contract Repository & Search

**Goal**: Build the contract storage backbone — upload contracts, store with metadata, search (full-text + semantic), view details with all tabs. This is the foundation everything else connects to.

**Duration estimate**: 2–3 weeks  
**Depends on**: Phase 1 (Foundation)

---

## What You Build

### Backend
- [ ] Database migrations: `counterparties`, `contracts`, `contract_versions`
- [ ] Contract Service: full CRUD for contracts and versions
- [ ] Counterparty Service: CRUD, CRM ID linking
- [ ] Document storage: S3 upload/download with presigned URLs
- [ ] Document text extraction: extract text from PDF/DOCX on upload (for search indexing)
- [ ] Full-text search: Elasticsearch indexing on contract create/update
- [ ] Semantic search: pgvector embeddings generated via agent on upload
- [ ] Versioning: create new version on every save, track changes summary (via agent)
- [ ] Tagging: add/remove tags on contracts
- [ ] Contract status state machine: enforce valid status transitions

### Agent Layer
- [ ] Search Agent: semantic search tool + full-text search tool
- [ ] Review Agent (basic): extract text from uploaded PDF/DOCX, generate summary
- [ ] Embedding generation: create vector embeddings for every contract version
- [ ] Chat flows: CHAT-002 (answer questions about contracts), CHAT-003 (find contracts by criteria)

### Frontend
- [ ] **SCR-025: Contract Repository** — table view with columns, filters, sort, search bar
- [ ] **SCR-025: Contract Detail** — tabbed view (Overview, Document, Versions, Activity)
  - Overview tab: metadata card, key terms, counterparty info, status badge, risk score
  - Document tab: embedded PDF/document viewer with in-document search
  - Versions tab: version list with timestamp, author, change summary
  - Activity tab: audit event timeline
- [ ] Upload contract: drag-drop zone or file picker, progress indicator
- [ ] Contract status badge component (color per status)
- [ ] Global search integration: search bar connects to search API
- [ ] Chat integration: agent can answer "find contract X" and link to repository

### API Endpoints

| Method | Path | Description | Feature ID |
|--------|------|-------------|------------|
| GET | `/api/v1/contracts` | List with filters | SR-001, SR-003 |
| POST | `/api/v1/contracts` | Create contract | — |
| GET | `/api/v1/contracts/:id` | Get detail | SR-005 |
| PATCH | `/api/v1/contracts/:id` | Update metadata | SR-005 |
| DELETE | `/api/v1/contracts/:id` | Soft delete | SR-005 |
| GET | `/api/v1/contracts/:id/versions` | List versions | NG-006 |
| POST | `/api/v1/contracts/:id/versions` | Upload new version | — |
| GET | `/api/v1/contracts/:id/timeline` | Audit timeline | SR-006 |
| POST | `/api/v1/search` | Full-text + semantic search | SR-002, SR-003 |
| POST | `/api/v1/search/portfolio-query` | NL portfolio query | SR-004 |
| GET/POST | `/api/v1/counterparties` | CRUD | — |

---

## Acceptance Criteria

1. **Upload a PDF contract** → text extracted, stored in S3, metadata indexed, embedding generated
2. **See it in the repository** → appears in table with correct metadata
3. **Click to view details** → all tabs show data (overview, document viewer, versions, activity)
4. **Search by keyword** → full-text search returns matching contracts with snippets
5. **Search by natural language** in chat → "find the Acme NDA from last year" → returns correct contract
6. **Ask a question** about a contract → "what's the termination clause?" → agent extracts and answers
7. **Portfolio query** → "how many active vendor contracts do we have?" → agent returns count with breakdown
8. **Upload multiple contracts** → all searchable, all with embeddings
9. **Version history** → upload updated version → see both versions, change summary generated
10. **Audit trail** → every action logged in activity tab

---

## Feature IDs Covered

`SR-001`, `SR-002`, `SR-003`, `SR-004`, `SR-005`, `SR-006`, `CHAT-002`, `CHAT-003`

## Screens Built

- SCR-025: Contract Repository (list view)
- SCR-025: Contract Detail (all tabs)
- SCR-026: Contract Timeline (within detail)
