# apps/api

Lifecycle API: Fastify 5 + Prisma on MongoDB. Owns auth, RBAC, approvals,
signatures, templates, clauses, requests, portal, renewals, webhooks and packs.
Issues the JWT that `apps/intelligence` verifies.

Served at `/api/*` behind nginx. Its BullMQ worker runs reminders, renewals,
webhooks and email off the shared Redis.

Two pieces of work land here before features do: the Fastify 4 → 5 upgrade, and
the Prisma Postgres → MongoDB conversion of the 40-model schema, gated by the
`approvals`, `rbac` and `cross-org` integration tests.

Source: `vendor/draft-legal/apps/api`. **AGPL-3.0** — see `docs/LICENSING.md`.
