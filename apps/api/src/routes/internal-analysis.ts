/**
 * POST /api/internal/contracts/:id/analysis/sync — the intelligence tier hands
 * over a key-term analysis (key terms, summary, risk, clauses) for a contract.
 * See lib/analysis-sync.ts for what it does to the contract.
 *
 * Service-to-service only: guarded by INTERNAL_SERVICE_SECRET and blocked at
 * nginx. The org is taken from the contract, never from the caller.
 *
 * On success the clauses go through chunk-and-index, which marks the analysis
 * DONE and queues the playbook review — the same finish the old review agent's
 * callback had.
 */
import type { FastifyInstance } from 'fastify'
import { AuditAction } from '@clm/types'
import { prisma } from '../lib/prisma.js'
import { createAuditEvent } from '../lib/audit.js'
import { requireInternalSecret } from '../lib/internal-auth.js'
import { storeClauseSegments } from '../lib/embeddings.js'
import { queueChunkAndIndex } from '../lib/queue.js'
import { recordUsage } from '../lib/costCap.js'
import { costForTokens } from '../lib/model-pricing.js'
import { AnalysisSyncSchema, planAnalysisUpdate, type AnalysisRun } from '../lib/analysis-sync.js'

export async function internalAnalysisRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireInternalSecret)

  app.post('/:id/analysis/sync', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = AnalysisSyncSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ detail: 'Invalid analysis payload', issues: parsed.error.issues.slice(0, 20) })
    }
    const sync = parsed.data
    if (sync.platformContractId !== id) return reply.status(400).send({ detail: 'Contract id mismatch' })

    const contract = await prisma.contract.findFirst({
      where:  { id, deletedAt: null },
      select: {
        id: true, orgId: true, title: true, counterpartyName: true,
        keyTerms: true, fieldConfidence: true, metadata: true, currentVersionId: true,
        org: { select: { name: true } },
      },
    })
    if (!contract) return reply.status(404).send({ detail: 'Contract not found' })

    const metadata = (contract.metadata ?? {}) as Record<string, unknown>
    const run = (metadata.keyTermAnalysis ?? null) as AnalysisRun | null
    // A run superseded by a newer request (the contract was re-typed or
    // re-analysed) must not overwrite the newer one's result. Answered 200 so
    // the sender does not retry a delivery that will never be wanted.
    if (run?.runId && run.runId !== sync.runId) {
      return reply.send({ ok: true, ignored: 'superseded' })
    }

    const plan = planAnalysisUpdate(sync, {
      title:            contract.title,
      counterpartyName: contract.counterpartyName,
      keyTerms:         (contract.keyTerms ?? {}) as Record<string, unknown>,
      fieldConfidence:  (contract.fieldConfidence ?? {}) as Record<string, Record<string, unknown> | undefined>,
      metadata,
    }, { orgName: contract.org?.name, run })

    await prisma.contract.update({ where: { id }, data: plan.contract as never })

    // Clauses belong to the version that was analysed. If that version is no
    // longer the contract's (a newer upload landed meanwhile) they are still
    // stored against it, and the newer version gets its own analysis.
    const version = sync.versionId
      ? await prisma.contractVersion.findFirst({ where: { id: sync.versionId, contractId: id }, select: { id: true } })
      : null
    let stored = 0
    if (sync.status === 'success' && version) {
      if (plan.clauses.length) {
        await storeClauseSegments(version.id, plan.clauses.map(c => ({
          clauseType:     c.clauseType,
          content:        c.content,
          sortOrder:      c.sortOrder,
          interpretation: c.interpretation ?? undefined,
          riskRating:     c.riskRating ?? undefined,
          sectionRef:     c.sectionRef ?? undefined,
          page:           c.page ?? null,
          pageEnd:        c.pageEnd ?? null,
          spanStart:      c.spanStart ?? null,
          spanEnd:        c.spanEnd ?? null,
        })))
        stored = plan.clauses.length
      }
      if (plan.clauseFlags) {
        await prisma.contractVersion.update({ where: { id: version.id }, data: { clauseFlags: plan.clauseFlags } })
      }
    }

    if (sync.status === 'success') {
      // INDEXING → DONE → playbook review. With no clauses it goes straight
      // to DONE, as before.
      await prisma.contract.update({ where: { id }, data: { analysisStatus: 'INDEXING' } })
      queueChunkAndIndex({ contractId: id, versionId: version?.id ?? contract.currentVersionId ?? '', orgId: contract.orgId })
    }

    // Metered from the tokens the providers reported for this run. The call
    // no longer passes through this API's worker, which used to estimate it
    // from request size.
    const usage = sync.usage
    if (usage && usage.calls > 0) {
      recordUsage(contract.orgId, costForTokens(usage.model, usage.inputTokens, usage.outputTokens), {
        provider:    usage.provider ?? 'contractsense',
        model:       usage.model ?? 'key-term-extraction',
        tier:        'default',
        toolName:    'contract_analysis',
        isByok:      usage.byok,
        inputChars:  usage.inputTokens * 4,
        outputChars: usage.outputTokens * 4,
      }).catch(() => { /* accounting must never fail a sync */ })
    }

    await createAuditEvent({
      orgId: contract.orgId,
      action: AuditAction.CONTRACT_UPDATED,
      resourceType: 'contract', resourceId: id,
      metadata: {
        actor: 'contractsense', trigger: 'key_term_analysis', status: sync.status,
        runId: sync.runId, source: sync.source ?? null, clauses: stored,
        ledger: sync.analysis?.ledger ?? null, error: sync.error ?? null,
      },
    })

    return reply.send({ ok: true, status: sync.status, clauses: stored })
  })
}
