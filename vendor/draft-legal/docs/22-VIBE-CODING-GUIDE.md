# Vibe Coding Guide — Building the CLM Platform

## The Reality Check

You have 22 architecture docs, 75+ features, 20+ screens, and 10 build phases. If you try to vibe-code this all at once, you'll get a pile of hallucinated spaghetti. The key is: **small sessions, tight scope, verify before moving on.**

Vibe coding works brilliantly for this project IF you treat the AI as a junior engineer who has perfect recall of syntax but zero context about your project unless you give it. Your spec docs ARE the context. Feed them in pieces, not all at once.

---

## Tool Setup

### Recommended Stack

| Tool | Purpose | Why This One |
|------|---------|-------------|
| **Claude Code (CLI)** | Primary coding agent | Reads your file system, edits files in place, runs commands, understands project structure. Best for backend/agent work. |
| **Cursor** | IDE with AI | Good for frontend work where you need to see the UI. Inline edits, cmd+K for quick changes. |
| **Claude.ai** | Architecture thinking | For when you need to think through a design decision before coding. Paste a spec section + ask "how should I implement this?" |
| **Docker Desktop** | Local infra | PostgreSQL, Redis, MinIO, Elasticsearch all running locally |
| **GitHub** | Version control | Commit after every working increment. Never vibe-code without version control. |

### Project Bootstrap (do this manually, once)

```bash
mkdir clm-platform
cd clm-platform
git init

# Create the monorepo structure
mkdir -p apps/web          # React frontend
mkdir -p apps/api          # Node.js backend
mkdir -p apps/agents       # Python agent service
mkdir -p packages/shared   # Shared types, constants
mkdir -p infra             # Docker Compose, Terraform
mkdir -p docs              # Drop ALL your spec docs here

# Copy your specs into the project
cp -r /path/to/clm-docs/* docs/

# Initialize Docker Compose
touch infra/docker-compose.yml

git add .
git commit -m "Initial project structure with architecture docs"
```

**Why copy specs into the project?** Because Claude Code and Cursor can read files in your project. When you say "read docs/architecture/03-DATA-MODEL.md and create the Prisma schema", the AI has the ACTUAL spec, not its imagination.

---

## The Golden Rule of Vibe Coding

> **One task per session. Verify it works. Commit. Then start the next task.**

A "session" is one conversation with Claude Code or one focused Cursor session. Each session should produce ONE working thing:
- One database migration that runs
- One API endpoint that returns data
- One React component that renders
- One agent that responds to a prompt

If a session tries to do 5 things, 3 of them will be broken and tangled together. You'll spend more time debugging than you saved.

---

## Phase-by-Phase Vibe Coding Playbook

### Phase 1: Foundation (Week 1-2)

This phase is 80% boilerplate — perfect for vibe coding. AI excels at scaffolding.

#### Session 1: Docker + Database

**What to prompt:**

```
Read docs/architecture/02-TECH-STACK.md (the Docker Compose section) and 
docs/architecture/03-DATA-MODEL.md.

Create:
1. infra/docker-compose.yml with PostgreSQL 16 (with pgvector), Redis 7, 
   MinIO (S3-compatible), and Elasticsearch 8
2. A basic health check script that verifies all services are up

Don't create the application services yet — just the infrastructure.
```

**Verify:** `docker compose up` — all services healthy. Connect to PostgreSQL with psql. Connect to Redis with redis-cli.

**Commit:** `git commit -m "infra: docker compose with pg, redis, minio, elasticsearch"`

#### Session 2: Backend Scaffold + First Migration

```
Read docs/architecture/02-TECH-STACK.md (backend architecture section) and 
docs/architecture/03-DATA-MODEL.md (organizations, users, roles, audit_events tables).

In apps/api, scaffold a Fastify + TypeScript project with Prisma ORM.
Create the Prisma schema for: organizations, users, roles, user_roles, 
audit_events. Include the RLS policies and the audit immutability trigger 
from docs/architecture/06-SECURITY-GOVERNANCE.md.

Include: health check endpoint, error handling middleware, CORS config.
Don't include auth yet — that's next session.
```

