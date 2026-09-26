import { normalizeRiskScore } from '@clm/types'
import { prisma } from './prisma.js'
import { versionIdsWithClauseFlags } from './json-field-filter.js'

// Contract search and filter facets on MongoDB. This replaced the
// Elasticsearch index (runbook step 7): the index was optional, held a subset
// of contracts, and without it the Contracts page search answered 500. Every
// query here reads the live rows, so a new or edited contract is searchable at
// once and nothing has to be kept in sync.

export interface ContractSearchFilters {
  q?: string
  type?: string
  status?: string
  jurisdiction?: string
  riskScoreMin?: number
  riskScoreMax?: number
  clauseFlags?: Record<string, boolean>
  effectiveDateFrom?: string
  effectiveDateTo?: string
  expiryDateFrom?: string
  expiryDateTo?: string
  counterpartyId?: string
  counterpartyName?: string
}

export interface ContractHit {
  id: string
  score: number | null
  highlights?: Record<string, string[]>
}

/** Facet label for contracts with no jurisdiction. */
export const UNKNOWN_JURISDICTION = 'Unknown'

const NAME_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'of', 'for', 'with', 'to', 'in', 'on', 'our', 'my', 'contract', 'contracts', 'agreement', 'agreements',
])

/** The words of a contract name worth matching on: no stop words, no punctuation. */
export function nameWords(query: string): string[] {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1 && !NAME_STOP_WORDS.has(w))
  return [...new Set(words)].slice(0, 8)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A date-only upper bound covers the whole day; a full timestamp is taken as given. */
function dateBound(value: string, end: boolean): Date | null {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const d = new Date(dateOnly ? `${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z` : value)
  return Number.isNaN(d.getTime()) ? null : d
}

function dateRange(from?: string, to?: string): Record<string, Date> | null {
  const out: Record<string, Date> = {}
  const gte = from ? dateBound(from, false) : null
  const lte = to ? dateBound(to, true) : null
  if (gte) out.gte = gte
  if (lte) out.lte = lte
  return Object.keys(out).length ? out : null
}

/**
 * The Prisma where for every structured filter. Clause flags live on the
 * current version, which Prisma cannot filter by JSON path on MongoDB, so they
 * resolve to a list of version ids first.
 */
export async function contractFilterWhere(
  orgId: string,
  f: Omit<ContractSearchFilters, 'q'>,
): Promise<Record<string, unknown>> {
  const where: Record<string, unknown> = { orgId, deletedAt: null }
  const and: Record<string, unknown>[] = []

  if (f.type)   where.type = f.type
  if (f.status) where.status = f.status
  if (f.jurisdiction) {
    if (f.jurisdiction === UNKNOWN_JURISDICTION) {
      and.push({ OR: [{ jurisdiction: null }, { jurisdiction: { isSet: false } }, { jurisdiction: '' }] })
    } else {
      where.jurisdiction = { equals: f.jurisdiction, mode: 'insensitive' }
    }
  }
  // Counterparty drill-through: the id, or the name for contracts that
  // pre-date the counterparty link.
  if (f.counterpartyId || f.counterpartyName) {
    const or: Record<string, unknown>[] = []
    if (f.counterpartyId)   or.push({ counterpartyId: f.counterpartyId })
    if (f.counterpartyName) or.push({ counterpartyName: { equals: f.counterpartyName, mode: 'insensitive' } })
    and.push({ OR: or })
  }
  if (f.riskScoreMin !== undefined || f.riskScoreMax !== undefined) {
    where.riskScore = {
      ...(f.riskScoreMin !== undefined && { gte: f.riskScoreMin }),
      ...(f.riskScoreMax !== undefined && { lte: f.riskScoreMax }),
    }
  }
  const effective = dateRange(f.effectiveDateFrom, f.effectiveDateTo)
  const expiry = dateRange(f.expiryDateFrom, f.expiryDateTo)
  if (effective) where.effectiveDate = effective
  if (expiry)    where.expiryDate = expiry
  if (and.length) where.AND = and

  if (f.clauseFlags && Object.keys(f.clauseFlags).length) {
    const candidates = await prisma.contract.findMany({
      where: { ...where, currentVersionId: { not: null } } as never,
      select: { currentVersionId: true },
    })
    const versionIds = candidates.map(c => c.currentVersionId).filter((v): v is string => !!v)
    where.currentVersionId = { in: versionIds.length ? await versionIdsWithClauseFlags(versionIds, f.clauseFlags) : [] }
  }
  return where
}

