/**
 * A contract's playbook review, as the contract page shows it.
 *
 * Three sources, one list:
 *   • the AI review the parse pipeline runs on every new version
 *     (metadata._playbookReview, playbook_review_agent.py): which rung each
 *     deviating clause sits on, with a one-sentence reason
 *   • the playbook's own phrase rules ("must include" / "must not include"),
 *     checked here on every read — deterministic, free, and working with AI off
 *   • required clause types the contract has no clause for
 *
 * Only clauses with something to say are listed. What could not be checked is
 * reported separately, because "nothing wrong" and "not looked at" must never
 * read the same.
 */
import { prisma } from './prisma.js'
import { matchCategory } from './clause-category.js'
import {
  failedRules, ruleCountOf, severityRank,
  type PlaybookRules, type PlaybookSeverity,
} from './playbook-rules.js'

export type Alignment = 'preferred' | 'acceptable' | 'fallback' | 'walkaway' | 'outside_playbook' | 'not_covered'
export type ReviewStatus = 'none' | 'queued' | 'running' | 'done' | 'skipped' | 'failed'

export interface ReviewFinding {
  clauseId:       string | null
  clauseType:     string
  sectionRef:     string | null
  excerpt:        string | null
  category:       { id: string; name: string } | null
  /** Rung the clause reaches: the AI's call, else the rules'. */
  alignment:      Alignment | null
  severity:       PlaybookSeverity
  recommendation: 'accept' | 'negotiate' | 'reject' | null
  reasoning:      string | null
  /** Phrase rules this clause breaks. */
  ruleIssues:     Array<{ description: string; severity: PlaybookSeverity; position: string }>
}

export interface PlaybookReviewView {
  ai: {
    status:     ReviewStatus
    error:      string | null
    reviewedAt: string | null
    summary:    string | null
    /** The AI reviewed an earlier version than the current one. */
    stale:      boolean
  }
  findings:  ReviewFinding[]
  /** Required clause types this contract has no clause for. */
  missing:   Array<{ categoryId: string; name: string }>
  /** Clause types the playbook has nothing to say about. */
  unchecked: Array<{ clauseType: string; count: number; reason: 'no_category' | 'no_positions' }>
  counts: {
    clauses:    number
    findings:   number
    walkaway:   number
    missing:    number
    unchecked:  number
  }
}

const RUNGS = ['preferred', 'acceptable', 'fallback'] as const
const AI_ALIGNMENTS = new Set<Alignment>(['preferred', 'acceptable', 'fallback', 'walkaway', 'outside_playbook', 'not_covered'])
const AI_SEVERITY: Record<string, PlaybookSeverity> = { low: 'low', medium: 'medium', high: 'high', critical: 'critical' }

interface Position { positionType: string; rules: unknown }

/**
 * What the phrase rules say about one clause.
 *
 * The clause reaches the first rung, top down, whose rules all pass; the
 * issues shown are the rules of the rungs above it — what it would take to
 * get to preferred. A walkaway phrase present overrides everything. Rungs
 * without rules are skipped; with no rules anywhere the rules have no view.
 */
export function judgeByRules(positions: Position[], text: string): {
  alignment: Alignment | null
  issues:    ReviewFinding['ruleIssues']
} {
  const withRules = positions.filter(p => ruleCountOf(p.rules as PlaybookRules | null) > 0)
  if (withRules.length === 0) return { alignment: null, issues: [] }

  const walkaway = withRules
    .filter(p => p.positionType === 'walkaway')
    .flatMap(p => failedRules(p.rules as PlaybookRules, text, 'walkaway'))
  if (walkaway.length > 0) return { alignment: 'walkaway', issues: walkaway }

  const above: ReviewFinding['ruleIssues'] = []
  for (const rung of RUNGS) {
    const onRung = withRules.filter(p => p.positionType === rung)
    if (onRung.length === 0) continue
    const failed = onRung.flatMap(p => failedRules(p.rules as PlaybookRules, text, rung))
    if (failed.length === 0) return { alignment: rung, issues: above }
    above.push(...failed)
  }
  return { alignment: 'outside_playbook', issues: above }
}

function worst(a: PlaybookSeverity, b: PlaybookSeverity): PlaybookSeverity {
  return severityRank(b) > severityRank(a) ? b : a
}

function severityOfAlignment(a: Alignment | null): PlaybookSeverity {
  switch (a) {
    case 'walkaway':         return 'walkaway'
    case 'outside_playbook': return 'high'
    case 'fallback':         return 'medium'
    default:                 return 'low'
  }
}

function aiStatus(raw: unknown, hasReview: boolean): ReviewStatus {
  const s = typeof raw === 'string' ? raw.toLowerCase() : ''
  if (['queued', 'running', 'done', 'skipped', 'failed'].includes(s)) return s as ReviewStatus
  return hasReview ? 'done' : 'none'
}

