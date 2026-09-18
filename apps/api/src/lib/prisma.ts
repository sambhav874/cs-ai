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
import { PrismaClient } from '@prisma/client'
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
  'ContractRequest', 'Counterparty', 'DiligenceRoom', 'Matter', 'Skill',
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

export const prisma = globalForPrisma.prisma ?? (withSoftDeleteNull(makeClient()) as unknown as PrismaClient)

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