/** A short excerpt around the first match, the match wrapped in <em> as the list page expects. */
export function excerpt(text: string, needle: RegExp, radius = 80): string | null {
  const m = needle.exec(text)
  if (!m) return null
  const start = Math.max(0, m.index - radius)
  const end = Math.min(text.length, m.index + m[0].length + radius)
  const before = text.slice(start, m.index).replace(/\s+/g, ' ')
  const after = text.slice(m.index + m[0].length, end).replace(/\s+/g, ' ')
  return `${start > 0 ? '…' : ''}${before}<em>${m[0]}</em>${after}${end < text.length ? '…' : ''}`
}

// Field weights, the same order the index boosted them in.
const WEIGHT = { title: 8, counterpartyName: 4, summary: 2, tags: 2, body: 1 }

type Candidate = {
  id: string
  title: string
  counterpartyName: string | null
  summary: string | null
  tags: string[]
  currentVersionId: string | null
  createdAt: Date
}

/**
 * Keyword search with structured filters. A query matches as a phrase in the
 * title, counterparty, summary, tags or the current version's text; failing
 * that, every word of it must appear (so "Acme Corporation MSA" still finds
 * "Acme Corp — Master Services Agreement" by its counterparty "Acme
 * Corporation"). Ranked by where it matched, newest first on ties.
 */
export async function searchContracts(
  orgId: string,
  filters: ContractSearchFilters,
  limit: number,
): Promise<{ hits: ContractHit[]; total: number }> {
  const { q, ...structured } = filters
  const where = await contractFilterWhere(orgId, structured)
  const query = q?.trim()

  if (!query) {
    const [rows, total] = await Promise.all([
      prisma.contract.findMany({ where: where as never, select: { id: true }, orderBy: { createdAt: 'desc' }, take: limit }),
      prisma.contract.count({ where: where as never }),
    ])
    return { hits: rows.map(r => ({ id: r.id, score: null })), total }
  }

  const candidates: Candidate[] = await prisma.contract.findMany({
    where: where as never,
    select: { id: true, title: true, counterpartyName: true, summary: true, tags: true, currentVersionId: true, createdAt: true },
  })
  if (!candidates.length) return { hits: [], total: 0 }

  const phrase = new RegExp(escapeRegex(query), 'i')
  const words = nameWords(query)
  const wordRes = words.map(w => new RegExp(escapeRegex(w), 'i'))

  // Body matches, from the current versions only: the phrase, or every word.
  const versionIds = candidates.map(c => c.currentVersionId).filter((v): v is string => !!v)
  const bodyPhrase = new Set<string>()
  const bodyWords = new Set<string>()
  if (versionIds.length) {
    const rows = (await prisma.contractVersion.findRaw({
      filter: { _id: { $in: versionIds }, plainText: { $regex: escapeRegex(query), $options: 'i' } },
      options: { projection: { _id: 1 } },
    })) as unknown as { _id: unknown }[]
    rows.forEach(r => bodyPhrase.add(String(r._id)))
    if (words.length > 1) {
      const rest = versionIds.filter(v => !bodyPhrase.has(v))
      if (rest.length) {
        const rows2 = (await prisma.contractVersion.findRaw({
          filter: { _id: { $in: rest }, $and: words.map(w => ({ plainText: { $regex: escapeRegex(w), $options: 'i' } })) },
          options: { projection: { _id: 1 } },
        })) as unknown as { _id: unknown }[]
        rows2.forEach(r => bodyWords.add(String(r._id)))
      }
    }
  }

  const scored: (ContractHit & { createdAt: Date; bodyRe?: RegExp })[] = []
  for (const c of candidates) {
    const fields = { title: c.title, counterpartyName: c.counterpartyName ?? '', summary: c.summary ?? '' }
    let score = 0
    const highlights: Record<string, string[]> = {}
    for (const [field, text] of Object.entries(fields) as [keyof typeof fields, string][]) {
      const hit = excerpt(text, phrase)
      if (hit) { score += WEIGHT[field]; highlights[field] = [hit] }
    }
    if (c.tags.some(t => phrase.test(t))) score += WEIGHT.tags

    let bodyRe: RegExp | undefined
    if (c.currentVersionId && bodyPhrase.has(c.currentVersionId)) { score += WEIGHT.body; bodyRe = phrase }

    if (score === 0 && words.length > 1) {
      // Every word somewhere in the name fields, or every word in the text.
      const meta = `${fields.title} ${fields.counterpartyName} ${fields.summary} ${c.tags.join(' ')}`
      if (wordRes.every(re => re.test(meta))) {
        score = 1.5
        for (const [field, text] of Object.entries(fields)) {
          const hit = wordRes.map(re => excerpt(text, re)).find(Boolean)
          if (hit) highlights[field] = [hit]
        }
      } else if (c.currentVersionId && bodyWords.has(c.currentVersionId)) {
        score = 0.5
        bodyRe = wordRes[0]
      }
    }
    if (score > 0) scored.push({ id: c.id, score, highlights, createdAt: c.createdAt, bodyRe })
  }

  scored.sort((a, b) => (b.score! - a.score!) || (b.createdAt.getTime() - a.createdAt.getTime()))
  const page = scored.slice(0, limit)

  // Excerpts from the document text, only for the page being returned.
  const byVersion = new Map(candidates.map(c => [c.id, c.currentVersionId]))
  const needText = page.filter(h => h.bodyRe && byVersion.get(h.id))
  if (needText.length) {
    const texts = await prisma.contractVersion.findMany({
      where: { id: { in: needText.map(h => byVersion.get(h.id)!) } },
      select: { id: true, plainText: true },
    })
    const textById = new Map(texts.map(t => [t.id, t.plainText]))
    for (const h of needText) {
      const hit = excerpt(textById.get(byVersion.get(h.id)!) ?? '', h.bodyRe!, 100)
      if (hit) h.highlights = { ...h.highlights, plainText: [hit] }
    }
  }

  return {
    hits: page.map(({ id, score, highlights }) => ({ id, score, highlights })),
    total: scored.length,
  }
}

