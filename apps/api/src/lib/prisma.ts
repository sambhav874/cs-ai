/**
 * Prisma client singleton (production-tuned).
 *
 * Connection pool: Prisma defaults to `num_physical_cpus * 2 + 1`. On a
 * 4-core box that's 9 — usually fine, but under burst load (Bull
 * workers + API + audit-chain transactions) we've seen pool exhaustion.
 * Cap at 20 explicitly so Postgres doesn't get hammered + Prisma fails
 * fast with `connection_limit reached` instead of a slow timeout.
 *
 * Slow-query log: in production, every query >SLOW_QUERY_MS lands in
 * the API logs at warn level. Threshold default 250ms (the p99 of a
 * healthy contracts-list page). Cheap to maintain and saves us from
 * "everything is slow but we don't know why" tickets.
 */
import { Prisma, PrismaClient } from '@prisma/client'
import pino from 'pino'

const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS ?? 250)
const POOL_LIMIT    = Number(process.env.PRISMA_POOL_LIMIT ?? 20)

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'prisma' })

// Apply the pool limit by appending the connector's own option to the URL
// if not already specified. This is the documented way per Prisma docs —
// but the option is named per connector: Postgres spells it
// connection_limit, MongoDB spells it maxPoolSize and rejects
// connection_limit outright with "is an invalid option".
// TODO(merge): drop the Postgres arm once the connector decision is final.
function withPoolLimit(url: string | undefined): string | undefined {
  if (!url) return url
  const param = /^mongodb(\+srv)?:\/\//i.test(url) ? 'maxPoolSize' : 'connection_limit'
  if (new RegExp(`[?&]${param}=`, 'i').test(url)) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}${param}=${POOL_LIMIT}`
}

/**
 * TODO(merge): MongoDB soft-delete compatibility.
 *
 * On Postgres, an optional column that is never written is NULL, so
 * `where: { deletedAt: null }` matches it. On MongoDB, Prisma omits an
 * unset optional field entirely, and `deletedAt: null` matches ONLY
 * documents where null was explicitly written — an absent field needs
 * `deletedAt: { isSet: false }`. Measured:
 *
 *   deletedAt: null              -> only docs written with null
 *   deletedAt: { isSet: false }  -> only docs with the field absent
 *   OR of both                   -> everything
 *
 * The codebase has 233 `deletedAt: null` query sites across 39 files.
 * Rewriting reads would touch all of them; writing null once on create
 * restores Postgres semantics and leaves every read unchanged.
 */
const SOFT_DELETE_MODELS = new Set([
  'ClauseLibraryItem', 'Contract', 'ContractComment', 'ContractFieldDefinition',
  'ContractRequest', 'Counterparty', 'DiligenceRoom', 'Space', 'Skill',
  'Template', 'User', 'Webhook', 'WorkflowDefinition',
])

function withSoftDeleteNull<T extends PrismaClient>(client: T) {
  return client.$extends({
    query: {
      $allModels: {
        async create({ model, args, query }: any) {
          if (SOFT_DELETE_MODELS.has(model) && args?.data && !('deletedAt' in args.data)) {
            args.data.deletedAt = null
          }
          return query(args)
        },
        async createMany({ model, args, query }: any) {
          if (SOFT_DELETE_MODELS.has(model) && args?.data) {
            const rows = Array.isArray(args.data) ? args.data : [args.data]
            for (const row of rows) if (!('deletedAt' in row)) row.deletedAt = null
          }
          return query(args)
        },
      },
    },
  })
}

/**
 * TODO(merge): Postgres NULL semantics for every optional field, on MongoDB.
 *
 * Prisma on MongoDB compiles `where: { field: null }` to match only documents
 * where null was WRITTEN. A field that was never set is absent, and does not
 * match. On Postgres an unset optional column IS null, and matches. So every
 * `field: null` filter silently excludes rows that were created without that
 * field — the soft-delete extension above fixed this for `deletedAt` alone,
 * but the codebase compares 94 other optional fields to null:
 * `diligenceRoomId: null` hid every seeded contract from the contracts list,
 * and `revokedAt`, `archivedAt`, `spaceId` and `orgId: null` (platform-wide
 * rows) are all the same shape.
 *
 * This rewrites the query instead of the data, so it holds however a document
 * was written — upserts, nested creates, raw inserts, the Python tier. Every
 * `optionalField: null` (or `{ equals: null }`) becomes
 * `{ OR: [{ f: null }, { f: { isSet: false } }] }`, recursively through
 * AND / OR / NOT, relation filters (some / every / none / is / isNot), and the
 * `where` inside nested include / select. Installed only for MongoDB URLs:
 * `isSet` does not exist on Postgres, where the problem does not exist either.
 */
type FieldInfo = { optional: Set<string>; relations: Map<string, string> }
const MODEL_FIELDS = new Map<string, FieldInfo>(
  Prisma.dmmf.datamodel.models.map((m) => [
    m.name,
    {
      optional: new Set(
        m.fields
          .filter((f) => (f.kind === 'scalar' || f.kind === 'enum') && !f.isRequired && !f.isList)
          .map((f) => f.name),
      ),
      relations: new Map(m.fields.filter((f) => f.kind === 'object').map((f) => [f.name, f.type])),
    },
  ]),
)

const RELATION_FILTER_KEYS = ['some', 'every', 'none', 'is', 'isNot'] as const

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
}

function rewriteWhere(model: string, where: unknown): void {
  if (!isPlainObject(where)) return
  const info = MODEL_FIELDS.get(model)
  if (!info) return

  const nullOrUnset: Record<string, unknown>[] = []
  for (const [key, val] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      for (const clause of Array.isArray(val) ? val : [val]) rewriteWhere(model, clause)
      continue
    }
    if (info.optional.has(key)) {
      const isNullFilter = val === null || (isPlainObject(val) && Object.keys(val).length === 1 && val.equals === null)
      if (isNullFilter) {
        delete where[key]
        nullOrUnset.push({ OR: [{ [key]: null }, { [key]: { isSet: false } }] })
      }
      continue
    }
    const related = info.relations.get(key)
    if (related && isPlainObject(val)) {
      const nested = RELATION_FILTER_KEYS.filter((k) => k in val)
      if (nested.length > 0) for (const k of nested) rewriteWhere(related, val[k])
      else rewriteWhere(related, val) // to-one shorthand: relation: { field: ... }
    }
  }
  if (nullOrUnset.length > 0) {
    const existing = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND]
    where.AND = [...existing, ...nullOrUnset]
  }
}

function rewriteProjection(model: string, projection: unknown): void {
  if (!isPlainObject(projection)) return
  const info = MODEL_FIELDS.get(model)
  if (!info) return
  for (const [key, val] of Object.entries(projection)) {
    const related = key === '_count' ? undefined : info.relations.get(key)
    if (!related || !isPlainObject(val)) continue
    rewriteWhere(related, val.where)
    rewriteProjection(related, val.include)
    rewriteProjection(related, val.select)
  }
}

function withMongoNullSemantics<T extends PrismaClient>(client: T) {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, args, query }: any) {
          if (isPlainObject(args)) {
            rewriteWhere(model, args.where)
            rewriteProjection(model, args.include)
            rewriteProjection(model, args.select)
          }
          return query(args)
        },
      },
    },
  })
}

const IS_MONGO = /^mongodb(\+srv)?:\/\//i.test(process.env.DATABASE_URL ?? '')

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function makeClient() {
  const tunedUrl = withPoolLimit(process.env.DATABASE_URL)
  const client = new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
          ],
    datasources: tunedUrl ? { db: { url: tunedUrl } } : undefined,
  })

  // Production: structured slow-query log + error / warn surfacing.
  // In development we keep Prisma's default raw SQL output (more
  // useful when debugging an actual query).
  if (process.env.NODE_ENV !== 'development') {
    client.$on('query', (e: { query: string; params: string; duration: number; target: string }) => {
      if (e.duration >= SLOW_QUERY_MS) {
        log.warn({
          slowQuery: true,
          durationMs: e.duration,
          query: e.query.length > 500 ? e.query.slice(0, 500) + '…' : e.query,
          target: e.target,
        }, `slow query (${e.duration}ms)`)
      }
    })
    client.$on('error', (e: { message: string; target: string }) => {
      log.error({ prisma: true, target: e.target }, e.message)
    })
    client.$on('warn', (e: { message: string; target: string }) => {
      log.warn({ prisma: true, target: e.target }, e.message)
    })
  }
  return client
}

function buildClient(): PrismaClient {
  const base = withSoftDeleteNull(makeClient()) as unknown as PrismaClient
  return IS_MONGO ? (withMongoNullSemantics(base) as unknown as PrismaClient) : base
}

export const prisma = globalForPrisma.prisma ?? buildClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
