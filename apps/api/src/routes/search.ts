import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requirePermission } from '../middleware/permissions.js'
import { searchContracts, contractFacets } from '../lib/contract-search.js'
import { searchClauses } from '../lib/embeddings.js'
import { fuseRRF } from '../lib/rrf.js'

const SearchSchema = z.object({
  q: z.string().min(1).max(500),
  type: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

const AdvancedSearchSchema = z.object({
  q: z.string().max(500).optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  jurisdiction: z.string().optional(),
  // 0-100, the declared riskScore scale (RiskScoreSchema in @clm/types). These
  // were bounded to max(1), so any real risk filter the UI sent was rejected
  // outright and the ones that got through matched almost nothing.
  riskScoreMin: z.number().min(0).max(100).optional(),
  riskScoreMax: z.number().min(0).max(100).optional(),
  clauseFlags: z.record(z.boolean()).optional(),
  effectiveDateFrom: z.string().optional(),
  effectiveDateTo: z.string().optional(),
  expiryDateFrom: z.string().optional(),
  expiryDateTo: z.string().optional(),
  // B.6.9 — Counterparty drill-through. Either form is accepted;
  // combined they match the FK or the denormalised name.
  counterpartyId: z.string().optional(),
  counterpartyName: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  mode: z.enum(['keyword', 'semantic', 'hybrid']).default('keyword'),
})

const FacetsSchema = z.object({
  type: z.string().optional(),
  status: z.string().optional(),
  jurisdiction: z.string().optional(),
})

/** Contracts by id, in the order given, scoped to the org. */
async function loadContracts(orgId: string, ids: string[]) {
  if (!ids.length) return []
  const contracts = await prisma.contract.findMany({
    where: { id: { in: ids }, orgId, deletedAt: null },
    include: { counterparty: { select: { id: true, name: true } } },
  })
  const byId = new Map(contracts.map(c => [c.id, c]))
  return ids.map(id => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c)
}

export async function searchRoutes(app: FastifyInstance) {
  // ── POST /api/v1/search  — keyword search over the org's contracts ────────
  app.post('/', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const body = SearchSchema.parse(req.body)
    const { orgId } = req.user
    const { hits } = await searchContracts(orgId, { q: body.q, type: body.type, status: body.status }, body.limit)
    const data = await loadContracts(orgId, hits.map(h => h.id))
    return reply.send({
      data,
      highlights: Object.fromEntries(hits.map(h => [h.id, h.highlights ?? {}])),
      total: data.length,
      source: 'mongo',
    })
  })

  // ── POST /api/v1/search/advanced  — structured filters + optional keyword ─
  app.post('/advanced', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const body = AdvancedSearchSchema.parse(req.body)
    const { orgId } = req.user
    const { limit, mode, q, ...filters } = body

    try {
      if (mode === 'semantic' || mode === 'hybrid') {
        if (!q) return reply.status(400).send({ detail: 'q is required for semantic/hybrid mode' })

        // Semantic: clause-level similarity search
        const clauseMatches = await searchClauses(q, orgId, limit)

        if (mode === 'semantic') {
          const contractIds = [...new Set(clauseMatches.map(m => m.contractId))]
          return reply.send({
            data: await loadContracts(orgId, contractIds),
            clauseMatches,
            total: contractIds.length,
            source: 'vector',
          })
        }

        // Hybrid: keyword hits (title, counterparty, text) fused with clause
        // similarity by RRF. fuseRRF de-dupes a repeated contractId within
        // the clause list to its first-seen rank.
        const keyword = await searchContracts(orgId, { q, ...filters }, limit * 2)
        const fused = fuseRRF([
          keyword.hits.map(h => h.id),
          clauseMatches.map(m => m.contractId),
        ])
        const rrfScores: Record<string, number> = Object.fromEntries(fused.map(f => [f.id, f.score]))
        const sortedIds = fused.slice(0, limit).map(f => f.id)
        return reply.send({
          data: await loadContracts(orgId, sortedIds),
          clauseMatches: clauseMatches.filter(m => sortedIds.includes(m.contractId)),
          rrfScores,
          total: sortedIds.length,
          source: 'hybrid_rrf',
        })
      }

      // Keyword / structured filter mode
      const { hits, total } = await searchContracts(orgId, { q, ...filters }, limit)
      return reply.send({
        data: await loadContracts(orgId, hits.map(h => h.id)),
        highlights: Object.fromEntries(hits.map(h => [h.id, h.highlights ?? {}])),
        total,
        source: 'mongo',
      })
    } catch (err) {
      app.log.error({ err }, 'Advanced search failed')
      return reply.status(500).send({ detail: 'Search unavailable' })
    }
  })

  // ── GET /api/v1/search/facets  — counts for the filter sidebar ────────────
  app.get('/facets', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const params = FacetsSchema.parse(req.query)
    return reply.send(await contractFacets(req.user.orgId, params))
  })
  // /ask and /portfolio-query were removed with the agents they proxied (P2):
  // cited Q&A is the assistant (POST /api/v1/agent/chat) and natural-language
  // portfolio filters are its contract_filter tool. No screen called either.
}
