/**
 * Contract clauses: storing the analysed clauses, and searching passages.
 *
 * Both halves used to embed here — Voyage, OpenAI or Gemini vectors into
 * pgvector, reranked by Voyage — which could not run on MongoDB and
 * duplicated what the intelligence tier does. Retrieval now runs there
 * (searchClauses asks it); the clause rows are what the playbook, redline
 * and clause features read. The embedding and rerank calls were removed in
 * the agent merge's cleanup (P6).
 */

import { prisma } from './prisma.js'

// ─── Store analysed clause segments ─────────────────────────────────

export interface ClauseSegment {
  clauseType: string
  content: string
  sortOrder: number
  interpretation?: string
  riskRating?: string
  sectionRef?: string
  /** Location in the source document, when the analysis had pages. */
  page?: number | null
  pageEnd?: number | null
  spanStart?: number | null
  spanEnd?: number | null
}

export async function storeClauseSegments(
  versionId: string,
  segments: ClauseSegment[],
): Promise<void> {
  if (!segments.length) return

  // Atomic upsert — delete + insert in a single transaction so a failed
  // insert never leaves the version with zero clauses
  await prisma.$transaction([
    prisma.contractClause.deleteMany({ where: { versionId } }),
    prisma.contractClause.createMany({
      data: segments.map(s => ({
        versionId,
        clauseType: s.clauseType,
        content: s.content,
        sortOrder: s.sortOrder,
        interpretation: s.interpretation ?? null,
        riskRating: s.riskRating ?? null,
        sectionRef: s.sectionRef ?? null,
        page: s.page ?? null,
        pageEnd: s.pageEnd ?? null,
        spanStart: s.spanStart ?? null,
        spanEnd: s.spanEnd ?? null,
      })),
    }),
  ])
}

// ─── Passage search (intelligence tier) ──────────────────────────────────────

export interface ClauseMatch {
  contractId: string
  versionId: string
  clauseId: string
  clauseType: string
  content: string
  similarity: number
  /** Page of the passage in the source PDF, when the pipeline knows it. */
  page?: number | null
}

interface RetrievalHit {
  platformContractId: string
  passageId: string
  section: string | null
  page: number | null
  quote: string
  context: string
  score: number
}

/**
 * Passages from the org's contracts that answer `queryText`, best first.
 *
 * This used to be pgvector cosine similarity over contract_clauses, which
 * cannot run on MongoDB — so since the database move every caller silently
 * fell back to keyword matching. It now asks the intelligence tier, which
 * ranks passages with ContractSense's hybrid evidence retrieval over each
 * contract's linked analysis copy (runbook step 6). Same signature and shape,
 * so contract_search, portfolio_search and both Q&A routes pick it up as-is.
 *
 * Throws when the intelligence tier is unreachable; every caller already
 * wraps this and degrades to its keyword path.
 */
export async function searchClauses(
  queryText: string,
  orgId: string,
  limit = 20,
  contractId?: string | string[], // scope to one contract (Q&A) or a set (precedents)
): Promise<ClauseMatch[]> {
  const scope = contractId === undefined ? undefined : Array.isArray(contractId) ? contractId : [contractId]
  if (scope && scope.length === 0) return []
  const base = (process.env.INTELLIGENCE_URL ?? 'http://localhost:8000').replace(/\/+$/, '')
  const res = await fetch(`${base}/internal/retrieval/search`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET ?? '',
    },
    body: JSON.stringify({
      org_id: orgId,
      query: queryText,
      limit,
      platform_contract_ids: scope,
    }),
  })
  if (!res.ok) throw new Error(`intelligence retrieval failed (${res.status})`)
  const { hits } = await res.json() as { hits: RetrievalHit[] }
  if (!hits.length) return []

  // Callers key on versionId (portfolio_search reads each version's nav), so
  // each hit is pinned to its contract's current version — the one the
  // analysis copy was last linked from. Org-scoped again here, so a hit can
  // never surface a contract outside the caller's org.
  const contracts = await prisma.contract.findMany({
    where: { id: { in: [...new Set(hits.map(h => h.platformContractId))] }, orgId, deletedAt: null },
    select: { id: true, currentVersionId: true },
  })
  const versionOf = new Map(contracts.map(c => [c.id, c.currentVersionId ?? '']))

  return hits
    .filter(h => versionOf.has(h.platformContractId))
    .map(h => ({
      contractId: h.platformContractId,
      versionId:  versionOf.get(h.platformContractId) ?? '',
      clauseId:   h.passageId,
      clauseType: h.section ?? 'passage',
      content:    h.quote || h.context,
      // The pipeline scores 0–100; callers expect a 0–1 similarity.
      similarity: Math.min(h.score / 100, 1),
      page:       h.page,
    }))
}