export async function buildPlaybookReview(contractId: string, orgId: string): Promise<PlaybookReviewView | null> {
  const contract = await prisma.contract.findFirst({
    where:  { id: contractId, orgId, deletedAt: null },
    select: { id: true, type: true, currentVersionId: true, metadata: true },
  })
  if (!contract) return null

  const meta = (contract.metadata as Record<string, unknown> | null) ?? {}
  const stored = meta._playbookReview as {
    findings?: Array<Record<string, unknown>>
    summary?: string
    reviewedAt?: string
    versionId?: string
  } | undefined

  const versionId = contract.currentVersionId ?? (await prisma.contractVersion.findFirst({
    where: { contractId }, orderBy: { versionNumber: 'desc' }, select: { id: true },
  }))?.id ?? null

  const [clauses, categories, positions] = await Promise.all([
    versionId
      ? prisma.contractClause.findMany({
          where:   { versionId, isSubChunk: false },
          orderBy: { sortOrder: 'asc' },
          select:  { id: true, clauseType: true, content: true, sectionRef: true },
        })
      : Promise.resolve([]),
    prisma.clauseCategory.findMany({ where: { orgId }, select: { id: true, name: true, isRequired: true } }),
    prisma.playbookPosition.findMany({
      where:  { orgId },
      select: { clauseCategoryId: true, positionType: true, rules: true, contractTypes: true },
    }),
  ])

  const relevant = positions.filter(p => p.contractTypes.length === 0 || p.contractTypes.includes(contract.type))
  const positionsByCategory = new Map<string, Position[]>()
  for (const p of relevant) {
    const list = positionsByCategory.get(p.clauseCategoryId) ?? []
    list.push(p)
    positionsByCategory.set(p.clauseCategoryId, list)
  }

  const stale = !!stored?.versionId && !!versionId && stored.versionId !== versionId
  const aiByClause = new Map<string, Record<string, unknown>>()
  const aiOrphans: Array<Record<string, unknown>> = []
  for (const f of stored?.findings ?? []) {
    const id = typeof f.clauseId === 'string' ? f.clauseId : null
    if (id && !stale) aiByClause.set(id, f)
    else aiOrphans.push(f)
  }

  const findings: ReviewFinding[] = []
  const coveredCategories = new Set<string>()
  const unchecked = new Map<string, { clauseType: string; count: number; reason: 'no_category' | 'no_positions' }>()

  for (const cl of clauses) {
    const category = matchCategory(categories, cl.clauseType)
    if (category) coveredCategories.add(category.id)
    const catPositions = category ? positionsByCategory.get(category.id) ?? [] : []
    const ai = aiByClause.get(cl.id)

    if (!ai && catPositions.length === 0) {
      const reason = category ? 'no_positions' : 'no_category'
      const u = unchecked.get(cl.clauseType) ?? { clauseType: cl.clauseType, count: 0, reason }
      u.count++
      unchecked.set(cl.clauseType, u)
      continue
    }

    const rules = judgeByRules(catPositions, cl.content)
    const aiAlignment = ai && AI_ALIGNMENTS.has(ai.playbookAlignment as Alignment) ? ai.playbookAlignment as Alignment : null
    // Only a clause that falls short of preferred on some count is a finding.
    if (!ai && rules.issues.length === 0 && rules.alignment !== 'walkaway' && rules.alignment !== 'outside_playbook') continue
    if (aiAlignment === 'preferred' && rules.issues.length === 0 && rules.alignment !== 'walkaway') continue
    if (aiAlignment === 'not_covered' && rules.issues.length === 0) {
      const u = unchecked.get(cl.clauseType) ?? { clauseType: cl.clauseType, count: 0, reason: 'no_positions' as const }
      u.count++
      unchecked.set(cl.clauseType, u)
      continue
    }

    // A walkaway phrase is a fact; the model's softer reading does not override it.
    const alignment = rules.alignment === 'walkaway' ? 'walkaway' : aiAlignment ?? rules.alignment
    let severity = severityOfAlignment(alignment)
    if (ai?.severity && AI_SEVERITY[String(ai.severity)]) severity = worst(severity, AI_SEVERITY[String(ai.severity)])
    for (const i of rules.issues) severity = worst(severity, i.severity)

    findings.push({
      clauseId:       cl.id,
      clauseType:     cl.clauseType,
      sectionRef:     cl.sectionRef,
      excerpt:        cl.content.slice(0, 280),
      category:       category ? { id: category.id, name: category.name } : null,
      alignment,
      severity,
      recommendation: (['accept', 'negotiate', 'reject'].includes(String(ai?.recommendation)) ? ai!.recommendation : null) as ReviewFinding['recommendation'],
      reasoning:      typeof ai?.reasoning === 'string' ? ai.reasoning : null,
      ruleIssues:     rules.issues,
    })
  }

  // Findings on an earlier version, kept so a stale review is not silently lost.
  for (const f of aiOrphans) {
    const alignment = AI_ALIGNMENTS.has(f.playbookAlignment as Alignment) ? f.playbookAlignment as Alignment : null
    if (alignment === 'not_covered') continue
    findings.push({
      clauseId: null, clauseType: String(f.clauseType ?? 'clause'), sectionRef: null, excerpt: null, category: null,
      alignment,
      severity: worst(severityOfAlignment(alignment), AI_SEVERITY[String(f.severity)] ?? 'low'),
      recommendation: (['accept', 'negotiate', 'reject'].includes(String(f.recommendation)) ? f.recommendation : null) as ReviewFinding['recommendation'],
      reasoning: typeof f.reasoning === 'string' ? f.reasoning : null,
      ruleIssues: [],
    })
  }

  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))

  const missing = categories
    .filter(c => c.isRequired && !coveredCategories.has(c.id))
    .map(c => ({ categoryId: c.id, name: c.name }))
  const uncheckedList = [...unchecked.values()].sort((a, b) => b.count - a.count)

  return {
    ai: {
      status:     aiStatus(meta._playbookReviewStatus, !!stored),
      error:      typeof meta._playbookReviewError === 'string' ? meta._playbookReviewError : null,
      reviewedAt: stored?.reviewedAt ?? null,
      summary:    stored?.summary ?? null,
      stale,
    },
    findings,
    missing: clauses.length > 0 ? missing : [],
    unchecked: uncheckedList,
    counts: {
      clauses:   clauses.length,
      findings:  findings.length,
      walkaway:  findings.filter(f => f.alignment === 'walkaway').length,
      missing:   clauses.length > 0 ? missing.length : 0,
      unchecked: uncheckedList.reduce((n, u) => n + u.count, 0),
    },
  }
}
