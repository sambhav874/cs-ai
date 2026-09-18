# Spike: Prisma Postgres → MongoDB

Status: **schema gate passed.** Runtime gate not yet run.
Artifact: `apps/api/prisma/schema.mongo.prisma` (sits beside the Postgres schema).

## Result so far

The 43-model schema validates on the MongoDB connector. It was smaller
work than the plan assumed, for one reason: **every id was already
`String @id @default(cuid())`**. Ids stay strings, no relation field
changes type, and nothing that references an id externally breaks.

## Schema: 22 errors, 5 classes, all resolved

| Class | Count | Fix |
| --- | --- | --- |
| Ids need `@map("_id")` | 42 | Mechanical. `CollabState` also needed it — it keys on a Yjs document name, not a cuid |
| `Decimal` unsupported | 6 | **Three are money** — see below |
| Self-relations need explicit `NoAction` | 3 | `Contract.amendments`, `ClauseCategory` tree, `ContractComment` replies |
| `@unique` + `@@index` on the same field collide | 2 | On Postgres these are distinct; on MongoDB the unique index *is* the index. Dropped the redundant `@@index([token])` |
| pgvector | 1 | `embedding Unsupported("vector(1536)")` cannot exist. Dropped |

## Open decision: money as Float

`Decimal` has no MongoDB equivalent in Prisma. Six fields were affected.
Three are LLM cost tracking and tolerate Float. **Three are money:**

- `Contract.value`
- `ContractRequest.estimatedValue`
- `Invoice.amount`

All three are `Float` in the converted schema and carry `TODO(merge)`.
Float is a placeholder, not a fix — binary floating point cannot represent
common decimal values exactly, and `Invoice.amount` feeds reconciliation.

Options: integer minor units (exact, changes arithmetic at every call
site), String (exact, needs parsing), or Float (wrong, but smallest
diff). **Decide before any billing or reconciliation path is built**, not
after.

## App code: 7 raw-SQL sites

Five of seven are pgvector and were already leaving under the
Qdrant / Atlas Vector Search decision:

- `lib/embeddings.ts:310, 354, 369`
- `routes/contracts.ts:1341, 1363` — portfolio similarity and peer benchmarks

Two are genuinely new work:

- `routes/health.ts:43` — `SELECT 1`. Trivial, becomes a Mongo ping.
- `routes/dashboard.ts:118` — **a real JOIN**, and the interesting one:

```sql
SELECT COUNT(*) FROM approval_steps s
JOIN approval_instances i ON i.id = s."approvalInstanceId"
WHERE s."orgId" = $1 AND s."approverId" = $2
  AND s.status = 'PENDING'
  AND s."stepOrder" = GREATEST(i."currentStepOrder", 1)
```

This is the per-user pending-approval badge. Its own comment records why
both filters are load-bearing: without them the badge counts steps the
user should not see yet. So it is sequential-gating correctness, not
cosmetics — and it is the concrete instance of the plan's "no joins"
warning, found in real code. It becomes two queries plus app-side
correlation, or an aggregation pipeline through `$runCommandRaw`.

## Still unverified

The schema gate is not the runtime gate.

- **Client generation** against the Mongo schema.
- **25 `$transaction` call sites** — 12 interactive, 13 batch array.
  Interactive transactions need a replica set and carry a default 5 s
  timeout. Both need runtime proof, not inspection.
- **12 `groupBy` sites** — supported, restrictions unverified.
- **The three gate suites**: `approvals`, `rbac`, `cross-org`. These boot
  the whole Fastify app and hit real routes, which is why a trimmed
  6-model schema was never going to be enough — the client generates from
  the whole schema and the app touches most of it at boot.

## Next

1. `prisma generate` against the Mongo schema.
2. Stand up a single-node replica set.
3. Run `approvals.integration.test.ts` — the gate.
4. Then `rbac` and `cross-org`.
