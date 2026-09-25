/**
 * A key-term analysis from the intelligence tier, applied to a contract
 * (POST /api/internal/contracts/:id/analysis/sync).
 *
 * ContractSense's extractor (apps/intelligence/services/key_terms.py) sends
 * only records whose quote it found in the contract, each with its page when
 * the text had pages, and names every term it could not support as absent.
 * This side decides what that does to the contract:
 *
 *   • verified terms fill keyTerms, fieldConfidence and the dedicated columns
 *     (dates, value, currency, jurisdiction)
 *   • an absent term is recorded as absent — never defaulted — and never
 *     clears a column someone filled in
 *   • a term a person has verified (fieldConfidence[f].verifiedAt) is kept
 *     as they left it
 *   • the title is replaced only on the first analysis after an upload, and
 *     the counterparty only when none is set
 *   • metadata is merged, not replaced: other jobs keep their keys there
 *
 * PURE: the route applies the plan with a few Prisma calls.
 */
import { z } from 'zod'

const Text = (max: number) => z.string().trim().max(max).nullish()
const Page = z.number().int().min(1).nullish()
const Offset = z.number().int().min(0).nullish()

const Located = {
  page:      Page,
  pageEnd:   Page,
  spanStart: Offset,
  spanEnd:   Offset,
}

export const VerifiedTermSchema = z.object({
  value:      z.union([z.string().max(4000), z.number(), z.boolean()]),
  quote:      z.string().trim().min(1).max(4000),
  section:    Text(300),
  confidence: z.number().min(0).max(1),
  issue:      Text(300),
  label:      Text(200),
  ...Located,
})

export const AnalysisClauseSchema = z.object({
  clauseType:     z.string().trim().min(1).max(64),
  content:        z.string().trim().min(1).max(8000),
  interpretation: Text(2000),
  riskRating:     z.enum(['favorable', 'unfavorable', 'neutral', 'unusual']).nullish(),
  sectionRef:     Text(300),
  sortOrder:      z.number().int().min(0),
  ...Located,
})

export const MAX_CLAUSES = 300

export const AnalysisSchema = z.object({
  fields:            z.record(VerifiedTermSchema),
  absent:            z.record(z.string().max(40)),
  parties:           z.array(z.object({
    role:  Text(80),
    name:  z.string().trim().min(1).max(200),
    quote: Text(4000),
    ...Located,
  })).max(10),
  clauseFlags:       z.record(z.boolean()),
  typeFields:        z.record(VerifiedTermSchema),
  customFields:      z.record(VerifiedTermSchema),
  openEndedFindings: z.array(VerifiedTermSchema.extend({ key: z.string().max(60) })).max(15),
  clauses:           z.array(AnalysisClauseSchema).max(MAX_CLAUSES),
  contractType:      z.string().trim().min(1).max(40),
  suggestedTitle:    Text(200),
  summary:           Text(4000),
  riskScore:         z.number().min(0).max(1).nullish(),
  riskFactors:       z.array(z.string().max(300)).max(20),
  overallConfidence: z.number().min(0).max(1),
  hasPages:          z.boolean(),
  ledger:            z.record(z.number().int().min(0)),
})

export const AnalysisSyncSchema = z.object({
  platformContractId: z.string().trim().min(1).max(64),
  versionId:          z.string().trim().max(64),
  runId:              z.string().trim().min(1).max(120),
  status:             z.enum(['success', 'error', 'skipped']),
  source:             z.enum(['analysis_copy', 'platform_text']).nullish(),
  error:              Text(500),
  warnings:           z.array(z.string().max(300)).max(10).default([]),
  analysis:           AnalysisSchema.nullish(),
  usage:              z.object({
    calls:        z.number().int().min(0),
    inputTokens:  z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    provider:     Text(60),
    model:        Text(120),
    byok:         z.boolean().default(false),
  }).nullish(),
})

export type AnalysisSync = z.infer<typeof AnalysisSyncSchema>
export type Analysis = z.infer<typeof AnalysisSchema>
export type AnalysisClause = z.infer<typeof AnalysisClauseSchema>

/** Where the contract's current analysis request stands (metadata.keyTermAnalysis). */
export interface AnalysisRun {
  runId:       string
  status:      'running' | 'success' | 'error' | 'skipped'
  triggeredBy?: string
  requestedAt?: string
  [k: string]: unknown
}

export interface ContractState {
  title:            string
  counterpartyName: string | null
  keyTerms:         Record<string, unknown>
  fieldConfidence:  Record<string, Record<string, unknown> | undefined>
  metadata:         Record<string, unknown>
}

export interface AnalysisPlan {
  /** Prisma update data for the contract. */
  contract: Record<string, unknown>
  /** Replace the version's clauses with these (empty: leave them). */
  clauses:  AnalysisClause[]
  clauseFlags: Record<string, boolean> | null
}

// Upload filenames often become titles; the model sometimes answers with
// a placeholder when it found no parties. Those never replace a title.
const PLACEHOLDER_TITLES = [
  'unnamed contract', 'unidentified contract', 'no identified parties',
  'missing party', 'untitled contract', 'unknown contract',
]

export function isPlaceholderTitle(title: string): boolean {
  const t = title.toLowerCase()
  return PLACEHOLDER_TITLES.some(p => t.includes(p))
}

const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * The other party: not us (by name), else not the usual client-side roles,
 * else the first. Without our org name the extractor named "us" as the
 * counterparty in about 40% of contracts.
 */
