/**
 * Clause Library API — Phase 4.1
 *
 * CRUD for clause categories (tree) and clause library items.
 * Clauses are reusable contract language snippets organized by category.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requirePermission } from '../middleware/permissions.js'

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateCategorySchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  parentCategoryId: z.string().nullable().optional(),
  sortOrder: z.number().int().default(0),
})

const UpdateCategorySchema = CreateCategorySchema.partial()

const CreateClauseSchema = z.object({
  categoryId: z.string().min(1),
  title: z.string().min(1).max(256),
  content: z.string().default(''),
  tags: z.array(z.string()).default([]),
  riskRating: z.enum(['favorable', 'unfavorable', 'neutral', 'standard']).nullish(),
  isApproved: z.boolean().default(false),
})

const UpdateClauseSchema = CreateClauseSchema.partial().omit({ categoryId: true })

// ─── Route Handlers ─────────────────────────────────────────────────────────

export async function clauseRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════════════════════
  // CLAUSE CATEGORIES
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Get full category tree ────────────────────────────────────────────────
  app.get('/categories', { preHandler: requirePermission('view', 'clause') }, async (req, reply) => {
    const { orgId } = req.user

    const categories = await prisma.clauseCategory.findMany({
      where: { orgId },
      orderBy: [{ parentCategoryId: 'asc' }, { sortOrder: 'asc' }],
    })

    // Build tree structure
    const map = new Map(categories.map(c => [c.id, { ...c, children: [] as any[] }]))
    const roots: any[] = []

    for (const cat of map.values()) {
      if (cat.parentCategoryId) {
        const parent = map.get(cat.parentCategoryId)
        if (parent) parent.children.push(cat)
      } else {
        roots.push(cat)
      }
    }

    return reply.send({ data: roots })
  })

  // ── Create category ───────────────────────────────────────────────────────
  app.post('/categories', { preHandler: requirePermission('create', 'clause') }, async (req, reply) => {
    const { orgId } = req.user
    const body = CreateCategorySchema.parse(req.body)

    const category = await prisma.clauseCategory.create({
      data: { orgId, ...body },
    })

    return reply.status(201).send(category)
  })

  // ── Update category ───────────────────────────────────────────────────────
  app.patch('/categories/:id', { preHandler: requirePermission('edit', 'clause') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { orgId } = req.user
    const body = UpdateCategorySchema.parse(req.body)

    const existing = await prisma.clauseCategory.findFirst({ where: { id, orgId } })
    if (!existing) return reply.status(404).send({ detail: 'Category not found' })

    const updated = await prisma.clauseCategory.update({ where: { id }, data: body })
    return reply.send(updated)
  })

  // ── Delete category ───────────────────────────────────────────────────────
  app.delete('/categories/:id', { preHandler: requirePermission('delete', 'clause') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { orgId } = req.user

    const existing = await prisma.clauseCategory.findFirst({ where: { id, orgId } })
    if (!existing) return reply.status(404).send({ detail: 'Category not found' })

    // Prevent deletion if category has items or children
    const childCount = await prisma.clauseCategory.count({ where: { parentCategoryId: id } })
    const itemCount = await prisma.clauseLibraryItem.count({ where: { categoryId: id, deletedAt: null } })

    if (childCount > 0 || itemCount > 0) {
      return reply.status(409).send({
        detail: `Cannot delete category with ${childCount} sub-categories and ${itemCount} clauses`,
      })
    }

    await prisma.clauseCategory.delete({ where: { id } })
    return reply.status(204).send()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CLAUSE LIBRARY ITEMS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── List clauses ──────────────────────────────────────────────────────────
  app.get('/', { preHandler: requirePermission('view', 'clause') }, async (req, reply) => {
    const { orgId } = req.user
    const query = req.query as {
      categoryId?: string
      tag?: string
      riskRating?: string
      approved?: string
      q?: string
      limit?: string
      offset?: string
    }

    const where: any = {
      orgId,
      deletedAt: null,
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.riskRating && { riskRating: query.riskRating }),
      ...(query.approved !== undefined && { isApproved: query.approved === 'true' }),
      ...(query.tag && { tags: { has: query.tag } }),
      ...(query.q && {
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { content: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    }

    const [clauses, total] = await Promise.all([
      prisma.clauseLibraryItem.findMany({
        where,
        include: { category: { select: { id: true, name: true } } },
        orderBy: [{ categoryId: 'asc' }, { title: 'asc' }],
        take: Number(query.limit ?? 100),
        skip: Number(query.offset ?? 0),
      }),
      prisma.clauseLibraryItem.count({ where }),
    ])

    return reply.send({ data: clauses, total })
  })

  // ── Get single clause ─────────────────────────────────────────────────────
  app.get('/:id', { preHandler: requirePermission('view', 'clause') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { orgId } = req.user

    const clause = await prisma.clauseLibraryItem.findFirst({
      where: { id, orgId, deletedAt: null },
      include: { category: { select: { id: true, name: true } } },
    })

    if (!clause) return reply.status(404).send({ detail: 'Clause not found' })
    return reply.send(clause)
  })

  // ── Create clause ─────────────────────────────────────────────────────────
  app.post('/', { preHandler: requirePermission('create', 'clause') }, async (req, reply) => {
    const { orgId, sub: userId } = req.user
    const body = CreateClauseSchema.parse(req.body)

    // Verify category belongs to this org
    const category = await prisma.clauseCategory.findFirst({
      where: { id: body.categoryId, orgId },
    })
    if (!category) return reply.status(404).send({ detail: 'Category not found' })

    const clause = await prisma.clauseLibraryItem.create({
      data: {
        orgId,
        createdById: userId,
        ...body,
        versions: [
          { version: 1, content: body.content, changedById: userId, changedAt: new Date().toISOString(), note: 'Initial version' },
        ],
      },
      include: { category: { select: { id: true, name: true } } },
    })

    return reply.status(201).send(clause)
  })

  // ── Update clause ─────────────────────────────────────────────────────────
  app.patch('/:id', { preHandler: requirePermission('edit', 'clause') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { orgId, sub: userId } = req.user
    const body = UpdateClauseSchema.parse(req.body)

    const existing = await prisma.clauseLibraryItem.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!existing) return reply.status(404).send({ detail: 'Clause not found' })

    // Append new version to history if content changed
    const existingVersions = Array.isArray(existing.versions) ? (existing.versions as any[]) : []
    const newVersions =
      body.content && body.content !== existing.content
        ? [
            ...existingVersions,
            {
              version: existingVersions.length + 1,
              content: body.content,
              changedById: userId,
              changedAt: new Date().toISOString(),
              note: (req.body as any).changeNote ?? '',
            },
          ]
        : existingVersions

    const updated = await prisma.clauseLibraryItem.update({
      where: { id },
      data: { ...body, versions: newVersions },
      include: { category: { select: { id: true, name: true } } },
    })

    return reply.send(updated)
  })

  // ── Approve / unapprove clause ────────────────────────────────────────────
  app.post('/:id/approve', { preHandler: requirePermission('edit', 'clause') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { orgId } = req.user
    const { approved = true } = (req.body as { approved?: boolean }) ?? {}

    const existing = await prisma.clauseLibraryItem.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!existing) return reply.status(404).send({ detail: 'Clause not found' })

    const updated = await prisma.clauseLibraryItem.update({
      where: { id },
      data: { isApproved: approved },
    })

    return reply.send(updated)
  })

  // ── Delete clause (soft) ──────────────────────────────────────────────────
  app.delete('/:id', { preHandler: requirePermission('delete', 'clause') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { orgId } = req.user

    const existing = await prisma.clauseLibraryItem.findFirst({ where: { id, orgId, deletedAt: null } })
    if (!existing) return reply.status(404).send({ detail: 'Clause not found' })

    await prisma.clauseLibraryItem.update({ where: { id }, data: { deletedAt: new Date() } })
    return reply.status(204).send()
  })

}
