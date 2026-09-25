/**
 * POST /api/internal/usage — model spend incurred on the intelligence tier.
 *
 * Obligation extraction and other runs there call models the lifecycle API
 * never sees. They report their token counts here after each run, so Admin →
 * AI Usage and the daily cost cap include them. The org is taken from the
 * contract, never from the caller; a BYOK run is recorded but kept off the
 * platform cap, as recordUsage does for every other path.
 *
 * Service-to-service only: INTERNAL_SERVICE_SECRET, and blocked at nginx.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireInternalSecret } from '../lib/internal-auth.js'
import { recordUsage } from '../lib/costCap.js'
import { costForTokens } from '../lib/model-pricing.js'

export const UsageReportSchema = z.object({
  platformContractId: z.string().trim().min(1).max(64),
  toolName:     z.string().trim().min(1).max(64),
  provider:     z.string().trim().max(60).default('unknown'),
  model:        z.string().trim().max(120).default('unknown'),
  byok:         z.boolean().default(false),
  calls:        z.number().int().min(0),
  inputTokens:  z.number().int().min(0),
  outputTokens: z.number().int().min(0),
})

export async function internalUsageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireInternalSecret)

  app.post('/', async (req, reply) => {
    const parsed = UsageReportSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ detail: 'Invalid usage report', issues: parsed.error.issues })
    const u = parsed.data
    const contract = await prisma.contract.findFirst({ where: { id: u.platformContractId }, select: { orgId: true } })
    if (!contract) return reply.status(404).send({ detail: 'Contract not found' })
    if (u.calls === 0) return reply.send({ ok: true, recorded: false })
    await recordUsage(contract.orgId, costForTokens(u.model, u.inputTokens, u.outputTokens), {
      provider: u.provider, model: u.model, tier: 'default', toolName: u.toolName, isByok: u.byok,
      inputChars: u.inputTokens * 4, outputChars: u.outputTokens * 4,
    })
    return reply.send({ ok: true, recorded: true })
  })
}
