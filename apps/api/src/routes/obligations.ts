/**
 * Obligation routes (P8 Step 3).
 *
 *   GET  /api/v1/obligations
 *     Org-wide list with filters: status, type, severity, contractId,
 *     dueWithin (days), q (search description+contract title), sort.
 *     Returns paginated rows with contract context (title, status,
 *     counterparty) so the table can render a single page without
 *     N+1 fetches.
 *
 *   GET  /api/v1/obligations/:id
 *     Single obligation with full contract context (used by detail
 *     drawer + complete modal).
 *
 *   POST /api/v1/obligations/:id/complete   ← Step 4
 *
 *   GET  /api/v1/obligations/stats
 *     KPI counts: open, due-soon, overdue, completed (last 30d). Used
 *     by the page header.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { prisma } from '../lib/prisma.js'
import { requirePermission } from '../middleware/permissions.js'
import { s3, S3_BUCKET } from '../lib/storage.js'
import { createAuditEvent } from '../lib/audit.js'
import { AuditAction, nextDueDate, termsHeadline, consequenceLine, ObligationTermsSchema, type ObligationTerms } from '@clm/types'
import { buildCsv } from '../lib/csv.js'
import { fireWebhook } from '../lib/webhook-events.js'

const ListSchema = z.object({
  status:     z.enum(['OPEN', 'COMPLETED', 'OVERDUE', 'WAIVED', 'all']).default('all'),
  type:       z.string().optional(),
  severity:   z.enum(['low', 'medium', 'high']).optional(),
  contractId: z.string().optional(),
  dueWithin:  z.coerce.number().int().min(0).max(3650).optional(),
  /** "due_soon" → only items with dueDate inside next 30d (incl overdue) */
  bucket:     z.enum(['all', 'due_soon', 'overdue', 'open', 'completed']).default('all'),
  q:          z.string().optional(),
  sort:       z.enum(['dueDate', 'severity', 'createdAt']).default('dueDate'),
  order:      z.enum(['asc', 'desc']).default('asc'),
  limit:      z.coerce.number().int().min(1).max(100).default(50),
  offset:     z.coerce.number().int().min(0).default(0),
  /** A user id, "me", or "unassigned". */
  assignee:   z.string().trim().min(1).max(64).optional(),
  needsReview: z.enum(['true', 'false']).optional(),
})

type ListQuery = z.infer<typeof ListSchema>

/** Statuses that are still owed. */
const OWED = ['OPEN', 'OVERDUE']

function overdueFilter(now: Date) {
  return { OR: [{ status: 'OVERDUE' }, { status: 'OPEN', dueDate: { lt: now } }] }
}

/** The filter set shared by the list and its CSV export. */
function buildWhere(q: ListQuery, orgId: string, userId: string): Record<string, unknown> {
  const where: Record<string, unknown> = { orgId }
  if (q.status !== 'all') where.status = q.status
  if (q.type)             where.type = q.type
  if (q.severity)         where.severity = q.severity
  if (q.contractId)       where.contractId = q.contractId
  if (q.needsReview)      where.needsReview = q.needsReview === 'true'
  if (q.assignee === 'unassigned') where.assigneeId = null
  else if (q.assignee === 'me')    where.assigneeId = userId
  else if (q.assignee)             where.assigneeId = q.assignee

  // Bucket filters take precedence over raw status when set. A row can be
  // late two ways: stored as OVERDUE, or still OPEN past its due date. Both
  // count as overdue, and both are still owed, so both are "open" too —
  // previously a stored OVERDUE row matched no bucket at all.
  const now = new Date()
  const and: unknown[] = []
  if (q.bucket === 'due_soon') {
    where.status = 'OPEN'
    where.dueDate = { lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) }
  } else if (q.bucket === 'overdue') {
    delete where.status
    and.push(overdueFilter(now))
  } else if (q.bucket === 'open') {
    where.status = { in: OWED }
  } else if (q.bucket === 'completed') {
    where.status = 'COMPLETED'
  }
  if (and.length > 0) where.AND = and

  if (q.dueWithin != null) {
    const horizon = new Date(now.getTime() + q.dueWithin * 24 * 60 * 60 * 1000)
    where.dueDate = { ...(where.dueDate as object ?? {}), lte: horizon }
  }

  if (q.q) {
    // Search description + contract title (case-insensitive).
    where.OR = [
      { description: { contains: q.q, mode: 'insensitive' } },
      { contract: { is: { title: { contains: q.q, mode: 'insensitive' } } } },
    ]
  }
  return where
}