**Verify:** `npx prisma migrate dev` runs clean. `curl localhost:3000/api/v1/health` returns 200.

**Commit:** `git commit -m "api: scaffold with prisma, first migration, health endpoint"`

#### Session 3: Authentication

```
Read docs/architecture/06-SECURITY-GOVERNANCE.md (authentication section).

Add Auth0 integration to the API:
1. JWT validation middleware (verify tokens from Auth0)
2. Extract org_id and user_id from JWT claims
3. Set PostgreSQL session variables for RLS (app.current_org_id, app.current_user_id)
4. GET /api/v1/users/me endpoint that returns current user profile
5. Seed script that creates a test org and admin user

Use environment variables for Auth0 config. For local dev, 
create a mock JWT middleware that can be toggled via env var.
```

**Verify:** Call `/api/v1/users/me` with a valid JWT — get user data. Call without JWT — get 401.

#### Session 4: Frontend Shell

```
Read docs/architecture/07-UI-DESIGN-SYSTEM.md and 
docs/architecture/02-TECH-STACK.md (frontend section).

In apps/web, scaffold a React + TypeScript + Vite project with Tailwind CSS.
Create:
1. Design tokens as CSS variables (from the design system doc)
2. App shell layout: header with logo/search/notifications/user menu, 
   left sidebar with nav items, main content area
3. Auth integration: login redirect to Auth0, session management, 
   protected routes
4. Left nav items as listed in docs/phases/08-PHASE-01-FOUNDATION.md — 
   most nav items disabled/greyed out except Dashboard and Settings
5. A placeholder dashboard page that says "Welcome to CLM"

Use Radix UI primitives for dropdown menus, dialogs, etc.
```

**Verify:** Open browser → redirected to login → login → see app shell with sidebar → see dashboard.

#### Session 5: Chat Panel (Agent Hello World)

```
Read docs/architecture/05-AGENT-ARCHITECTURE.md (overview and orchestrator).

Create:
1. In apps/agents: a Python FastAPI service with a /chat endpoint that 
   accepts a message and streams a response using SSE
2. For now, the agent should just classify intent (greet, help, unknown) 
   and respond appropriately using Claude Haiku
3. In apps/api: a proxy endpoint POST /api/v1/agent/chat that forwards 
   to the Python service and streams the response back to the client
4. In apps/web: a collapsible chat panel on the right side of the app shell. 
   Input box at bottom, messages above, streaming text display with 
   typing indicator

Use Anthropic's Python SDK with streaming. Use SSE (Server-Sent Events) 
for the API-to-frontend streaming.
```

**Verify:** Open chat panel → type "Hello" → see streaming response from agent. Type "Help" → get a different response.

**Commit everything. Phase 1 done.**

---

### Phase 2: Repository & Search (Week 2-3)

Now you're building real features. The pattern shifts: read the spec, code the backend, code the frontend, wire them together, test with real data.

#### Session 6: Contract Data Model + CRUD API

```
Read docs/architecture/03-DATA-MODEL.md (counterparties, contracts, 
contract_versions tables) and docs/architecture/04-API-DESIGN.md 
(contracts endpoints).

Create:
1. Prisma migration for counterparties, contracts, contract_versions tables
2. Contract Service with: list (filtered, paginated), create, get by ID, 
   update, soft delete
3. Contract status state machine from docs/architecture/21-GAP-FILL.md 
   section 1 — enforce valid transitions
4. All REST endpoints from the API design doc for contracts
5. Event emission on create/update/delete (use the event bus pattern 
   from docs/architecture/20-WORKFLOW-EVENTS-ASYNC.md)
```

**Verify:** Create a contract via API → get it back → update status → verify transition rules enforce correctly.

#### Session 7: File Upload + Document Processing

