import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AuditAction } from '@clm/types'
import { prisma } from '../lib/prisma.js'
import { requirePermission } from '../middleware/permissions.js'
import { verifyAuditChain } from '../lib/audit.js'
import { buildCsv } from '../lib/csv.js'

// Admin → Audit log. Every state change writes an AuditEvent (release gate:
// "every state change writes an audit event with a resolvable actor"); these
// routes let an org admin read, filter, export and verify them. Read-only:
// the log is append-only and nothing here edits or deletes a row.

const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const ListQuery = z.object({
  action:       z.string().max(400).optional(),   // comma-separated
  resourceType: z.string().max(60).optional(),
  resourceId:   z.string().max(120).optional(),
  userId:       z.string().max(120).optional(),
  from:         DateOnly.optional(),                // inclusive
  to:           DateOnly.optional(),                // inclusive
  cursor:       z.string().max(120).optional(),
  limit:        z.coerce.number().int().min(1).max(100).default(50),
})

type ListFilters = z.infer<typeof ListQuery>

const EXPORT_MAX = 10_000

function whereFor(orgId: string, q: Omit<ListFilters, 'cursor' | 'limit'>): Record<string, unknown> {
  const where: Record<string, unknown> = { orgId }
  const actions = q.action?.split(',').map(s => s.trim()).filter(Boolean) ?? []
  if (actions.length) where.action = { in: actions }
  if (q.resourceType) where.resourceType = q.resourceType
  if (q.resourceId)   where.resourceId = q.resourceId
  if (q.userId)       where.userId = q.userId
  if (q.from || q.to) {
    where.createdAt = {
      ...(q.from && { gte: new Date(`${q.from}T00:00:00.000Z`) }),
      ...(q.to   && { lte: new Date(`${q.to}T23:59:59.999Z`) }),
    }
  }
  return where
}

/** Actor names for a page of events. System events (no userId) stay null. */
async function actorsFor(orgId: string, userIds: (string | null)[]) {
  const ids = [...new Set(userIds.filter((u): u is string => !!u))]
  if (!ids.length) return new Map<string, { id: string; name: string; email: string }>()
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, orgId },
    select: { id: true, name: true, email: true },
  })
  return new Map(users.map(u => [u.id, u]))
}

/** A spreadsheet treats a leading = + - @ as a formula; neutralise it. */
function safeCell(v: unknown): unknown {
  return typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
}

export async function adminAuditRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: requirePermission('configure', 'organization') }

  // ── GET /admin/audit — newest first, cursor-paged ───────────────────────
  app.get('/', guard, async (req, reply) => {
    const parsed = ListQuery.safeParse(req.query)
    if (!parsed.success) return reply.status(400).send({ detail: 'Invalid query', issues: parsed.error.issues })
    const { cursor, limit, ...filters } = parsed.data
    const { orgId } = req.user

    const rows = await prisma.auditEvent.findMany({
      where: whereFor(orgId, filters) as never,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      select: {
        id: true, userId: true, action: true, resourceType: true, resourceId: true,
        metadata: true, ipAddress: true, createdAt: true, hash: true,
      },
    })
    const page = rows.slice(0, limit)
    const actors = await actorsFor(orgId, page.map(r => r.userId))
    return reply.send({
      data: page.map(r => ({ ...r, actor: r.userId ? actors.get(r.userId) ?? null : null })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    })
  })

  // ── GET /admin/audit/filters — values for the filter dropdowns ──────────
  app.get('/filters', guard, async (req, reply) => {
    const { orgId } = req.user
    const [resourceTypes, users] = await Promise.all([
      prisma.auditEvent.findRaw({ filter: { orgId }, options: { projection: { resourceType: 1, _id: 0 }, sort: { createdAt: -1 }, limit: 5000 } }),
      prisma.user.findMany({ where: { orgId }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
    ])
    const types = [...new Set((resourceTypes as unknown as { resourceType?: string }[]).map(r => r.resourceType).filter(Boolean))].sort()
    return reply.send({ actions: Object.values(AuditAction).sort(), resourceTypes: types, users })
  })

  // ── GET /admin/audit/export — CSV of the filtered log ───────────────────
  app.get('/export', guard, async (req, reply) => {
    const parsed = ListQuery.omit({ cursor: true, limit: true }).safeParse(req.query)
    if (!parsed.success) return reply.status(400).send({ detail: 'Invalid query', issues: parsed.error.issues })
    const { orgId } = req.user
    const rows = await prisma.auditEvent.findMany({
      where: whereFor(orgId, parsed.data) as never,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_MAX,
    })
    const actors = await actorsFor(orgId, rows.map(r => r.userId))
    const csv = buildCsv(
      ['createdAt', 'action', 'resourceType', 'resourceId', 'actorName', 'actorEmail', 'ipAddress', 'metadata', 'hash'],
      rows.map(r => {
        const a = r.userId ? actors.get(r.userId) : undefined
        return [
          r.createdAt.toISOString(), r.action, r.resourceType, r.resourceId,
          a?.name ?? (r.userId ? r.userId : 'system'), a?.email ?? '', r.ipAddress ?? '',
          JSON.stringify(r.metadata ?? {}), r.hash ?? '',
        ].map(safeCell)
      }),
    )
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`)
    return reply.send(csv)
  })

  // ── GET /admin/audit/verify — re-check the tamper-evident hash chain ────
  app.get('/verify', guard, async (req, reply) => {
    return reply.send(await verifyAuditChain(req.user.orgId))
  })
}
