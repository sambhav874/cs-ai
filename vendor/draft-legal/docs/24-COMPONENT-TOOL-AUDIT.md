# 24 — Component & Tool Audit: What's Covered, What's Missing

This is the definitive checklist. Every component a production CLM needs, whether our docs cover it, and the specific tool choice if one is needed.

---

## Scoring

- ✅ **Covered** — Architecture defined, tool chosen, implementation approach clear
- ⚠️ **Partially covered** — Mentioned but missing tool choice or implementation detail
- ❌ **Missing** — Not addressed in any doc, needs to be added
- ➖ **Not needed** — Deliberately excluded with reasoning

---

## 1. Core Infrastructure

| Component | Status | What We Have | Gap / Tool Recommendation |
|-----------|--------|-------------|---------------------------|
| Primary database | ✅ | PostgreSQL 16 + pgvector | Covered in 02, 03 |
| Cache + queue broker | ✅ | Redis 7 (cache, BullMQ queues, pub/sub, sessions) | Covered in 02, 20 |
| Object storage | ✅ | AWS S3 (MinIO for local dev) | Covered in 02, 21 |
| Search engine | ✅ | Elasticsearch 8 | Covered in 02, 21 |
| Analytics database | ✅ | ClickHouse | Covered in 02 |
| Vector search | ✅ | pgvector (PostgreSQL extension) | Covered in 02, 03 |
| Container orchestration | ✅ | Kubernetes (EKS) | Covered in 19 |
| Container registry | ⚠️ | Implied ECR | **Add**: Explicitly specify AWS ECR. Add image tagging strategy (commit SHA + semver). |
| DNS / Domain management | ❌ | Not mentioned | **Add**: Route53 or Cloudflare. Custom domains for portal (`contracts.clientname.com`). SSL via ACM or Let's Encrypt. |
| CDN | ⚠️ | CloudFront mentioned once | **Add**: CloudFront for static assets (React build, document thumbnails). Cache policy: static assets = 1 year with hash-busted filenames. Portal pages = 0 cache (dynamic). |
| API Gateway (external) | ❌ | Not addressed | **Decision**: Not needed initially. Fastify handles routing, auth, rate limiting directly. Add AWS API Gateway or Kong only if you need: custom domain per tenant, API key management for external consumers, or WAF protection. Revisit at Phase 10. |
| Service mesh | ❌ | Not addressed | **Decision**: Not needed initially. Only 3 services (API, agents, workers). Add Istio/Linkerd when you hit 10+ services or need advanced traffic management. |
| Database connection pooling | ❌ | Mentioned once, no tool | **Add**: PgBouncer in production (not needed for dev). Prisma's built-in pool (connection_limit=10 per instance) is sufficient until ~50 concurrent connections. Beyond that, add PgBouncer as a sidecar container. |
| Local dev environment | ✅ | Docker Compose | Covered in 02 |

---

## 2. Application Services