```
Read docs/architecture/21-GAP-FILL.md section 7 (file processing pipeline).

Create:
1. S3 upload endpoint with validation (file size, MIME type)
2. Presigned URL generation for downloads
3. BullMQ job queue setup (from docs/architecture/20-WORKFLOW-EVENTS-ASYNC.md part 3)
4. Text extraction worker: extract text from PDF (using pdf-parse) and 
   DOCX (using mammoth.js)
5. On upload: store file → queue text extraction job → 
   on completion save text to contract_versions.document_content
```

**Verify:** Upload a real PDF contract → check S3 → check text extracted → check it's in the database.

#### Session 8: Search (Full-text + Semantic)

```
Read docs/architecture/21-GAP-FILL.md section 5 (search architecture).

Create:
1. Elasticsearch indexing: when contract text is extracted, index to ES
2. Semantic embedding: call Claude to generate embeddings, store in pgvector
3. Search endpoint: POST /api/v1/search that does hybrid search 
   (ES full-text + pgvector semantic) with Reciprocal Rank Fusion
4. Wire up the Search Agent to handle natural language queries in chat
```

#### Session 9: Repository UI

```
Read the SCR-025 screen spec from the CLM_Complete_Product_Specification.xlsx 
(I've pasted the relevant section below for you):

[Paste the SCR-025 spec from the Excel — every component, every action, 
every data field]

Build the Contract Repository page:
1. Table view with columns: name, type, counterparty, status, value, 
   dates, assignee, risk score
2. Filter sidebar: type, status, counterparty, date range, tags
3. Sort by any column
4. Search bar connected to the search API
5. Click row → navigate to contract detail page

Then build the Contract Detail page with tabs:
1. Overview: metadata card, key terms, status badge
2. Document: embedded PDF viewer (use react-pdf)
3. Versions: version list with timestamps and authors  
4. Activity: audit event timeline

Use React Query for data fetching. Use the table component pattern 
from the design system doc.
```

**This is the pattern for every phase: backend → processing → search/agent → UI → verify end-to-end.**

---

### Phases 3-10: The Rhythm

By Phase 3, you've established the pattern. Every phase follows the same rhythm:

```
1. READ the phase doc (e.g., docs/phases/10-PHASE-03-INTAKE.md)
2. BACKEND sessions:
   a. Database migrations
   b. Service layer + API endpoints
   c. Event emission + job queue integration
3. AGENT sessions:
   a. Agent implementation (with tools)
   b. Chat flow integration
4. FRONTEND sessions:
   a. Page components (one screen per session)
   b. Wire to API (React Query hooks)
   c. Wire to chat panel (agent interactions)
5. VERIFY against acceptance criteria (listed in every phase doc)
6. COMMIT
```

### Session Sizing Rules

| Task Type | Session Size | Time Estimate |
|-----------|-------------|---------------|
| Database migration | 1 session | 15-30 min |
| Service + 3-5 API endpoints | 1 session | 30-60 min |
| One agent implementation | 1 session | 30-60 min |
| One screen (simple: table + filters) | 1 session | 45-60 min |
| One screen (complex: editor, workflow builder) | 2-3 sessions | 2-3 hours |
| Integration (Salesforce, DocuSign) | 2 sessions | 2-3 hours |

---

## Prompting Patterns That Work

### Pattern 1: Spec-First (best for new features)

```
Read [spec file path]. 

Build [specific thing] following the spec exactly. 
Include: [list what you want].
Don't include: [list what to skip for now].
```

The "don't include" is critical. Without it, the AI builds everything and creates a mess. Constrain scope explicitly.

### Pattern 2: Extend-Existing (best for adding to working code)

```
Look at [existing file path]. 

Add [specific feature] to this existing code. 
Follow the same patterns already used in the file.
Don't change any existing functionality.
```

"Follow the same patterns" prevents the AI from rewriting your code in a different style. "Don't change existing functionality" prevents it from breaking what works.

### Pattern 3: Fix-and-Improve (best for debugging)

```
Run this command and show me the output: [command]

The error is: [paste error]

Fix this specific error. Don't refactor or improve anything else.
```