type FindArgs = { where: never; orderBy: never; skip: number; take: number }

/**
 * One page across an ordered list of disjoint buckets: every row of bucket 0,
 * then bucket 1, and so on, with the page window spanning the seams.
 *
 * Two orderings need it. Due date with undated rows LAST: Prisma's
 * `nulls: 'last'` exists only on relational connectors, and on MongoDB it is a
 * query error — the default obligations list failed outright. And severity,
 * which is stored as words, so a string sort gives "high" < "low" < "medium".
 */
async function findInBuckets<T>(
  buckets: Array<{ where: Record<string, unknown>; orderBy: object[] }>,
  skip: number,
  take: number,
  find: (args: FindArgs) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = []
  let offset = skip
  for (const bucket of buckets) {
    if (rows.length >= take) break
    const size = await prisma.obligation.count({ where: bucket.where as never })
    if (offset >= size) { offset -= size; continue }
    rows.push(...await find({
      where: bucket.where as never, orderBy: bucket.orderBy as never,
      skip: offset, take: take - rows.length,
    }))
    offset = 0
  }
  return rows
}

function dueDateBuckets(where: Record<string, unknown>, order: 'asc' | 'desc') {
  const byDue = [{ dueDate: order }, { createdAt: 'asc' }]
  // A due-date filter already excludes undated rows.
  if (where.dueDate) return [{ where, orderBy: byDue }]
  return [
    { where: { AND: [where, { dueDate: { not: null } }] }, orderBy: byDue },
    { where: { AND: [where, { dueDate: null }] },          orderBy: [{ createdAt: 'asc' }] },
  ]
}

function severityBuckets(where: Record<string, unknown>, order: 'asc' | 'desc') {
  const ranks = order === 'desc' ? ['high', 'medium', 'low'] : ['low', 'medium', 'high']
  const byDue = [{ dueDate: 'asc' }, { createdAt: 'asc' }]
  return [
    ...ranks.map(severity => ({ where: { AND: [where, { severity }] }, orderBy: byDue })),
    // Anything outside the vocabulary still shows, last.
    { where: { AND: [where, { severity: { notIn: ['high', 'medium', 'low'] } }] }, orderBy: byDue },
  ]
}

/**
 * Obligations inherit their contract's visibility: a role whose contract
 * permission is own-scoped sees only obligations on contracts it owns.
 */
function scopeFilter(req: { permissionScope?: string | null; user: { sub: string } }): Record<string, unknown> {
  return req.permissionScope === 'own' ? { contract: { is: { ownerId: req.user.sub } } } : {}
}

/** Stored terms, read defensively: a row written before terms existed has none. */
function parseTerms(raw: unknown): ObligationTerms | null {
  const parsed = ObligationTermsSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

const PERSON = { select: { id: true, name: true, email: true } } as const

/** An assignee must be an active member of the same org. */
async function assertAssignable(orgId: string, assigneeId: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { id: assigneeId, orgId, status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  })
  return !!user
}

const UpdateSchema = z.object({
  assigneeId: z.string().trim().min(1).max(64).nullable().optional(),
  dueDate:    z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable().optional(),
  recurrence: z.enum(['one-time', 'daily', 'weekly', 'monthly', 'quarterly', 'annually', 'on-event', 'unknown']).optional(),
  trigger:    z.string().trim().max(1000).nullable().optional(),
  severity:   z.enum(['low', 'medium', 'high']).optional(),
  needsReview: z.boolean().optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'Nothing to update' })