export function pickCounterparty(
  parties: Array<{ role?: string | null; name: string }>,
  orgName: string | null | undefined,
): string | null {
  if (!parties.length) return null
  const org = orgName ? normalizeName(orgName) : ''
  const isUs = (name: string) => {
    const n = normalizeName(name)
    return !!org && !!n && (n.includes(org) || org.includes(n))
  }
  const notUs = parties.find(p => !isUs(p.name))
  if (org && notUs) return notUs.name
  const byRole = parties.find(p => !['client', 'buyer', 'licensor', 'seller'].includes((p.role ?? '').toLowerCase()))
  return (byRole ?? parties[0]).name
}

function toIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Human-verified terms: what a person confirmed is not re-extracted over. */
function humanVerified(state: ContractState, field: string): boolean {
  return !!state.fieldConfidence[field]?.verifiedAt
}

export function planAnalysisUpdate(
  sync: AnalysisSync,
  state: ContractState,
  opts: { orgName?: string | null; run?: AnalysisRun | null },
): AnalysisPlan {
  const run = opts.run ?? null
  const runRecord = {
    ...(run ?? {}),
    runId:      sync.runId,
    status:     sync.status,
    source:     sync.source ?? null,
    error:      sync.error ?? null,
    warnings:   sync.warnings,
    ledger:     sync.analysis?.ledger ?? null,
    hasPages:   sync.analysis?.hasPages ?? null,
    usage:      sync.usage ?? null,
    finishedAt: new Date().toISOString(),
  }

  if (sync.status !== 'success' || !sync.analysis) {
    // A failed or skipped run never touches what an earlier run found.
    return {
      contract: {
        analysisStatus: sync.status === 'skipped' ? 'SKIPPED' : 'FAILED',
        analysisError:  sync.error ?? (sync.status === 'skipped' ? 'AI analysis is off.' : 'Analysis failed.'),
        metadata:       { ...state.metadata, keyTermAnalysis: runRecord },
      },
      clauses: [],
      clauseFlags: null,
    }
  }

  const a = sync.analysis
  const keyTerms: Record<string, unknown> = { ...state.keyTerms }
  const fieldConfidence: Record<string, unknown> = { ...state.fieldConfidence }
  const contract: Record<string, unknown> = {}

  for (const [field, term] of Object.entries(a.fields)) {
    if (humanVerified(state, field)) continue
    keyTerms[field] = term.value
    fieldConfidence[field] = {
      confidence: term.confidence,
      quote:      term.quote,
      section:    term.section ?? null,
      page:       term.page ?? null,
      issue:      term.issue ?? null,
      verified:   true,
    }
  }
  for (const [field, reason] of Object.entries(a.absent)) {
    if (humanVerified(state, field)) continue
    keyTerms[field] = null
    fieldConfidence[field] = { absent: reason, quote: null }
  }
  if (a.parties.length) {
    keyTerms.parties = a.parties.map(p => ({ role: p.role ?? null, name: p.name, quote: p.quote ?? null, page: p.page ?? null }))
  }

  // Columns: filled from verified terms, never cleared by an absent one.
  const verified = (f: string) => (humanVerified(state, f) ? undefined : a.fields[f]?.value)
  const effective = toIsoDate(verified('effectiveDate'))
  const expiry = toIsoDate(verified('expiryDate'))
  if (effective) contract.effectiveDate = effective
  if (expiry) contract.expiryDate = expiry
  const value = verified('value')
  if (typeof value === 'number') contract.value = value
  const currency = verified('currency')
  if (typeof currency === 'string') contract.currency = currency
  const law = verified('governingLaw')
  if (typeof law === 'string') contract.jurisdiction = law

  if (!state.counterpartyName) {
    const cp = pickCounterparty(a.parties, opts.orgName)
    if (cp) contract.counterpartyName = cp
  }
  const title = a.suggestedTitle?.trim()
  if (title && run?.triggeredBy === 'upload' && !isPlaceholderTitle(title)) contract.title = title

  const metadata: Record<string, unknown> = { ...state.metadata, keyTermAnalysis: runRecord }
  const typeFields = Object.fromEntries(Object.entries(a.typeFields).map(([k, t]) => [k, {
    value: t.value, confidence: t.confidence, quote: t.quote, page: t.page ?? null, label: t.label ?? k,
  }]))
  if (Object.keys(typeFields).length) metadata._typeFields = typeFields
  const customEvidence: Record<string, unknown> = {}
  for (const [key, t] of Object.entries(a.customFields)) {
    // An org field someone already filled in is theirs.
    const current = state.metadata[key]
    if (current === undefined || current === null || current === '') metadata[key] = t.value
    customEvidence[key] = { quote: t.quote, page: t.page ?? null, confidence: t.confidence }
  }
  if (Object.keys(customEvidence).length) metadata._customFieldEvidence = customEvidence
  if (a.openEndedFindings.length) {
    metadata._aiFindings = a.openEndedFindings.map(f => ({
      key: f.key, label: f.label ?? f.key, value: f.value, confidence: f.confidence, quote: f.quote, page: f.page ?? null,
    }))
  }

  Object.assign(contract, {
    keyTerms,
    fieldConfidence,
    metadata,
    type:              a.contractType,
    summary:           a.summary ?? undefined,
    riskScore:         a.riskScore ?? undefined,
    riskFactors:       a.riskFactors,
    overallConfidence: a.overallConfidence,
    analysisError:     null,
  })
  for (const k of Object.keys(contract)) if (contract[k] === undefined) delete contract[k]

  return {
    contract,
    clauses: a.clauses,
    clauseFlags: Object.keys(a.clauseFlags).length ? a.clauseFlags : null,
  }
}