The biggest vibe coding mistake is letting the AI "improve" code while fixing a bug. It introduces new bugs. Always constrain to the specific fix.

### Pattern 4: Wire-Things-Together (best for integration)

```
Look at:
- apps/api/src/modules/contracts/router.ts (the API endpoint)
- apps/web/src/features/contracts/hooks/useContracts.ts (the React Query hook)
- apps/web/src/features/contracts/ContractList.tsx (the component)

The API endpoint returns data. The hook calls the API. 
The component should display the data.

Wire these together so the ContractList component shows real data 
from the API. Handle loading, error, and empty states.
```

### Pattern 5: Agent Prompt Engineering

```
Read docs/architecture/05-AGENT-ARCHITECTURE.md and 
docs/architecture/21-GAP-FILL.md section 3 (prompt management).

Create the system prompt for the [Draft Agent] following the template 
in the prompt management section. The agent should:
1. [Specific behavior 1]
2. [Specific behavior 2]
3. [Specific behavior 3]

Include 3 few-shot examples of ideal input/output pairs.
Test the prompt by calling it with this sample input: [paste sample].
```

---

## What to Verify Manually vs Trust the AI

### ALWAYS Verify Manually

- **Database migrations**: Run them. Check the schema. Bad migrations are painful to fix.
- **Auth and RBAC**: Test as different roles. AI often creates permissive code.
- **Status transitions**: Test every transition manually. State machines have edge cases.
- **File upload/download**: Upload a real PDF. Download it. Open it. Is it corrupt?
- **Agent responses**: Read the actual agent output. Is it accurate? Is it hallucinating?
- **External portal**: Open the portal link in an incognito browser. Does it work without login?
- **Mobile responsiveness**: Open on actual phone or device emulator. Not just narrow browser.

### Generally Trust the AI (but spot-check)

- CRUD endpoint boilerplate
- React component rendering
- CSS/Tailwind styling
- TypeScript types and interfaces
- Database query building
- Docker configuration
- Test file structure

### NEVER Trust the AI

- Security-sensitive code (auth, encryption, token generation) — always review
- Financial calculations (invoice reconciliation) — always verify with test data
- LLM prompts — always test with real inputs before deploying
- Data deletion logic — always review the WHERE clause

---

## Common Vibe Coding Pitfalls (and How to Avoid Them)

### 1. "Let me build the whole thing" syndrome

**Problem**: You prompt "build the entire contract editor with collaboration and AI assist and clause library and track changes." The AI generates 2000 lines of broken code.

**Fix**: Break it into 5 sessions. Session 1: basic TipTap editor that renders text. Session 2: add formatting toolbar. Session 3: add clause library panel. Session 4: add collaboration. Session 5: add AI assist. Each session verifies before proceeding.

### 2. Context window overflow

**Problem**: You paste 3 entire spec docs into one prompt. The AI forgets the first doc by the time it reads the third.

**Fix**: Paste only the relevant section. "Here's the database schema for the contracts table [paste 30 lines]. Create the Prisma model for this." Not "Here's my entire data model document [paste 500 lines]."

### 3. The "it worked in the prompt" trap

**Problem**: AI generates code that looks correct but hasn't been run. You commit without testing. Later, 5 things are broken.

**Fix**: After every AI coding session, run the code. Run the tests. Hit the endpoint. Load the page. Never commit code you haven't executed.

### 4. Losing track of what works

**Problem**: You vibe-code for 4 hours without committing. Something breaks. You don't know what change caused it.

**Fix**: Commit after every working increment. Even tiny ones. "api: add contract create endpoint" is a valid commit. If something breaks later, `git bisect` finds it.

### 5. Different AI sessions create inconsistent patterns

**Problem**: Session 3 uses one pattern for API error handling. Session 7 uses a different one. Now you have two patterns and neither is documented.

**Fix**: In your first backend session, establish patterns explicitly. Then in every subsequent session, start with "Follow the patterns established in [file]." When the AI sees real code, it matches the style.

---

## Estimated Timeline

