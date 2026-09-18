/**
 * Organization management routes — org details and settings.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permissions.js'
import { seedOrgDefaults, INDUSTRY_PACK_INFO } from '../lib/org-seed.js'
import type { IndustryPackId } from '../lib/org-seed.js'

const UpdateOrgSchema = z.object({
  name: z.string().min(1).optional(),
  logoUrl: z.string().url().optional().nullable(),
  brandColor: z.string().optional().nullable(),
  settings: z.record(z.unknown()).optional(),
})

const InstallPackSchema = z.object({
  packId: z.enum(['saas', 'healthcare', 'manufacturing', 'biotech', 'logistics']),
})

export async function organizationRoutes(app: FastifyInstance) {
  // GET /api/v1/organization — current org details
  app.get('/', { preHandler: requireAuth }, async (req, reply) => {
    const org = await prisma.organization.findUnique({
      where: { id: req.user.orgId },
    })
    if (!org) return reply.status(404).send({ detail: 'Organization not found' })

    return reply.send({
      id: org.id,
      name: org.name,
      slug: org.slug,
      subscriptionTier: org.subscriptionTier,
      logoUrl: org.logoUrl,
      brandColor: org.brandColor,
      settings: org.settings,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    })
  })

  // PATCH /api/v1/organization — update org settings
  app.patch('/', { preHandler: requirePermission('configure', 'integration') }, async (req, reply) => {
    const body = UpdateOrgSchema.parse(req.body)

    const org = await prisma.organization.findUnique({
      where: { id: req.user.orgId },
    })
    if (!org) return reply.status(404).send({ detail: 'Organization not found' })

    // Merge settings if provided
    const currentSettings = (org.settings as Record<string, unknown>) ?? {}
    const newSettings = body.settings
      ? { ...currentSettings, ...body.settings }
      : currentSettings

    const updated = await prisma.organization.update({
      where: { id: req.user.orgId },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.logoUrl !== undefined && { logoUrl: body.logoUrl }),
        ...(body.brandColor !== undefined && { brandColor: body.brandColor }),
        settings: newSettings as any,
      },
    })

    return reply.send({
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      subscriptionTier: updated.subscriptionTier,
      logoUrl: updated.logoUrl,
      brandColor: updated.brandColor,
      settings: updated.settings,
    })
  })

  // GET /api/v1/organization/industry-packs — list available packs
  app.get('/industry-packs', { preHandler: requireAuth }, async (_req, reply) => {
    const packs = (Object.keys(INDUSTRY_PACK_INFO) as IndustryPackId[]).map(id => ({
      id,
      label:       INDUSTRY_PACK_INFO[id].label,
      description: INDUSTRY_PACK_INFO[id].description,
    }))
    return reply.send({ data: packs })
  })

  // POST /api/v1/organization/install-industry-pack — layer a vertical pack
  // on top of the universal seed. Idempotent — calling twice is safe.
  app.post(
    '/install-industry-pack',
    { preHandler: requirePermission('configure', 'integration') },
    async (req, reply) => {
      const body = InstallPackSchema.parse(req.body)
      const org = await prisma.organization.findUnique({ where: { id: req.user.orgId } })
      if (!org) return reply.status(404).send({ detail: 'Organization not found' })

      // seedOrgDefaults includes the universal pack call; calling it with an
      // industryPack option re-runs the universal seed (no-op due to upserts)
      // and then layers the industry pack content.
      await seedOrgDefaults(org.id, org.slug, req.user.sub, { industryPack: body.packId })

      // Persist which pack was installed, so the wizard / settings page can show it.
      const settings = (org.settings as Record<string, unknown>) ?? {}
      const installedPacks = new Set<string>(Array.isArray(settings.installedIndustryPacks)
        ? (settings.installedIndustryPacks as string[])
        : [])
      installedPacks.add(body.packId)
      await prisma.organization.update({
        where: { id: org.id },
        data: { settings: { ...settings, installedIndustryPacks: Array.from(installedPacks) } as any },
      })

      return reply.send({
        ok: true,
        packId: body.packId,
        label: INDUSTRY_PACK_INFO[body.packId].label,
      })
    },
  )
}
