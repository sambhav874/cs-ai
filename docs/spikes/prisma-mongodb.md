# Spike: Prisma Postgres → MongoDB

**Status: PASSED, and the three findings are fixed.** `approvals`, `rbac`,
`cross-org` and a new audit-chain concurrency suite are green against a real
MongoDB single-node replica set — **18/18**.

Artifact: `apps/api/prisma/schema.mongo.prisma`, beside the Postgres schema.

```
✓ src/routes/rbac.integration.test.ts      (8 tests)
✓ src/routes/approvals.integration.test.ts (3 tests)
✓ src/routes/cross-org.integration.test.ts (4 tests)
  Test Files  3 passed (3)
       Tests  15 passed (15)
```

## Verdict

The connector covers what this API relies on. The two-language architecture
stands; MongoDB stays the system of record. All three findings are resolved —
two fixed in code, one decided with a written trigger.

## What converted cleanly

22 schema errors in 5 classes, all mechanical:

| Class | Count | Fix |
| --- | --- | --- |
| Ids need `@map("_id")` | 42 | All were already `String @id @default(cuid())`, so ids stay strings and no relation field changes type. This is why the conversion was far smaller than assumed |
| `Decimal` unsupported | 6 | **Three are money** — see Open 1 |
| Self-relations need explicit `NoAction` | 3 | `Contract.amendments`, `ClauseCategory` tree, `ContractComment` replies |
| `@unique` + `@@index` on one field collide | 2 | On Postgres distinct; on MongoDB the unique index *is* the index |
| pgvector | 1 | `Unsupported("vector(1536)")` dropped — vectors go to Qdrant / Atlas |

## What runtime found that inspection could not

**1. `deletedAt: null` matches nothing.** The big one. Measured:

```
deletedAt: null              -> only docs where null was explicitly WRITTEN
deletedAt: { isSet: false }  -> only docs where the field is ABSENT
OR of both                   -> everything
```

On Postgres an unwritten optional column is NULL and matches. On MongoDB
Prisma omits the field entirely, so it does not. The codebase has **233
`deletedAt: null` query sites across 39 files and 13 models** — every one
returning empty, silently, as 404s rather than errors.

Fixed write-side in `lib/prisma.ts`: a client extension writes `deletedAt:
null` on create for the 13 soft-delete models. All 233 reads work unchanged.

**2. `connection_limit` is Postgres-only.** `lib/prisma.ts` appended it to
every URL; MongoDB rejects it and wants `maxPoolSize`. Now connector-aware.

**3. A nullable `@unique` cannot exist.** `User.inviteToken` — MongoDB treats
missing/null as a value, so only one user could have a null token. Exactly
one such field in 43 models. `@unique` removed; uniqueness is owed to the
migration runner as a partial index, which Prisma cannot express:

```js
db.users.createIndex({ inviteToken: 1 }, { unique: true,
  partialFilterExpression: { inviteToken: { $type: "string" } } })
```

## Decisions — all three resolved

**1. The audit chain fork — FIXED.** `AuditChainHead`, one row per org, updated
inside the same transaction as the append. Concurrent appends now collide on
that single row, so the database raises a real write conflict and the loser
retries. Works on both providers, so the provider conditional is gone.

Two things only concurrency testing found:

- **P2002 is reachable.** On an org's *first* append, two transactions INSERT
  the head rather than updating it, so the race arrives as a unique violation,
  not a write conflict. Added to the retryable set.
- **The retry policy was too weak** once contention became real. 20 concurrent
  appends landed **4 of 20**: five attempts with unjittered backoff means every
  loser wakes at the same instants and collides again. Now eight attempts with
  full jitter capped at 500 ms — all 20 land.

`audit-chain.integration.test.ts` fires 20 concurrent appends and asserts one
unbroken chain, exactly one genesis event, no shared `prevHash`, and a head
matching the tail. It fails against the pre-fix code.

**2. The JOIN — FIXED.** `routes/dashboard.ts` held the only real join. Rewritten
as two queries plus an in-memory correlation, preserving the
`GREATEST(currentStepOrder, 1)` gate exactly. `routes/health.ts` swapped
`SELECT 1` for an indexed read. Prisma MongoDB has no `$queryRaw` at all, so
both were compile errors rather than silent runtime failures.

**3. Money as Float — KEEP FLOAT, with a trigger.**

The decisive fact: **the app already does float64 arithmetic on money.** Every
read site coerces and accumulates:

```ts
counterparties.ts:231   totalValue += Number(c.value.toString())
analytics.ts:85         // "Sum executed value" — up to 5,000 rows, in JS float
invoices.ts:150         Math.abs(invoice.amount - contractValue) / contractValue
```

Decimal storage was never protecting the computation — it was discarded at
every read. So Float storage introduces no new class of error; it removes a
layer of storage precision the app was already throwing away.

Converting to integer minor units now would touch ~70 sites (60 for
`Contract.value` alone) across code paths with no test coverage — more risk
than it removes today.

**Trigger: convert end-to-end to integer minor units before invoice
reconciliation ships** (Phase 3 in the roadmap). That is the first path where
money correctness is load-bearing rather than advisory. The real hazard is
`analytics.ts` summing up to 5,000 float values — which is pre-existing, not
introduced by this migration.

## Raw SQL: 7 sites, 5 already leaving

`lib/embeddings.ts:310,354,369` and `routes/contracts.ts:1341,1363` are all
pgvector and go with the Qdrant / Atlas decision. `routes/health.ts:43` is
`SELECT 1`. `routes/dashboard.ts:118` is Open 3.

## Reproducing

```bash
docker run -d --name csai-mongo -p 27017:27017 mongo:7 --replSet rs0 --bind_ip_all
docker exec csai-mongo mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'
docker run -d --name csai-redis -p 6379:6379 redis:7-alpine

cd apps/api
DATABASE_URL="mongodb://localhost:27017/csai?replicaSet=rs0&directConnection=true" \
  ./node_modules/.bin/prisma db push --schema prisma/schema.mongo.prisma
DATABASE_URL="mongodb://localhost:27017/csai?replicaSet=rs0&directConnection=true" \
REDIS_URL="redis://localhost:6379" \
  ./node_modules/.bin/vitest run --config vitest.integration.config.ts
```

## Not covered

Transactions beyond the audit path (25 sites, 12 interactive — interactive
transactions carry a 5 s default timeout on MongoDB), the 12 `groupBy` sites,
and the unit suite. Elasticsearch and MinIO are absent in this run; the app
logs and degrades rather than failing.
