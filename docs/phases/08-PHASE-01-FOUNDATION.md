# Phase 01 — Foundation

**Goal**: Get the core infrastructure running — auth, database, API shell, agent framework, and UI shell with navigation. At the end of this phase, you can log in, see an empty dashboard, and get a "hello" response from the agent.

**Duration estimate**: 2–3 weeks

---

## What You Build

### Backend
- [ ] Project scaffolding (Node.js Fastify + TypeScript)
- [ ] PostgreSQL database setup with Prisma ORM
- [ ] Core database migrations: `organizations`, `users`, `roles`, `user_roles`, `audit_events`
- [ ] Auth integration (Auth0/Clerk): login, signup, JWT validation middleware
- [ ] RBAC middleware: permission checking on every request
- [ ] Multi-tenancy middleware: extract `org_id` from JWT, scope all queries
- [ ] Row-level security policies in PostgreSQL
- [ ] Event bus setup (Redis Streams): publish events, consume events
- [ ] Audit trail service: log every event to `audit_events` table
- [ ] Health check endpoint (`GET /api/v1/health`)
- [ ] Error handling middleware (RFC 7807 format)
- [ ] Request logging middleware
- [ ] CORS configuration
- [ ] Rate limiting middleware
- [ ] User API: `GET /api/v1/users/me`, `PATCH /api/v1/users/me/preferences`
- [ ] Org API: `GET /api/v1/org`, `GET /api/v1/org/roles`

### Agent Layer
- [ ] Python agent service scaffolding (FastAPI for gRPC bridge)
- [ ] LLM provider abstraction (OmniModel router)
- [ ] Claude API client with streaming support
- [ ] Orchestrator skeleton (LangGraph state machine — classify intent only)
- [ ] Agent chat endpoint: `POST /api/v1/agent/chat` (streaming SSE response)
- [ ] Basic intent classification: greet, help, unknown → appropriate response
- [ ] Conversation memory: Redis-based short-term memory (last 10 messages per session)
- [ ] Agent health check

### Frontend
- [ ] React + TypeScript + Vite project scaffolding
- [ ] Tailwind CSS + design tokens setup
- [ ] Auth integration: login page, signup page, session management
- [ ] App shell layout: header, left sidebar, main content area
- [ ] Left navigation: all nav items from `00-PROJECT-INDEX.md` (most disabled/empty)
- [ ] Chat panel: collapsible right panel, message input, streaming message display
- [ ] Global search bar (UI only — search functionality in Phase 2)
- [ ] Notification bell (UI only — notifications in later phase)
- [ ] User avatar dropdown: profile, settings, logout
- [ ] Empty dashboard page (placeholder for analytics)
- [ ] 404 page
- [ ] Loading states and skeleton components
- [ ] Toast notification component
- [ ] Confirmation dialog component

### Infrastructure
- [ ] Docker Compose for local development (PostgreSQL, Redis, MinIO, API, agents, web)
- [ ] Database seed script: create default org, admin user, system roles
- [ ] Environment configuration (.env files per environment)
- [ ] ESLint + Prettier configuration
- [ ] Git repository setup with branch strategy (main, develop, feature/*)

---

## Database Migrations for This Phase

```sql
-- 001_create_organizations.sql
CREATE TABLE organizations ( ... );  -- See 03-DATA-MODEL.md

-- 002_create_users.sql
CREATE TABLE users ( ... );
CREATE TABLE roles ( ... );
CREATE TABLE user_roles ( ... );

-- 003_create_audit_events.sql
CREATE TABLE audit_events ( ... );
-- + immutability trigger

-- 004_seed_system_roles.sql
INSERT INTO roles (name, is_system, permissions) VALUES
  ('Admin', true, '{"contracts":{"view":true,"edit":true,...},...}'),
  ('Legal Counsel', true, '{"contracts":{"view":true,"edit":true,...},...}'),
  ('Sales Rep', true, '{"contracts":{"view":true,"create_request":true,...},...}'),
  ...;

-- 005_enable_rls.sql
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- + policies
```

---

## API Endpoints for This Phase

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | System health check |
| GET | `/api/v1/users/me` | Current user profile |
| PATCH | `/api/v1/users/me/preferences` | Update user preferences |
| GET | `/api/v1/org` | Current org details |
| GET | `/api/v1/org/roles` | List roles |
| POST | `/api/v1/agent/chat` | Chat with agent (SSE streaming) |

---

## Acceptance Criteria

When this phase is complete, you should be able to:

1. **Start the full stack** with `docker compose up` — all services healthy
2. **Sign up** as a new user → creates org + admin user
3. **Log in** with email/password → see the app shell with sidebar
4. **See the dashboard** (empty state with "Welcome" message)
5. **Open the chat panel** → type "Hello" → get a streaming response from the agent
6. **See your profile** via user menu → see your role (Admin)
7. **Log out** and back in → session persists
8. **Check audit log**: login events logged in `audit_events` table
9. **Call API directly**: `GET /api/v1/users/me` with JWT → returns user data
10. **RBAC works**: create a second user with "Sales Rep" role → verify they cannot access admin endpoints

---

## Feature IDs Covered

None directly — this phase is infrastructure. But it establishes the foundation for ALL features.

## Screens Built

- Login / Signup pages
- App Shell (header, sidebar, main area, chat panel)
- Empty Dashboard (SCR-027 skeleton)
- User Settings (SCR-021 skeleton)
- 404 page
