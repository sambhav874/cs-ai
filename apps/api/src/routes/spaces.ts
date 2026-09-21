/**
 * Spaces routes (P4.1 / docs/30 D.7.1)
 *
 * A Space groups contracts + requests + agent threads under one
 * negotiation. Surfaces as first-class nav unit; answers the
 * procurement-RFP "do you support spaces?" question with yes.
 *
 * Endpoints:
 *   GET    /api/v1/spaces             — list org's spaces (filterable)
 *   GET    /api/v1/spaces/:id         — detail + children counts
 *   POST   /api/v1/spaces             — create
 *   PATCH  /api/v1/spaces/:id         — update (rename, status, owner)
 *   DELETE /api/v1/spaces/:id         — soft-delete (children unlinked,
 *                                         spaceId → null on contracts /
 *                                         requests / threads)
 *
 * Design reference: Ironclad Spaces, Harvey Vault Projects,
 * Legal Files space-centric model.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../middleware/permissions.js'
import { prisma } from '../lib/prisma.js'

// Wave 1.7 — spaces group contracts; there is no dedicated SPACE permission
// resource, so space operations are gated on the corresponding CONTRACT
// permission (view to read, create to add, edit to change/attach, delete to
// remove). Previously the whole router was requireAuth-only, so a VIEWER could
// create, delete, and re-parent spaces.

const SPACE_STATUSES = ['OPEN', 'CLOSED', 'ARCHIVED'] as const

const CreateSpaceSchema = z.object({
  name:             z.string().min(1).max(200),
  description:      z.string().max(5_000).optional(),
  status:           z.enum(SPACE_STATUSES).default('OPEN'),
  counterpartyId:   z.string().optional(),
  counterpartyName: z.string().max(200).optional(),
  tags:             z.array(z.string().max(40)).max(20).default([]),
})

const UpdateSpaceSchema = CreateSpaceSchema.partial().extend({
  ownerId: z.string().optional(),
})

export async function spaceRoutes(app: FastifyInstance) {

  // ── GET /api/v1/spaces ────────────────────────────────────────────────
  app.get('/', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const { orgId } = req.user
    const q = z.object({
      status:  z.enum([...SPACE_STATUSES, 'all']).default('all'),
      ownerId: z.string().optional(),
      counterpartyName: z.string().optional(),
      limit:   z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query)

    const where: Record<string, unknown> = { orgId, deletedAt: null }
    if (q.status !== 'all')       where.status = q.status
    if (q.ownerId)                where.ownerId = q.ownerId
    if (q.counterpartyName)       where.counterpartyName = {
      contains: q.counterpartyName, mode: 'insensitive',
    }

    const spaces = await prisma.space.findMany({
      where: where as never,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: q.limit,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        counterparty: { select: { id: true, name: true } },
        _count: {
          select: { contracts: true, requests: true, threads: true },
        },
      },
    })
    return reply.send({
      items: spaces.map(m => ({
        id:               m.id,
        name:             m.name,
        description:      m.description,
        status:           m.status,
        counterpartyId:   m.counterpartyId,
        counterpartyName: m.counterpartyName ?? m.counterparty?.name ?? null,
        ownerId:          m.ownerId,
        ownerName:        m.owner?.name ?? null,
        tags:             m.tags,
        contractCount:    m._count.contracts,
        requestCount:     m._count.requests,
        threadCount:      m._count.threads,
        createdAt:        m.createdAt,
        updatedAt:        m.updatedAt,
        closedAt:         m.closedAt,
      })),
      total: spaces.length,
    })
  })

  // ── GET /api/v1/spaces/:id ────────────────────────────────────────────
  app.get('/:id', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const { orgId } = req.user
    const { id } = req.params as { id: string }
    const space = await prisma.space.findFirst({
      where: { id, orgId, deletedAt: null },
      include: {
        owner: { select: { id: true, name: true, email: true, avatarUrl: true } },
        counterparty: { select: { id: true, name: true, website: true } },
        contracts: {
          where: { deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true, title: true, type: true, status: true,
            value: true, currency: true, riskScore: true,
            counterpartyName: true, effectiveDate: true, expiryDate: true,
            updatedAt: true,
            // Whether the intelligence tier has read this contract yet. The
            // Space page shows it per row: a Space whose memory is thin is
            // usually a Space whose contracts have not been analysed.
            analysisStatus: true,
          },
        },
        requests: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, requestNumber: true, title: true, type: true,
            status: true, priority: true, counterpartyName: true,
            requestedById: true, assignedToId: true, createdAt: true,
          },
        },
        threads: {
          where: { archivedAt: null },
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true, title: true, scopeType: true, scopeId: true,
            userId: true, updatedAt: true,
          },
        },
      },
    })
    if (!space) return reply.status(404).send({ detail: 'Space not found' })
    return reply.send(space)
  })

  // ── POST /api/v1/spaces ───────────────────────────────────────────────
  app.post('/', { preHandler: requirePermission('create', 'contract') }, async (req, reply) => {
    const { orgId, sub: userId } = req.user
    let body
    try { body = CreateSpaceSchema.parse(req.body) }
    catch (err) {
      return reply.status(400).send({ detail: 'Invalid body', issues: (err as { issues?: unknown }).issues })
    }
    const space = await prisma.space.create({
      data: {
        orgId,
        name:             body.name,
        description:      body.description,
        status:           body.status,
        counterpartyId:   body.counterpartyId,
        counterpartyName: body.counterpartyName,
        tags:             body.tags,
        ownerId:          userId,
        createdById:      userId,
      },
    })
    return reply.status(201).send(space)
  })

  // ── PATCH /api/v1/spaces/:id ──────────────────────────────────────────
  app.patch('/:id', { preHandler: requirePermission('edit', 'contract') }, async (req, reply) => {
    const { orgId } = req.user
    const { id } = req.params as { id: string }
    let patch
    try { patch = UpdateSpaceSchema.parse(req.body) }
    catch (err) {
      return reply.status(400).send({ detail: 'Invalid body', issues: (err as { issues?: unknown }).issues })
    }
    const existing = await prisma.space.findFirst({
      where: { id, orgId, deletedAt: null },
      select: { id: true, status: true },
    })
    if (!existing) return reply.status(404).send({ detail: 'Space not found' })

    // If transitioning to CLOSED / ARCHIVED, stamp closedAt.
    const closedAt = (patch.status === 'CLOSED' || patch.status === 'ARCHIVED') && existing.status === 'OPEN'
      ? new Date()
      : undefined

    const updated = await prisma.space.update({
      where: { id },
      data: {
        ...patch,
        ...(closedAt ? { closedAt } : {}),
      },
    })
    return reply.send(updated)
  })

  // ── DELETE /api/v1/spaces/:id ─────────────────────────────────────────
  app.delete('/:id', { preHandler: requirePermission('delete', 'contract') }, async (req, reply) => {
    const { orgId } = req.user
    const { id } = req.params as { id: string }
    const existing = await prisma.space.findFirst({
      where: { id, orgId, deletedAt: null },
      select: { id: true },
    })
    if (!existing) return reply.status(404).send({ detail: 'Space not found' })

    // Soft-delete + unlink children (set spaceId back to null so the
    // contracts/requests/threads don't dangle).
    await prisma.$transaction([
      prisma.contract.updateMany({ where: { spaceId: id }, data: { spaceId: null } }),
      prisma.contractRequest.updateMany({ where: { spaceId: id }, data: { spaceId: null } }),
      prisma.agentThread.updateMany({ where: { spaceId: id }, data: { spaceId: null } }),
      prisma.space.update({ where: { id }, data: { deletedAt: new Date() } }),
    ])
    return reply.status(204).send()
  })

  // ── POST /api/v1/spaces/:id/attach — link a contract/request/thread ──
  app.post('/:id/attach', { preHandler: requirePermission('edit', 'contract') }, async (req, reply) => {
    const { orgId } = req.user
    const { id } = req.params as { id: string }
    const body = z.object({
      kind: z.enum(['contract', 'request', 'thread']),
      entityId: z.string().min(1),
    }).safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ detail: 'Invalid body', issues: body.error.issues })
    }
    const space = await prisma.space.findFirst({
      where: { id, orgId, deletedAt: null },
      select: { id: true },
    })
    if (!space) return reply.status(404).send({ detail: 'Space not found' })

    // Wave 1.3 — CRITICAL: scope the target entity by orgId. Previously this
    // updated ANY contract/request/thread by raw id with no org check, so a
    // user in org A could pull an org B record (whose id leaked via logs /
    // webhooks / a screenshot) into their space and read its metadata via
    // GET /spaces/:id. updateMany + count guards cross-org isolation.
    let result: { count: number }
    if (body.data.kind === 'contract') {
      result = await prisma.contract.updateMany({
        where: { id: body.data.entityId, orgId, deletedAt: null },
        data:  { spaceId: id },
      })
    } else if (body.data.kind === 'request') {
      result = await prisma.contractRequest.updateMany({
        where: { id: body.data.entityId, orgId, deletedAt: null },
        data:  { spaceId: id },
      })
    } else {
      result = await prisma.agentThread.updateMany({
        where: { id: body.data.entityId, orgId },
        data:  { spaceId: id },
      })
    }
    if (result.count === 0) {
      return reply.status(404).send({ detail: `${body.data.kind} not found in your organization` })
    }
    return reply.send({ ok: true, spaceId: id, kind: body.data.kind, entityId: body.data.entityId })
  })
}