| Component | Status | What We Have | Gap / Tool Recommendation |
|-----------|--------|-------------|---------------------------|
| API framework | ✅ | Fastify + TypeScript | Covered in 02 |
| ORM | ✅ | Prisma | Covered in 02 |
| Auth provider | ✅ | Auth0 or Clerk | Covered in 06 |
| RBAC enforcement | ✅ | Custom middleware + OPA (future) | Covered in 06, 21 |
| Event bus | ✅ | Redis Streams | Covered in 01, 20 |
| Job queue | ✅ | BullMQ | Covered in 20 |
| Job queue monitoring UI | ❌ | Not addressed | **Add**: `bull-board` (open source) — mount at `/admin/queues` (admin-only). Shows all queues, job status, failed jobs, retry controls. Essential for ops. Tool: `@bull-board/fastify` package. |
| Scheduled tasks | ✅ | BullMQ repeatable jobs | Covered in 20 |
| Workflow engine | ✅ | Custom (state machine) | Covered in 20 |
| Structured logging | ⚠️ | JSON logging mentioned | **Add**: Use `pino` (Fastify's built-in logger). Log format: JSON with `request_id`, `org_id`, `user_id`, `duration_ms`. In production, ship to CloudWatch Logs or ELK. |
| Distributed tracing | ❌ | Not addressed | **Add**: OpenTelemetry SDK → traces sent to Jaeger (self-hosted) or AWS X-Ray. Trace a request from API → agent → LLM → database → response. Critical for debugging slow agent responses. Tool: `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node`. |
| Feature flags | ✅ | PostHog feature flags | Covered in 19, 21 |
| Error tracking | ⚠️ | Sentry mentioned | **Add**: Sentry for both Node.js and Python. Frontend: `@sentry/react`. Backend: `@sentry/node`. Agents: `sentry-sdk[fastapi]`. Configure: source maps upload in CI, release tracking, performance transactions for critical paths. |
| Secrets management | ✅ | AWS KMS / HashiCorp Vault | Covered in 06 |

---

## 3. Document Processing Pipeline

This is the most tool-heavy subsystem. Documents flow through multiple transformations.

| Component | Status | What We Have | Gap / Tool Recommendation |
|-----------|--------|-------------|---------------------------|
| Document upload + validation | ✅ | S3 upload, MIME check, size limit | Covered in 21 |
| Virus scanning | ✅ | ClamAV or AWS GuardDuty | Covered in 21 |
| Text extraction from DOCX | ⚠️ | mammoth.js mentioned | **Confirm**: `mammoth` converts DOCX → HTML (preserves structure). Use for importing Word docs into TipTap. For text-only extraction (search indexing), `mammoth.extractRawText()`. |
| Text extraction from PDF | ⚠️ | "pdf-parse" mentioned in one session | **Add**: `pdf-parse` for text-layer PDFs. For scanned PDFs (image-only), fall back to OCR pipeline. Detection: if `pdf-parse` returns <100 chars from a multi-page doc, it's likely scanned → route to OCR. |
| OCR (scanned documents) | ✅ | Claude Vision + Tesseract fallback | Covered in 02, 21 |
| Document conversion: DOCX → PDF | ❌ | Tool not chosen | **Add**: LibreOffice headless (`libreoffice --convert-to pdf`) running in a Docker sidecar container. Free, accurate, handles complex formatting. Alternative: Gotenberg (Docker-based conversion service wrapping LibreOffice + Chromium). Run as: `docker run --rm gotenberg/gotenberg:8`. API: `POST /forms/libreoffice/convert` with file upload. |
| Document conversion: HTML → PDF | ❌ | Puppeteer mentioned once | **Add**: Puppeteer (headless Chromium) for HTML → PDF. Used for: generating PDF reports, compliance packages, contract exports from TipTap HTML. Run Puppeteer in a separate worker (memory-heavy). Alternative: use Gotenberg's Chromium route. |
| Document conversion: HTML → DOCX | ❌ | Not addressed | **Add**: `html-docx-js` for simple conversions. For complex DOCX generation with headers/footers/page numbers: `docx` npm package (programmatic DOCX building). The pipeline: TipTap JSON → HTML → DOCX for "Export to Word" feature. |
| Document conversion: DOCX → HTML | ⚠️ | mammoth.js | **Confirm**: mammoth DOCX → HTML for importing counterparty Word docs into TipTap editor. Handles tables, lists, formatting. Doesn't handle: headers/footers, page breaks, complex layouts (these import as simplified HTML). |
| Thumbnail generation | ❌ | Not addressed | **Add**: Generate PNG thumbnails of first page for repository grid view. Use Puppeteer (render first page of HTML) or `pdf-thumbnail` for PDFs. Store as: `s3://{org}/contracts/{id}/thumbnail.png`. Resolution: 400x566px (A4 ratio). |
| Diff computation (document comparison) | ❌ | **Critical gap** | **Add**: This powers the entire negotiation phase (SCR-010 Redline View). Tool: `diff-match-patch` (Google's library) for text-level diffs. For structured document diffs (section-aware): build custom diff on TipTap JSON trees — compare node-by-node, detect inserted/deleted/modified sections. Output: list of changes with positions, each marked as insert/delete/modify. This is a complex component — budget 2-3 sessions in Phase 5. |
| Document viewer (in-browser) | ⚠️ | "react-pdf" mentioned | **Confirm**: `@react-pdf-viewer/core` for PDF viewing (paginated, zoomable, searchable). For DOCX: convert to HTML server-side (mammoth), render HTML in browser. For TipTap documents: render directly in read-only TipTap editor. |

### Document Conversion Flow Summary

```
                    ┌──────────────────────────────────────────┐
                    │          Document Format Matrix            │
                    │                                           │
Upload (DOCX) ──mammoth──► HTML ──TipTap──► Editor (live)      │
Upload (PDF) ───pdf-parse──► Text (search) + PDF viewer (view) │
Upload (image) ──OCR──► Text (search)                          │
                    │                                           │
Editor (TipTap) ──export──► HTML ──puppeteer──► PDF (download)  │
Editor (TipTap) ──export──► HTML ──html-docx──► DOCX (download)│
                    │                                           │
Template ──assemble──► TipTap JSON ──► Editor                   │
                    └──────────────────────────────────────────┘
```

**Add to Docker Compose**: Gotenberg container for document conversion:

```yaml
gotenberg:
  image: gotenberg/gotenberg:8
  ports: ["3001:3000"]
  # Handles: DOCX→PDF, HTML→PDF, merge PDFs, Office→PDF
```

---

## 4. Communication & Notifications

| Component | Status | What We Have | Gap / Tool Recommendation |
|-----------|--------|-------------|---------------------------|
| Transactional email (outbound) | ⚠️ | SendGrid mentioned | **Confirm**: SendGrid or Resend (newer, developer-friendly). For email templating: `react-email` (write templates as React components → render to HTML). |
| Inbound email processing | ⚠️ | IMAP mentioned | **Add**: Two options. (A) IMAP polling: `imapflow` npm package, poll every 30s, parse with `mailparser`. (B) Webhook-based: Use SendGrid Inbound Parse or Mailgun Routes → forwards to your API endpoint. Webhook is simpler and more reliable. Recommend option B. |
| Slack integration | ✅ | Slack MCP / bot mentioned | **Add tool**: `@slack/bolt` (Slack's official Node.js framework). Handles: OAuth install, event subscriptions, slash commands, interactive messages (approval buttons), file uploads. |
| Microsoft Teams integration | ⚠️ | Mentioned alongside Slack | **Add tool**: `botbuilder` (Microsoft Bot Framework SDK). More complex than Slack. Handles: proactive messaging, adaptive cards (for approvals), Teams tab (embedded web app). Lower priority than Slack. |
| Push notifications (web) | ❌ | Not addressed | **Add**: Web Push API via service worker. Tool: `web-push` npm package. Register service worker on first login → store push subscription in DB → send push for approval requests, obligation alerts. Progressive enhancement: works if user has granted permission, falls back to email if not. |
| Push notifications (mobile) | ❌ | Not addressed | **Add**: Firebase Cloud Messaging (FCM) for both Android and iOS. Only needed if building a native mobile app. If PWA-only, web push covers it. Defer to Phase 10+. |
| SMS notifications | ❌ | Not addressed | **Decision**: Deprioritize. SMS is expensive, low-engagement for B2B SaaS. Only useful for: signature reminders to external signers who don't check email. If needed later: Twilio. Defer to Phase 10+. |
| In-app notifications | ✅ | Activity feed (SCR-032) | Covered in 04, 21 |
| Notification dedup | ✅ | Redis-based dedup | Covered in 21 |
| Notification preferences UI | ✅ | SCR-033 | Covered in product spec |

---

## 5. Agent & AI Infrastructure

| Component | Status | What We Have | Gap / Tool Recommendation |
|-----------|--------|-------------|---------------------------|
| Agent orchestrator | ✅ | LangGraph state machine | Covered in 05 |
| LLM provider (primary) | ✅ | Anthropic Claude | Covered in 02, 05 |
| LLM provider (fallback) | ✅ | OpenAI GPT | Covered in 05 |
| OmniModel routing | ✅ | Task-based router | Covered in 05 |
| Prompt management | ✅ | File-based versioning + eval pipeline | Covered in 21 |
| RAG / retrieval pipeline | ✅ | pgvector + Elasticsearch | Covered in 05, 21 |
| Conversation memory | ✅ | Redis (session-scoped) | Covered in 05 |
| Agent ↔ backend communication | ✅ | gRPC (sync) + Redis queue (async) | Covered in 05 |
| Agent streaming to frontend | ✅ | SSE (Server-Sent Events) | Covered in 02, 04 |
| LLM token tracking / billing | ❌ | Not addressed | **Add**: Log every LLM call with: model, input_tokens, output_tokens, cost. Store in `llm_usage` table. Aggregate per org per month for billing. Show in admin dashboard. Tool: custom — just log from the LLM provider abstraction layer. |
| LLM response caching | ❌ | Not addressed | **Add**: Cache identical prompts (hash prompt → check Redis → return cached if exists). Useful for: repeated searches, template descriptions, clause explanations. TTL: 1 hour. Only cache read-only operations, never cache draft generation. Saves 30-40% of LLM costs. |
| Agent evaluation / testing | ✅ | Eval framework described | Covered in 21, 18 |
| Guardrails / content safety | ⚠️ | Safety prompts mentioned | **Add**: Input validation before LLM call (reject prompt injection attempts). Output validation after LLM call (verify JSON schema, check for hallucinated clause text not in library). Tool: custom validators per agent. |

---

## 6. Frontend Infrastructure

| Component | Status | What We Have | Gap / Tool Recommendation |
|-----------|--------|-------------|---------------------------|
| Framework | ✅ | React 18 + TypeScript + Vite | Covered in 02 |
| UI primitives | ✅ | Radix UI + Tailwind CSS | Covered in 02, 07 |
| Component library | ⚠️ | Design tokens defined, no pre-built kit chosen | **Add**: Use `shadcn/ui` as the component foundation. It's built on Radix UI + Tailwind (our chosen stack) and provides pre-built: Button, Input, Select, Table, Dialog, Sheet, Tabs, Toast, Card, Badge, Command (for Cmd+K), Calendar, etc. Import components as needed — not a dependency, just copy-paste source files. |
| Rich text editor | ✅ | TipTap (ProseMirror) | Covered in 02, 21 |
| Collaborative editing | ✅ | Yjs + HocusPocus | Covered in 21 |
| State management | ✅ | Zustand + React Query | Covered in 02 |
| Routing | ⚠️ | React Router implied | **Add**: `react-router-dom` v6 with file-based route convention. Lazy-load route components for code splitting. |
| Data tables | ⚠️ | Component described, no tool | **Add**: `@tanstack/react-table` (TanStack Table v8). Headless — works with any UI. Features: sorting, filtering, pagination, column resizing, row selection. Paired with shadcn/ui's table styling. |
| Charts / data viz | ❌ | Not addressed | **Add**: `recharts` (React-native charting, uses D3 under the hood). Used for: dashboard charts, cycle time trends, risk heat maps, stage distribution. Simple API, good defaults, responsive. |
| Drag and drop | ⚠️ | Mentioned for workflow builder | **Add**: `@dnd-kit/core` + `@dnd-kit/sortable`. Used for: workflow builder (drag nodes), team workload (drag to reassign), template builder (reorder sections). Accessible, performant, React-native. |
| Keyboard shortcuts | ❌ | Only Cmd+K mentioned | **Add**: Global shortcuts framework. Tool: `react-hotkeys-hook`. Shortcuts: `Cmd+K` (search/agent), `Cmd+N` (new contract), `Cmd+S` (save), `Cmd+Enter` (submit/approve), `Escape` (close panel/modal). Show shortcut hints in tooltips. |
| Dark mode | ❌ | Not addressed | **Add**: Tailwind `dark:` variant + CSS variables that swap in dark mode. Store preference in user settings. Detect system preference via `prefers-color-scheme`. Toggle in user menu. Design tokens need dark-mode counterparts (defined once in CSS, applied everywhere via variables). |
| PDF viewer | ⚠️ | react-pdf mentioned | **Confirm**: `@react-pdf-viewer/core` + `@react-pdf-viewer/default-layout` (based on PDF.js). Features: pagination, zoom, search within PDF, thumbnail sidebar. |
| Date/time handling | ❌ | Not addressed | **Add**: `date-fns` for date manipulation and formatting. All dates stored as UTC in DB, displayed in user's timezone (from preferences). Format per user's locale (date-fns `format` with locale). |
| Form handling | ❌ | Not addressed | **Add**: `react-hook-form` + `zod` for validation. Pattern: define Zod schema (shared with backend validation) → `useForm` with `zodResolver` → type-safe form with auto-validation. |
| Markdown rendering | ❌ | Not addressed | **Add**: `react-markdown` for rendering agent responses that contain markdown (chat panel, summaries, reports). |
| File upload UI | ❌ | Not addressed | **Add**: `react-dropzone` for drag-and-drop file upload zones. Used in: contract upload, bulk import, evidence upload, attachment upload. |
| Mobile strategy | ❌ | Responsive mentioned, no decision | **Decision**: **Progressive Web App (PWA)** — not a native app. Reasons: (1) the primary mobile use case is approvals, which is a simple card UI (2) PWA works offline for viewing cached contracts (3) push notifications via service worker (4) no app store approval needed (5) single codebase. Add `vite-plugin-pwa` for service worker generation, manifest, and offline caching. Native mobile (React Native) only if customer demand requires it — defer to post-launch. |
| Accessibility testing | ❌ | WCAG mentioned, no tool | **Add**: `eslint-plugin-jsx-a11y` (lint-time checks). `axe-core` + `@axe-core/react` (runtime warnings in dev). Playwright `axe` integration for E2E accessibility tests. |

---

## 7. Data & Analytics Pipeline

| Component | Status | What We Have | Gap / Tool Recommendation |
|-----------|--------|-------------|---------------------------|
| Analytics DB | ✅ | ClickHouse | Covered in 02 |
| ETL: PostgreSQL → ClickHouse | ❌ | Mentioned, no implementation | **Add**: Two approaches. (A) Event-driven: the analytics consumer (from event bus) writes events directly to ClickHouse as they occur. (B) Batch sync: scheduled job reads from PostgreSQL, transforms, and loads into ClickHouse every hour. **Recommend**: Approach A for events (real-time) + Approach B for snapshot data (contract metadata, obligation status). Tool for batch: custom Node.js script using `@clickhouse/client`. |
| Data export: CSV/Excel | ❌ | Mentioned, no tool | **Add**: `exceljs` for Excel generation (supports formatting, multiple sheets, formulas). `csv-stringify` for CSV. Generate as background job (bulk-operations queue) → store in S3 → return presigned download URL. |
| Data export: PowerPoint | ❌ | Mentioned for exec reports | **Add**: `pptxgenjs` for PowerPoint generation. Used for: executive portfolio reports, board presentations. Generate as background job → S3 → download URL. Lower priority — Phase 9. |
| Report scheduling | ✅ | Scheduled job delivery | Covered in 20 |
| Multi-currency | ❌ | Not addressed | **Add**: Store contract value + currency (already in schema as `value` + `currency`). For dashboard aggregation: convert to org's base currency using stored exchange rates. Tool: `money.js` or custom. Exchange rate source: European Central Bank free API (daily update) or Open Exchange Rates. Store rates in Redis (daily refresh). Display: always show original currency, show converted amount in parentheses. |

---

## 8. Testing & Quality

| Component | Status | What We Have | Gap / Tool Recommendation |
|-----------|--------|-------------|---------------------------|
| Unit test framework (JS) | ✅ | Vitest | Covered in 18 |
| Unit test framework (Python) | ✅ | Pytest | Covered in 18 |
| Integration tests | ✅ | Supertest + test DB | Covered in 18 |
| E2E tests | ✅ | Playwright | Covered in 18 |
| Component tests (React) | ⚠️ | React Testing Library mentioned | **Confirm**: `@testing-library/react` + `@testing-library/user-event`. Test user interactions, not implementation details. |
| API contract testing | ❌ | Not addressed | **Add**: Generate TypeScript client from OpenAPI spec (when created). Tool: `openapi-typescript` generates types from spec. Drift between spec and implementation is caught at compile time. |
| Visual regression testing | ❌ | Not addressed | **Add for later**: Chromatic (for Storybook) or Playwright visual comparisons. Not needed for MVP. Add when you have 20+ components and want to prevent visual regressions. |
| Load testing | ⚠️ | k6 mentioned | **Confirm**: `k6` for API load testing. Add Playwright for frontend performance measurement. Key scenario: 500 concurrent users doing search + 50 concurrent agent chats. |
| Security testing | ✅ | OWASP + dependency scanning | Covered in 18 |

---

## 9. DevOps & Operations

| Component | Status | What We Have | Gap / Tool Recommendation |
|-----------|--------|-------------|---------------------------|
| CI/CD | ✅ | GitHub Actions | Covered in 19 |
| Infrastructure as Code | ✅ | Terraform | Covered in 19 |
| Kubernetes manifests | ⚠️ | Architecture described, no Helm charts | **Add**: Create Helm chart with values per environment. Not a blocker — can use plain K8s manifests initially and migrate to Helm when config becomes complex. |
| Monitoring (infra) | ✅ | Prometheus + Grafana | Covered in 19 |
| Monitoring (application) | ✅ | Sentry + PostHog | Covered in 19 |
| Monitoring (agents) | ⚠️ | Custom logging described | **Add**: Dedicated Grafana dashboard for agent metrics: requests/min, avg latency, p95 latency, error rate, tokens consumed, cost per hour. Data source: agent logs → Prometheus (via pushgateway or custom exporter). |
| Alerting | ✅ | Prometheus alerting rules + Slack/email | Covered in 19 |
| Uptime monitoring | ❌ | Not addressed | **Add**: External uptime monitor (Betteruptime, Checkly, or UptimeRobot). Checks: API health endpoint every 60s, portal page load every 5 min, agent chat endpoint every 5 min. Status page: public status page for customer visibility. |
| Runbooks | ❌ | Not addressed | **Add**: Create runbook per alert. Template: "When this fires → check this → try this → if unresolved → escalate to X." Store in `docs/runbooks/`. Build incrementally as you encounter issues. |
| Backup verification | ✅ | Daily verification job | Covered in 19, 20 |
| Data anonymization (staging) | ⚠️ | Mentioned, no tool | **Add**: Script that copies production data to staging with PII masked. Tool: custom script using `faker.js` to replace names, emails, addresses while preserving data shape and relationships. Run before any production data is loaded into staging. |

---

## Summary: What to Add to Architecture

### Must-add before starting Phase 1

| Item | Where to Add | Effort |
|------|-------------|--------|
| shadcn/ui as component kit | 02-TECH-STACK.md | 1 line |
| Pino for structured logging | 02-TECH-STACK.md | 1 line |
| react-hook-form + zod for forms | 02-TECH-STACK.md | 1 line |
| date-fns for date handling | 02-TECH-STACK.md | 1 line |
| Gotenberg for document conversion | 02-TECH-STACK.md + Docker Compose | 5 min |
| BullBoard for queue monitoring | 02-TECH-STACK.md | 1 line |
| PgBouncer for connection pooling (production) | 02-TECH-STACK.md | 1 line |
| PWA decision for mobile | 02-TECH-STACK.md | 1 paragraph |
| Dark mode support | 07-UI-DESIGN-SYSTEM.md | Add dark token values |

### Must-add before Phase 4 (Drafting)

| Item | Where to Add | Effort |
|------|-------------|--------|
| Diff computation tool (diff-match-patch) | New section in 21 or dedicated doc | 1 page |
| Document conversion pipeline (full flow diagram) | 21-GAP-FILL.md | Already added above |
| TipTap JSON → DOCX export (html-docx-js or docx) | 02-TECH-STACK.md | 1 paragraph |

### Must-add before Phase 9 (Analytics)

| Item | Where to Add | Effort |
|------|-------------|--------|
| Recharts for data viz | 02-TECH-STACK.md | 1 line |
| ETL pipeline (PG → ClickHouse) | 20-WORKFLOW-EVENTS-ASYNC.md | 1 page |
| exceljs + pptxgenjs for exports | 02-TECH-STACK.md | 2 lines |
| Multi-currency handling | 21-GAP-FILL.md | 1 section |

### Can add later (not blocking)

| Item | When | Reason |
|------|------|--------|
| OpenTelemetry distributed tracing | Phase 5+ | Helps debug slow agent chains, not needed for basic flows |
| SMS via Twilio | Phase 10+ | Low priority for B2B SaaS |
| Native mobile app | Post-launch | PWA covers 95% of mobile needs |
| Visual regression testing | Post-20 components | Not worth the setup cost earlier |
| API Gateway (Kong/AWS) | Post-launch | Fastify handles it fine initially |
| Service mesh | Post-10 services | Overkill for 3 services |
| Status page (public) | Post-launch | Build trust with customers once live |

---

## Final Verdict

**High-level architecture: 95% covered.** The layer model, component responsibilities, data flow, agent framework, and system design are solid. You won't need to rethink any major decisions.

**Tool selections: 80% covered.** The core stack (Fastify, React, PostgreSQL, Redis, TipTap, LangGraph, Claude) is sound. The gaps are mostly in the plumbing layer — document conversion, diff computation, export formats, frontend utility libraries. These are "add the npm package" level decisions, not "rethink the architecture" level.

**The 3 things that would actually force an architecture rethink if you got them wrong:**

1. **TipTap + Yjs for collaborative editing** — ✅ Covered. Good choice. The alternative (custom OT server) would be 10x more work.
2. **LangGraph for agent orchestration** — ✅ Covered. Good choice. The alternative (building a custom state machine from scratch) is fragile.
3. **Event-driven architecture for async** — ✅ Covered. Good choice. The alternative (synchronous everything) doesn't scale past 10 users.

**You're safe to start building.** The remaining tool gaps are decisions you make in 5 minutes when you hit them ("oh, I need a chart library" → `npm install recharts`). They don't change the architecture.
