# Spike: Prisma Postgres → MongoDB

**Status: PASSED.** `approvals`, `rbac` and `cross-org` all green against a
real MongoDB single-node replica set — 15/15 tests, the gate the plan set.

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
stands; MongoDB stays the system of record. **Three items below need decisions
before launch** — one of them is security-relevant.

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

## Open decisions

**1. Money as Float.** `Contract.value`, `ContractRequest.estimatedValue`,
`Invoice.amount` are `Float` with `TODO(merge)`. Binary floating point cannot
represent decimal money exactly and `Invoice.amount` feeds reconciliation.
Integer minor units is correct; it changes arithmetic at every call site, so
decide before a billing path exists.

**2. The audit chain can fork. Security-relevant.** `lib/audit.ts` used
`isolationLevel: 'Serializable'` so concurrent appends to one org's hash chain
were strictly ordered. MongoDB rejects the option and offers only snapshot
isolation — which is **not equivalent**: two concurrent appends read the same
`prev` row then insert two *different* documents, so Mongo sees no write
conflict and both commit, forking the chain silently.

Now provider-conditional so the gate passes. The real fix is a per-org
chain-head document updated inside the same transaction, making concurrent
appends collide on one document so Mongo aborts the loser — which the existing
`P2034` retry loop already handles. Until then the chain is ordered only under
low concurrency.

**3. One real JOIN.** `routes/dashboard.ts:118` joins `approval_steps` to
`approval_instances` for the per-user pending-approval badge. Its own comment
records that both filters are load-bearing — without them the badge counts
steps the user should not see yet. Becomes two queries plus app-side
correlation, or an aggregation pipeline.

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