const BulkAssignSchema = z.object({
  ids:        z.array(z.string().trim().min(1).max(64)).min(1).max(500),
  assigneeId: z.string().trim().min(1).max(64).nullable(),
})

export async function obligationRoutes(app: FastifyInstance) {
  // ── GET / ──────────────────────────────────────────────────────────────
  app.get('/', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    let q
    try { q = ListSchema.parse(req.query as Record<string, unknown>) }
    catch (err) {
      return reply.status(400).send({ detail: 'Invalid query', issues: (err as { issues?: unknown }).issues })
    }
    const { orgId, sub: userId } = req.user
    const where = { ...buildWhere(q, orgId, userId), ...scopeFilter(req) }
    const include = {
      contract: {
        select: { id: true, title: true, status: true, type: true, counterpartyName: true },
      },
      completedBy: PERSON,
      assignee:    PERSON,
    }

    const findPage = (args: FindArgs) => prisma.obligation.findMany({ ...args, include })
    const items = q.sort === 'dueDate'
      ? await findInBuckets(dueDateBuckets(where, q.order), q.offset, q.limit, findPage)
      : q.sort === 'severity'
        ? await findInBuckets(severityBuckets(where, q.order), q.offset, q.limit, findPage)
        : await findPage({ where: where as never, orderBy: [{ createdAt: q.order }] as never, skip: q.offset, take: q.limit })
    const total = await prisma.obligation.count({ where: where as never })

    return reply.send({
      data: items,
      total,
      limit: q.limit,
      offset: q.offset,
    })
  })

  // ── GET /export — CSV download (P9 Step 7) ─────────────────────────
  // Mirrors the GET / filter set so users can export exactly what
  // they're seeing on screen.
  app.get('/export', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const format = ((req.query as { format?: string }).format ?? 'csv').toLowerCase()
    if (format !== 'csv') return reply.status(400).send({ detail: 'Only csv is supported' })
    let q
    try { q = ListSchema.parse(req.query as Record<string, unknown>) }
    catch (err) {
      return reply.status(400).send({ detail: 'Invalid query', issues: (err as { issues?: unknown }).issues })
    }
    const { orgId, sub: userId } = req.user
    const where = { ...buildWhere(q, orgId, userId), ...scopeFilter(req) }
    const items = await findInBuckets(dueDateBuckets(where, 'asc'), 0, 5_000, args =>
      prisma.obligation.findMany({
        ...args,
        include: {
          contract: { select: { id: true, title: true, counterpartyName: true, type: true } },
          completedBy: { select: { name: true, email: true } },
          assignee:    { select: { name: true, email: true } },
        },
      }))

    const headers = [
      'Type', 'Description', 'Requirement', 'Consequence', 'Party', 'Assignee', 'Severity', 'Recurrence', 'Section', 'Page',
      'Due Date', 'Status', 'Contract', 'Counterparty', 'Contract Type',
      'Completed At', 'Completed By', 'Completion Note', 'Has Evidence',
    ]
    const rows = items.map(o => [
      o.type, o.description,
      termsHeadline(parseTerms(o.terms)) ?? '', consequenceLine(parseTerms(o.terms)) ?? '',
      o.owner, o.assignee?.email ?? '', o.severity, o.recurrence, o.sectionRef ?? '',
      o.page != null ? String(o.page) : '',
      o.dueDate?.toISOString().slice(0, 10) ?? '',
      o.status,
      o.contract?.title ?? '',
      o.contract?.counterpartyName ?? '',
      o.contract?.type ?? '',
      o.completedAt?.toISOString().slice(0, 19).replace('T', ' ') ?? '',
      o.completedBy?.email ?? '',
      o.completionNote ?? '',
      o.evidenceS3Key ? 'yes' : 'no',
    ])
    const csv = buildCsv(headers, rows)
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="obligations-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(csv)
  })

  // ── GET /stats — KPI numbers for the page header ──────────────────────
  app.get('/stats', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const { orgId } = req.user
    const scope = scopeFilter(req)
    const now = new Date()
    const dueSoonHorizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    const recentCompletedSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const [open, dueSoon, overdue, completedRecent, unassigned] = await Promise.all([
      prisma.obligation.count({ where: { orgId, ...scope, status: { in: OWED } } }),
      prisma.obligation.count({
        where: { orgId, ...scope, status: 'OPEN', dueDate: { gte: now, lte: dueSoonHorizon } },
      }),
      prisma.obligation.count({ where: { orgId, ...scope, ...overdueFilter(now) } as never }),
      prisma.obligation.count({
        where: { orgId, ...scope, status: 'COMPLETED', completedAt: { gte: recentCompletedSince } },
      }),
      prisma.obligation.count({ where: { orgId, ...scope, status: { in: OWED }, assigneeId: null } }),
    ])

    return reply.send({ open, dueSoon, overdue, completedRecent, unassigned })
  })

  // ── POST /bulk-assign — one owner for many obligations ────────────────
  // A logistics MSA yields dozens of records; assigning one at a time is not
  // usable. `assigneeId: null` unassigns. Ids outside the org are ignored
  // (never an error that would confirm they exist elsewhere).
  app.post('/bulk-assign', { preHandler: requirePermission('edit', 'contract') }, async (req, reply) => {
    const parsed = BulkAssignSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ detail: 'Invalid request', issues: parsed.error.issues })
    const { ids, assigneeId } = parsed.data
    const { orgId, sub: userId } = req.user
    if (assigneeId && !await assertAssignable(orgId, assigneeId)) {
      return reply.status(422).send({ detail: 'Assignee must be an active member of this organisation' })
    }

    const targets = await prisma.obligation.findMany({
      where:  { id: { in: [...new Set(ids)] }, orgId, ...scopeFilter(req) },
      select: { id: true, contractId: true, assigneeId: true },
    })
    // Only rows whose assignee actually changes get an event.
    const changing = targets.filter(t => t.assigneeId !== assigneeId)
    if (changing.length === 0) return reply.send({ updated: 0 })
    await prisma.obligation.updateMany({
      where: { id: { in: changing.map(t => t.id) }, orgId },
      data:  { assigneeId, assignedAt: assigneeId ? new Date() : null },
    })
    await prisma.obligationEvent.createMany({
      data: changing.map(t => ({
        orgId, obligationId: t.id, contractId: t.contractId, actorId: userId,
        kind: assigneeId ? 'assigned' : 'unassigned',
        data: { from: t.assigneeId, to: assigneeId, bulk: true },
      })),
    })

    const byContract = new Map<string, string[]>()
    for (const t of changing) byContract.set(t.contractId, [...(byContract.get(t.contractId) ?? []), t.id])
    for (const [contractId, obligationIds] of byContract) {
      await createAuditEvent({
        orgId, userId,
        action: AuditAction.OBLIGATION_ASSIGNED,
        resourceType: 'contract', resourceId: contractId,
        metadata: { obligationIds, assigneeId, bulk: true },
      })
    }
    return reply.send({ updated: changing.length })
  })

  // ── PATCH /:id — assignee, due date, recurrence, trigger, severity ────
  // These are the fields a person owns; a re-extraction never overwrites them.
  app.patch('/:id', { preHandler: requirePermission('edit', 'contract') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = UpdateSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ detail: 'Invalid request', issues: parsed.error.issues })
    const body = parsed.data
    const { orgId, sub: userId } = req.user

    const existing = await prisma.obligation.findFirst({
      where:  { id, orgId, ...scopeFilter(req) },
      select: { id: true, contractId: true, assigneeId: true, dueDate: true, recurrence: true, severity: true, trigger: true },
    })
    if (!existing) return reply.status(404).send({ detail: 'Obligation not found' })
    if (body.assigneeId && !await assertAssignable(orgId, body.assigneeId)) {
      return reply.status(422).send({ detail: 'Assignee must be an active member of this organisation' })
    }

    const data: Record<string, unknown> = {}
    const events: Array<{ kind: string; data: Record<string, unknown> }> = []
    if (body.assigneeId !== undefined && body.assigneeId !== existing.assigneeId) {
      data.assigneeId = body.assigneeId
      data.assignedAt = body.assigneeId ? new Date() : null
      events.push({ kind: body.assigneeId ? 'assigned' : 'unassigned', data: { from: existing.assigneeId, to: body.assigneeId } })
    }
    if (body.dueDate !== undefined) {
      const next = body.dueDate ? new Date(body.dueDate) : null
      if ((next?.getTime() ?? null) !== (existing.dueDate?.getTime() ?? null)) {
        data.dueDate = next
        // A new date is a new deadline: let the reminder scan notify afresh,
        // and let the next roll re-anchor on the day a person chose.
        data.notifiedAt = null
        data.anchorDay = null
        events.push({ kind: 'due_changed', data: { from: existing.dueDate?.toISOString() ?? null, to: next?.toISOString() ?? null } })
      }
    }
    const changed: Record<string, { from: unknown; to: unknown }> = {}
    if (body.recurrence !== undefined && body.recurrence !== existing.recurrence) {
      data.recurrence = body.recurrence; changed.recurrence = { from: existing.recurrence, to: body.recurrence }
    }
    if (body.trigger !== undefined && body.trigger !== existing.trigger) {
      data.trigger = body.trigger; changed.trigger = { from: existing.trigger, to: body.trigger }
    }
    if (body.severity !== undefined && body.severity !== existing.severity) {
      data.severity = body.severity; changed.severity = { from: existing.severity, to: body.severity }
    }
    if (body.needsReview !== undefined) data.needsReview = body.needsReview
    if (Object.keys(changed).length > 0) events.push({ kind: 'updated', data: changed })

    const updated = await prisma.obligation.update({
      where: { id },
      data:  data as never,
      include: { assignee: PERSON, completedBy: PERSON },
    })
    if (events.length > 0) {
      await prisma.obligationEvent.createMany({
        data: events.map(e => ({ orgId, obligationId: id, contractId: existing.contractId, actorId: userId, kind: e.kind, data: e.data as never })),
      })
    }

    const assigned = events.some(e => e.kind === 'assigned' || e.kind === 'unassigned')
    if (events.length > 0 || body.needsReview !== undefined) {
      await createAuditEvent({
        orgId, userId,
        action: assigned ? AuditAction.OBLIGATION_ASSIGNED : AuditAction.OBLIGATION_UPDATED,
        resourceType: 'contract', resourceId: existing.contractId,
        metadata: {
          obligationId: id,
          changed: Object.keys(body),
          ...(assigned && { assigneeId: body.assigneeId, previousAssigneeId: existing.assigneeId }),
        },
      })
    }
    return reply.send(updated)
  })

  // ── GET /:id — single obligation with contract context ────────────────
  app.get('/:id', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { orgId } = req.user
    const o = await prisma.obligation.findFirst({
      where: { id, orgId, ...scopeFilter(req) },
      include: {
        contract: { select: { id: true, title: true, status: true, type: true, counterpartyName: true, ownerId: true, owner: { select: { name: true, email: true } } } },
        completedBy: PERSON,
        assignee:    PERSON,
      },
    })
    if (!o) return reply.status(404).send({ detail: 'Obligation not found' })
    return reply.send(o)
  })

  // ── GET /:id/events — the obligation's history, newest first ──────────
  app.get('/:id/events', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { orgId } = req.user
    const o = await prisma.obligation.findFirst({ where: { id, orgId, ...scopeFilter(req) }, select: { id: true, createdAt: true, source: true } })
    if (!o) return reply.status(404).send({ detail: 'Obligation not found' })
    const events = await prisma.obligationEvent.findMany({
      where:   { obligationId: id, orgId },
      orderBy: { createdAt: 'desc' },
      take:    200,
    })
    const actorIds = [...new Set(events.map(e => e.actorId).filter((x): x is string => !!x))]
    const peopleIds = [...new Set(events.flatMap(e => {
      const d = (e.data ?? {}) as Record<string, unknown>
      return [d.from, d.to].filter((x): x is string => typeof x === 'string' && !x.includes('T'))
    }))]
    const people = await prisma.user.findMany({
      where:  { id: { in: [...new Set([...actorIds, ...peopleIds])] }, orgId },
      select: { id: true, name: true, email: true },
    })
    const byId = new Map(people.map(p => [p.id, p]))
    return reply.send({
      data: events.map(e => ({
        ...e,
        actor: e.actorId ? byId.get(e.actorId) ?? null : null,
        hasEvidence: !!e.evidenceS3Key,
        evidenceS3Key: undefined,
      })),
      people: Object.fromEntries(people.map(p => [p.id, { name: p.name, email: p.email }])),
      origin: { createdAt: o.createdAt, source: o.source },
    })
  })

  // ── POST /:id/notes — a note on the obligation's history ──────────────
  app.post('/:id/notes', { preHandler: requirePermission('edit', 'contract') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = NoteSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ detail: 'A note of 1–4000 characters is required' })
    const { orgId, sub: userId } = req.user
    const o = await prisma.obligation.findFirst({ where: { id, orgId, ...scopeFilter(req) }, select: { id: true, contractId: true } })
    if (!o) return reply.status(404).send({ detail: 'Obligation not found' })
    const event = await prisma.obligationEvent.create({
      data: { orgId, obligationId: id, contractId: o.contractId, actorId: userId, kind: 'note', note: parsed.data.note },
    })
    return reply.status(201).send(event)
  })

  // ── POST /:id/complete ────────────────────────────────────────────────
  // Discharge the obligation, with optional evidence file + note.
  // Multipart: file (optional), note (optional); or JSON { note }.
  //
  // One-off obligations become COMPLETED. A recurring obligation with a due
  // date is one row that rolls: this period is recorded as a completion event
  // (with its evidence) and the due date moves to the next period, still OPEN.
  app.post('/:id/complete', { preHandler: requirePermission('edit', 'contract') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { orgId, sub: userId } = req.user

    const existing = await prisma.obligation.findFirst({
      where: { id, orgId, ...scopeFilter(req) },
      select: { id: true, contractId: true, type: true, description: true, status: true, dueDate: true, recurrence: true, anchorDay: true },
    })
    if (!existing) return reply.status(404).send({ detail: 'Obligation not found' })
    if (existing.status === 'COMPLETED' || existing.status === 'WAIVED') {
      return reply.status(409).send({ detail: `Already ${existing.status.toLowerCase()}` })
    }

    let note = ''
    let fileBuffer: Buffer | null = null
    let mimeType = ''
    let filename = ''

    const ct = req.headers['content-type'] ?? ''
    if (ct.startsWith('multipart/')) {
      const parts = req.parts()
      for await (const part of parts) {
        if (part.type === 'file') {
          const chunks: Buffer[] = []
          for await (const chunk of part.file) chunks.push(chunk)
          fileBuffer = Buffer.concat(chunks)
          mimeType   = part.mimetype || 'application/octet-stream'
          filename   = part.filename || 'evidence.bin'
        } else if (part.fieldname === 'note') {
          note = String((part as { value?: unknown }).value ?? '').slice(0, 4000)
        }
      }
    } else {
      const body = (req.body ?? {}) as { note?: string }
      note = (body.note ?? '').slice(0, 4000)
    }

    let evidenceS3Key: string | null = null
    if (fileBuffer) {
      // Cap evidence file size at 25MB — generous for invoices/receipts but
      // protects S3 + the email reminder pipeline (some senders block >10MB).
      if (fileBuffer.byteLength > 25 * 1024 * 1024) {
        return reply.status(413).send({ detail: 'Evidence file too large (25MB max)' })
      }
      evidenceS3Key = `${orgId}/obligations/${id}/${Date.now()}-${filename.replace(/[^\x20-\x7E]/g, '').slice(0, 200)}`
      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key:    evidenceS3Key,
        Body:   fileBuffer,
        ContentType: mimeType,
      }))
    }
    const evidence = {
      evidenceS3Key,
      evidenceFilename: fileBuffer ? filename : null,
      evidenceMimeType: fileBuffer ? mimeType : null,
      evidenceSize:     fileBuffer ? fileBuffer.byteLength : null,
    }

    const completedAt = new Date()
    const next = existing.dueDate ? nextDueDate(existing.dueDate, existing.recurrence, existing.anchorDay ?? undefined) : null
    const rolls = next !== null

    // Conditional on still being owed, so a double-submit discharges once.
    const claimed = await prisma.obligation.updateMany({
      where: { id, orgId, status: { in: OWED }, ...(existing.dueDate ? { dueDate: existing.dueDate } : {}) },
      data: rolls
        ? {
            status: 'OPEN', dueDate: next, notifiedAt: null,
            // The month-end anchor survives a short month: "31st, monthly".
            anchorDay: existing.anchorDay ?? existing.dueDate!.getUTCDate(),
            completedAt, completedById: userId, completionNote: note || null, ...evidence,
          }
        : { status: 'COMPLETED', completedAt, completedById: userId, completionNote: note || null, ...evidence },
    })
    if (claimed.count === 0) return reply.status(409).send({ detail: 'This obligation was just updated — refresh and try again' })

    await prisma.obligationEvent.create({
      data: {
        orgId, obligationId: id, contractId: existing.contractId, actorId: userId,
        kind: 'completed', note: note || null, periodDue: existing.dueDate, ...evidence,
        data: rolls ? { nextDueDate: next!.toISOString(), recurrence: existing.recurrence } : {},
      },
    })
    await createAuditEvent({
      orgId, userId,
      action: AuditAction.OBLIGATION_COMPLETED,
      resourceType: 'contract', resourceId: existing.contractId,
      metadata: {
        obligationId: id, type: existing.type,
        hasEvidence: !!evidenceS3Key, hasNote: !!note,
        periodDue: existing.dueDate?.toISOString() ?? null,
        ...(rolls && { nextDueDate: next!.toISOString() }),
      },
    })
    fireWebhook(orgId, 'obligation.completed', {
      obligationId: id, contractId: existing.contractId,
      type: existing.type, completedAt: completedAt.toISOString(),
      hasEvidence: !!evidenceS3Key,
      periodDue: existing.dueDate?.toISOString() ?? null,
      nextDueDate: next?.toISOString() ?? null,
    })

    const updated = await prisma.obligation.findUniqueOrThrow({
      where: { id },
      include: { completedBy: PERSON, assignee: PERSON, contract: { select: { id: true, title: true } } },
    })
    return reply.send({ ...updated, rolledTo: next?.toISOString() ?? null })
  })

  // ── POST /:id/waive — owed no longer, and why ─────────────────────────
  // A contract amendment, a counterparty release, a clause that does not
  // apply. Distinct from completion: nothing was delivered, and the reason is
  // mandatory so the register can be audited.
  app.post('/:id/waive', { preHandler: requirePermission('edit', 'contract') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = WaiveSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ detail: 'A reason is required to waive an obligation' })
    const { orgId, sub: userId } = req.user
    const existing = await prisma.obligation.findFirst({ where: { id, orgId, ...scopeFilter(req) }, select: { id: true, contractId: true, status: true } })
    if (!existing) return reply.status(404).send({ detail: 'Obligation not found' })

    const claimed = await prisma.obligation.updateMany({
      where: { id, orgId, status: { in: OWED } },
      data:  { status: 'WAIVED', completionNote: parsed.data.reason, completedById: userId, completedAt: new Date() },
    })
    if (claimed.count === 0) return reply.status(409).send({ detail: `Obligation is ${existing.status.toLowerCase()}, not open` })
    await prisma.obligationEvent.create({
      data: { orgId, obligationId: id, contractId: existing.contractId, actorId: userId, kind: 'waived', note: parsed.data.reason },
    })
    await createAuditEvent({
      orgId, userId,
      action: AuditAction.OBLIGATION_UPDATED,
      resourceType: 'contract', resourceId: existing.contractId,
      metadata: { obligationId: id, event: 'waived', reason: parsed.data.reason },
    })
    return reply.send(await prisma.obligation.findUniqueOrThrow({ where: { id }, include: { assignee: PERSON, completedBy: PERSON } }))
  })

  // ── GET /:id/evidence — presigned download URL ────────────────────────
  // Latest evidence on the row, or a specific completion's with ?eventId=.
  app.get('/:id/evidence', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { eventId } = req.query as { eventId?: string }
    const { orgId } = req.user
    const o = await prisma.obligation.findFirst({
      where: { id, orgId, ...scopeFilter(req) },
      select: { evidenceS3Key: true, evidenceFilename: true, evidenceMimeType: true },
    })
    if (!o) return reply.status(404).send({ detail: 'Obligation not found' })
    const src = eventId
      ? await prisma.obligationEvent.findFirst({
          where:  { id: eventId, obligationId: id, orgId },
          select: { evidenceS3Key: true, evidenceFilename: true, evidenceMimeType: true },
        })
      : o
    if (!src?.evidenceS3Key) return reply.status(404).send({ detail: 'No evidence on this obligation' })

    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key:    src.evidenceS3Key,
      ResponseContentDisposition: `attachment; filename="${(src.evidenceFilename ?? 'evidence').replace(/"/g, '')}"`,
    }), { expiresIn: 600 })

    return reply.send({ url, filename: src.evidenceFilename, mimeType: src.evidenceMimeType })
  })

  // ── POST /:id/reopen — undo a completion or a waiver ──────────────────
  // For a one-off obligation. A recurring one never closes (it rolls), so
  // there is nothing to reopen; a mistaken period is corrected by moving the
  // due date back.
  app.post('/:id/reopen', { preHandler: requirePermission('edit', 'contract') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { orgId, sub: userId } = req.user
    const existing = await prisma.obligation.findFirst({
      where: { id, orgId, ...scopeFilter(req) },
      select: { id: true, contractId: true, status: true },
    })
    if (!existing) return reply.status(404).send({ detail: 'Obligation not found' })
    const claimed = await prisma.obligation.updateMany({
      where: { id, orgId, status: { in: ['COMPLETED', 'WAIVED'] } },
      data: {
        status: 'OPEN',
        completedAt: null, completedById: null, completionNote: null,
        // Evidence file is retained on S3 and on the completion event for
        // audit; the row just stops pointing at it.
        evidenceS3Key: null, evidenceFilename: null, evidenceMimeType: null, evidenceSize: null,
      },
    })
    if (claimed.count === 0) return reply.status(409).send({ detail: 'Obligation is not completed or waived' })
    await prisma.obligationEvent.create({
      data: { orgId, obligationId: id, contractId: existing.contractId, actorId: userId, kind: 'reopened', data: { from: existing.status } },
    })
    await createAuditEvent({
      orgId, userId,
      action: AuditAction.OBLIGATION_REOPENED,
      resourceType: 'contract', resourceId: existing.contractId,
      metadata: { obligationId: id, from: existing.status },
    })
    return reply.send(await prisma.obligation.findUniqueOrThrow({ where: { id }, include: { assignee: PERSON, completedBy: PERSON } }))
  })
}

const NoteSchema = z.object({ note: z.string().trim().min(1).max(4000) })
const WaiveSchema = z.object({ reason: z.string().trim().min(3).max(1000) })
