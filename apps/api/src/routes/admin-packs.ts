/**
 * Admin endpoint for installing an industry pack into the caller's org on
 * demand (post-signup). Universal library is always installed at signup;
 * packs are opt-in via this endpoint.
 *
 * Endpoints:
 *   GET  /api/v1/admin/packs            — list available packs + row counts
 *   POST /api/v1/admin/packs/install    — install a pack into the caller's org
 *
 * Permission: requires 'configure:organization' (same gate as other
 * tenant-wide settings actions).
 *
 * Audit: we do not write to AuditEvent here — there is no fitting AuditAction
 * enum value for "pack installed" and pack install is not a security-
 * sensitive action (the data is non-PII, idempotent, and limited to the
 * caller's own org). We log via req.log for operational visibility.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../middleware/permissions.js'
import {
  applyIndustryPack,
  INDUSTRY_PACK_INFO,
  PACK_COUNTS,
  type IndustryPackId,
} from '../lib/org-seed.js'

const PACK_IDS = ['saas', 'healthcare', 'manufacturing', 'biotech', 'logistics'] as const

const InstallPackSchema = z.object({
  pack: z.enum(PACK_IDS),
})

export async function adminPackRoutes(app: FastifyInstance) {
  // 'configure:organization' — same gate as other org-wide config actions.
  const adminGuard = requirePermission('configure', 'organization')

  // GET /api/v1/admin/packs
  app.get('/', { preHandler: adminGuard }, async () => {
    const packs = PACK_IDS.map(id => ({
      id,
      label:       INDUSTRY_PACK_INFO[id].label,
      description: INDUSTRY_PACK_INFO[id].description,
      counts:      PACK_COUNTS[id],
    }))
    return { packs }
  })

  // POST /api/v1/admin/packs/install
  app.post('/install', { preHandler: adminGuard }, async (req, reply) => {
    let body: { pack: IndustryPackId }
    try {
      body = InstallPackSchema.parse(req.body)
    } catch (err) {
      return reply.status(400).send({
        detail: 'Invalid request',
        issues: (err as { issues?: unknown }).issues ?? String(err),
      })
    }

    const { orgId, sub: userId } = req.user
    const report = await applyIndustryPack(orgId, userId, body.pack)

    req.log.info(
      { orgId, pack: body.pack, userId, ...report },
      '[admin-packs] industry pack installed',
    )

    return reply.send({
      pack: body.pack,
      installed: report,
    })
  })
}
