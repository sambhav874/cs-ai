---
trigger: manual
---

Merging both into one tight, non-redundant rule set — organized so it's usable as an actual system prompt/checklist, not just a wall of text.

# Senior Engineer Code Rules

**Mindset**
- Production-ready only — no demos, stubs, or placeholders unless explicitly asked
- Think through architecture before writing code; choose industry-standard over experimental
- When multiple valid approaches exist, balance simplicity, security, scalability, maintainability, performance — in that order of tiebreak unless stated otherwise

**Architecture & Structure**
- Clean architecture, clear separation of concerns (business logic ≠ UI ≠ data access)
- SOLID principles, composition over inheritance
- Scalable folder structure, organized by feature/domain
- Every module/function/class has one clear responsibility
- Small functions (<30 lines), small files (<300 lines)
- Reusable services/utils/hooks instead of duplicated logic (DRY)
- Loose coupling — depend on abstractions, not implementations

**Naming & Readability**
- Descriptive, consistent names (no abbreviations, no magic numbers)
- Comments explain *why*, not *what*
- Remove dead code, unused imports/vars, commented-out blocks
- Readability over clever/terse code
- Consistent formatting via linter/formatter — automated, not debated

**Security**
- No hardcoded secrets/keys/tokens — env vars only
- Validate & sanitize all external/client input — never trust it
- Guard against XSS, CSRF, SQL/command injection, insecure deserialization
- Principle of least privilege everywhere (auth, DB, infra)

**Error Handling**
- Fail fast, validate inputs early
- Handle every expected failure explicitly — never swallow exceptions
- Centralized error handling where applicable
- User-facing errors are meaningful but never leak internals/stack traces

**Performance & Scalability**
- Efficient algorithms/data structures; avoid unnecessary loops, queries, re-renders
- Cache expensive operations; lazy-load where sensible
- Prevent N+1 queries; index frequently-queried DB fields
- Stateless, idempotent services designed to scale horizontally
- Configurable, not hardcoded (feature flags > long-lived branches)

**API & Data**
- Validate all payloads; consistent response shape + correct HTTP status codes
- Use transactions where atomicity matters
- Preserve backward compatibility unless breaking change is explicit

**Frontend (if applicable)**
- Responsive, accessible components
- Explicit loading / empty / error states
- Minimal state, presentation separated from logic

**Testing & Observability**
- Write testable code — pure functions, no hidden side effects, DI-friendly
- Structure to support unit → integration → e2e
- Structured logging; never log secrets or PII
- Logs/metrics should make debugging straightforward, not noisy

**Dependencies & Delivery**
- Prefer well-maintained libraries or built-ins over new dependencies
- Complete implementations — imports correct, code compiles/runs
- No TODO/FIXME left behind unless explicitly requested
- Self-review the diff like a stranger would before calling it done

**One-line gut check before shipping:**
*"Could this be merged into a production codebase with minimal modification?"* If no — it's not done.