/**
 * POST /api/internal/obligations/sync — the intelligence tier hands over an
 * extraction run for one linked contract. See lib/obligation-sync.ts for the
 * reconciliation rules.
 *
 * Service-to-service only: guarded by INTERNAL_SERVICE_SECRET and blocked at
 * nginx. The org is taken from the contract, never from the caller.
 */
import type { FastifyInstance } from 'fastify'
import { AuditAction } from '@clm/types'
import { prisma } from '../lib/prisma.js'
import { createAuditEvent } from '../lib/audit.js'
import { requireInternalSecret } from '../lib/internal-auth.js'
import { extractedFields, planSync, SyncPayloadSchema } from '../lib/obligation-sync.js'

export async function internalObligationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireInternalSecret)

  app.post('/sync', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const parsed = SyncPayloadSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ detail: 'Invalid sync payload', issues: parsed.error.issues.slice(0, 20) })
    }
    const p = parsed.data

    const contract = await prisma.contract.findFirst({
      where:  { id: p.platformContractId, deletedAt: null },
      select: { id: true, orgId: true, metadata: true },
    })
    if (!contract) return reply.status(404).send({ detail: 'Contract not found' })
    const { id: contractId, orgId } = contract

    let counts = { created: 0, updated: 0, deleted: 0, flagged: 0 }
    if (p.records) {
      const records = p.records
      const stored = await prisma.obligation.findMany({
        where:  { contractId, source: 'contractsense' },
        select: { id: true, externalId: true, status: true, assigneeId: true },
      })
      const plan = planSync(stored, records)
      await prisma.$transaction(async (tx) => {
        if (plan.create.length > 0) {
          await tx.obligation.createMany({
            data: plan.create.map(r => ({
              orgId, contractId,
              source: 'contractsense',
              externalId: r.externalId,
              ...extractedFields(r),
            })),
          })
        }
        for (const { id, record } of plan.update) {
          await tx.obligation.update({ where: { id }, data: extractedFields(record) })
        }
        if (plan.delete.length > 0) {
          await tx.obligation.deleteMany({ where: { id: { in: plan.delete }, contractId } })
        }
        if (plan.orphan.length > 0) {
          await tx.obligation.updateMany({ where: { id: { in: plan.orphan }, contractId }, data: { needsReview: true } })
        }
      }, { timeout: 60_000 })
      counts = {
        created: plan.create.length, updated: plan.update.length,
        deleted: plan.delete.length, flagged: plan.orphan.length,
      }
    }

    // The run's outcome lives on the contract, so the UI can show "lost 3
    // clauses" or "extraction failed: <reason>" next to the list instead of an
    // unexplained empty register.
    const meta = (contract.metadata ?? {}) as Record<string, unknown>
    const previous = (meta.obligationExtraction ?? {}) as Record<string, unknown>
    await prisma.contract.update({
      where: { id: contractId },
      data: {
        metadata: {
          ...meta,
          obligationExtraction: {
            status:           p.status,
            error:            p.error ?? null,
            runId:            p.runId ?? null,
            extractionMethod: p.extractionMethod ?? null,
            packId:           p.packId ?? null,
            packVersion:      p.packVersion ?? null,
            contractFamily:   p.contractFamily ?? null,
            // An error run has no ledger of its own; keep the last good one.
            ledger:           p.ledger ?? (p.status === 'error' ? previous.ledger ?? null : null),
            truncated:        p.truncated,
            syncedAt:         new Date().toISOString(),
          },
        } as never,
      },
    })

    await createAuditEvent({
      orgId,
      action: AuditAction.OBLIGATION_EXTRACTED,
      resourceType: 'contract', resourceId: contractId,
      metadata: {
        actor: 'contractsense', trigger: 'extraction_run', status: p.status,
        runId: p.runId ?? null, lost: p.ledger?.lost ?? null, ...counts,
      },
    })

    return reply.send({ ok: true, ...counts })
  })
}