| Phase | Vibe-Code Sessions | Calendar Time | Notes |
|-------|-------------------|---------------|-------|
| 1. Foundation | 5-7 sessions | 3-5 days | Lots of boilerplate, AI excels |
| 2. Repository | 4-5 sessions | 3-4 days | First real feature, establishes patterns |
| 3. Intake | 3-4 sessions | 2-3 days | Simpler, builds on established patterns |
| 4. Drafting | 8-12 sessions | 7-10 days | Most complex phase (editor is hard) |
| 5. Negotiation | 6-8 sessions | 5-7 days | Collaboration is tricky |
| 6. Approval | 5-7 sessions | 4-5 days | Workflow builder needs careful work |
| 7. Execution | 3-4 sessions | 2-3 days | Mostly integration with DocuSign |
| 8. Post-Signature | 5-7 sessions | 4-5 days | Multiple sub-features |
| 9. Analytics | 4-6 sessions | 3-5 days | Dashboard + report builder |
| 10. Integrations | 6-8 sessions | 5-7 days | Per-integration work |
| **Total** | **~50-70 sessions** | **~6-8 weeks** | Solo developer, full-time |

With a team of 2-3 developers working in parallel (backend + frontend + agents), this compresses to about 3-4 weeks for an MVP (Phases 1-7) and 5-6 weeks for the full platform.

---

## Your Immediate Next Steps (this week)

### Day 1: Setup
- [ ] Create the monorepo structure (manually, 10 min)
- [ ] Copy all spec docs into `docs/` folder
- [ ] Set up Docker Compose (Session 1)
- [ ] Verify all infrastructure services running
- [ ] Create Auth0 tenant and configure (manual, 30 min)

### Day 2: Backend Foundation
- [ ] Scaffold API with Fastify + Prisma (Session 2)
- [ ] Run first migration, verify schema
- [ ] Add auth middleware (Session 3)
- [ ] Create seed script with test org + admin user

### Day 3: Frontend Foundation
- [ ] Scaffold React app with Tailwind (Session 4)
- [ ] Build app shell (header, sidebar, routing)
- [ ] Integrate Auth0 login flow
- [ ] Verify: login → see dashboard → logout

### Day 4: Agent Foundation
- [ ] Scaffold Python agent service (Session 5)
- [ ] Get basic Claude chat working with streaming
- [ ] Build chat panel in frontend
- [ ] Verify: type message → see streaming response

### Day 5: First Real Feature
- [ ] Contract CRUD + upload (Sessions 6-7)
- [ ] Search (Session 8)
- [ ] Repository UI (Session 9)
- [ ] Verify: upload a contract → search for it → see it in the list → click to view details

**End of Week 1: You have a working app with login, a repository of contracts, search, and an agent that says hello. Everything from here is building features on top of this foundation.**

---

## How to Use Claude Code Specifically

### Start Each Session

```bash
cd clm-platform
claude

# First message in every session:
> Read docs/00-PROJECT-INDEX.md to understand the project structure. 
> Then read [specific doc for today's task]. 
> I want to build [specific thing]. Let's start.
```

### Mid-Session Patterns

```
> Run the tests for this module
> Show me what's in apps/api/src/modules/contracts/
> This endpoint returns 500. Look at the error and fix it.
> Add the missing TypeScript types for this function
```

### End Each Session

```
> Run all tests. 
> Show me a summary of all files you created or modified.
> Are there any TODO or FIXME comments we should address?
```

Then: review changes, run the app, verify manually, commit.

---

## The Meta-Strategy

You're not just building an app. You're building a **system of systems** — a web app, a backend, an agent layer, a job queue, a workflow engine, and a dozen integrations. The spec docs give you the blueprint. Vibe coding gives you the speed. But the discipline of **verify, commit, move on** is what keeps the whole thing from collapsing.

Think of it like building a house with a robot assistant. The robot can frame walls incredibly fast, but you still need to check that the walls are plumb before putting up the next one. Skip the check, and the second floor is crooked.

Start Phase 1 tomorrow. By Friday you'll have a working app.