export interface FacetBucket { key: string; doc_count: number }

function buckets(values: (string | null | undefined)[], size: number, missing?: string): FacetBucket[] {
  const counts = new Map<string, number>()
  for (const v of values) {
    const key = v?.trim() ? v.trim() : missing
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, doc_count]) => ({ key, doc_count }))
    .sort((a, b) => b.doc_count - a.doc_count || a.key.localeCompare(b.key))
    .slice(0, size)
}

/** Clause flags the filter sidebar counts. */
export const FACET_CLAUSE_FLAGS = [
  'forceMajeure', 'mfn', 'changeOfControl', 'auditRights',
  'assignmentRestriction', 'limitationOfLiability', 'indemnification',
] as const

const DAY_MS = 86_400_000

/** Counts for the Contracts filter sidebar, in the bucket shape the page reads. */
export async function contractFacets(orgId: string, base: Omit<ContractSearchFilters, 'q'> = {}, now = new Date()) {
  const where = await contractFilterWhere(orgId, base)
  const rows = await prisma.contract.findMany({
    where: where as never,
    select: { type: true, status: true, jurisdiction: true, counterpartyName: true, riskScore: true, expiryDate: true, currentVersionId: true },
  })

  // Risk is served on the 0-100 scale; bands match the page's filter bounds.
  const risk = { low: 0, medium: 0, high: 0 }
  for (const r of rows) {
    const s = normalizeRiskScore(r.riskScore)
    if (s === null) continue
    if (s >= 67) risk.high++
    else if (s >= 34) risk.medium++
    else risk.low++
  }

  const expiringSoon = [30, 90, 180].map(days => ({
    key: `${days}d`,
    doc_count: rows.filter(r => r.expiryDate && r.expiryDate >= now && r.expiryDate.getTime() <= now.getTime() + days * DAY_MS).length,
  }))

  const clauseFlags = Object.fromEntries(FACET_CLAUSE_FLAGS.map(f => [f, 0])) as Record<string, number>
  const versionIds = rows.map(r => r.currentVersionId).filter((v): v is string => !!v)
  if (versionIds.length) {
    const versions = await prisma.contractVersion.findMany({ where: { id: { in: versionIds } }, select: { clauseFlags: true } })
    for (const v of versions) {
      const flags = (v.clauseFlags ?? {}) as Record<string, unknown>
      for (const f of FACET_CLAUSE_FLAGS) if (flags[f] === true) clauseFlags[f]++
    }
  }

  return {
    types:          buckets(rows.map(r => r.type), 20),
    statuses:       buckets(rows.map(r => r.status), 10),
    jurisdictions:  buckets(rows.map(r => r.jurisdiction), 30, UNKNOWN_JURISDICTION),
    counterparties: buckets(rows.map(r => r.counterpartyName), 20),
    riskRanges:     (['low', 'medium', 'high'] as const).map(key => ({ key, doc_count: risk[key] })),
    expiringSoon,
    clauseFlags,
    total: rows.length,
  }
}
