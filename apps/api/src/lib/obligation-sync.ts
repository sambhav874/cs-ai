/**
 * Obligations extracted by the intelligence tier, reconciled into this API's
 * Obligation rows (POST /api/internal/obligations/sync).
 *
 * ContractSense's engine does the extraction: whole-document, verified quotes,
 * a clause ledger. This side owns what happens next — owner, due date,
 * reminders, completion. Every run re-sends the full register, and the plan
 * below reconciles it against what is stored:
 *
 *   • matched by `externalId` → extracted fields refresh; anything a person set
 *     (assignee, due date, status, completion) is kept
 *   • new                     → created OPEN
 *   • no longer extracted     → deleted if nobody has touched it; kept and
 *                               flagged for review if it has an assignee or is
 *                               completed, because deleting would lose work
 *
 * Rows from other sources (`manual`) are never touched.
 *
 * The planner is PURE so every one of those rules is unit-tested without a
 * database; applying it is a handful of Prisma calls in the route.
 */
import { z } from 'zod'
import { ObligationTermsSchema } from '@clm/types'

export const MAX_SYNC_RECORDS = 1000

const Text = (max: number) => z.string().trim().max(max).nullish()

export const SyncRecordSchema = z.object({
  externalId:      z.string().trim().min(1).max(200),
  name:            Text(200),
  description:     Text(4000),
  kpiType:         Text(64),
  obligationClass: Text(64),
  partyRole:       Text(32),
  frequency:       Text(32),
  trigger:         Text(1000),
  quote:           z.string().trim().min(1).max(4000),
  page:            z.number().int().min(1).nullish(),
  section:         Text(300),
  needsReview:     z.boolean().default(false),
  packId:          Text(120),
  packVersion:     Text(40),
  // Optional so a tier still sending the pre-terms payload is accepted.
  terms:           ObligationTermsSchema.nullish(),
})

export const SyncLedgerSchema = z.object({
  total:       z.number().int().min(0),
  extracted:   z.number().int().min(0),
  rejected:    z.number().int().min(0),
  lost:        z.number().int().min(0),
  quarantined: z.number().int().min(0).default(0),
})

export const SyncPayloadSchema = z.object({
  platformContractId: z.string().trim().min(1).max(64),
  status:             z.enum(['success', 'degraded', 'error']),
  error:              Text(500),
  runId:              Text(120),
  extractionMethod:   Text(80),
  packId:             Text(120),
  packVersion:        Text(40),
  contractFamily:     Text(80),
  ledger:             SyncLedgerSchema.nullish(),
  records:            z.array(SyncRecordSchema).max(MAX_SYNC_RECORDS).nullish(),
  truncated:          z.boolean().default(false),
})

export type SyncRecord = z.infer<typeof SyncRecordSchema>
export type SyncPayload = z.infer<typeof SyncPayloadSchema>

// ── Vocabulary mapping ──────────────────────────────────────────────────────

/** ContractSense's party roles → the Obligation `owner` (contractual party). */
export function partyToOwner(role: string | null | undefined): string {
  switch ((role ?? '').toLowerCase()) {
    case 'supplier': return 'provider'
    case 'client':   return 'customer'
    case 'mutual':   return 'either'
    default:         return 'unknown'
  }
}

const RECURRENCES = new Set(['daily', 'weekly', 'monthly', 'quarterly', 'annually'])

export function frequencyToRecurrence(freq: string | null | undefined): string {
  const f = (freq ?? '').toLowerCase()
  if (RECURRENCES.has(f)) return f
  if (f === 'hourly') return 'daily'
  // per_actual, per_event, per_invoice, per_shipment…: each time the event happens.
  if (f.startsWith('per_') || f === 'on-event') return 'on-event'
  return 'unknown'
}

// Checked in order: the first family whose words appear wins.
const TYPE_RULES: Array<[string, RegExp]> = [
  ['termination', /terminat/],
  ['renewal',     /renew|notice_period|expir/],
  ['payment',     /pay|fee|invoice|price|rate|charge|penalt|credit|rebate|financial/],
  ['sla',         /sla|service_level|availability|uptime|latency|performance|kpi|on_time|delivery/],
  ['report',      /report|notif|evidence/],
  ['audit',       /audit|inspect/],
  ['compliance',  /complian|regulat|insurance|confidential|data|security|privacy/],
]

// The record's name. Names describe the duty, so a report *about* performance
// or delivery is a report: report and audit are checked before the families
// their subject would match.
const NAME_RULES: Array<[string, RegExp]> = [
  ['termination', /terminat/],
  ['renewal',     /renew|notice_period|expir/],
  ['report',      /report|notif/],
  ['audit',       /audit|inspect/],
  ['payment',     /pay|fee|invoice|price|charge|penalt|credit|rebate/],
  ['compliance',  /complian|regulat|insurance|confidential|data_protection|security|privacy/],
  ['sla',         /(^|_)sla(_|$)|service_level|availability|uptime|latency|on_time/],
]

// Types that say "this is a duty" without saying which kind. For these the
// name decides, and the type only when the name doesn't.
const GENERIC_TYPES = /^(obligation|performance|kpi|metric|measure|target|deliverable|commitment|requirement)?$/

// Words joined by "_", whatever the dash: models write "On‑time" with U+2011.
const words = (s: string) => s.toLowerCase().replace(/[\s\-\u2010-\u2015]+/g, '_')

function firstMatch(rules: Array<[string, RegExp]>, key: string): string | null {
  for (const [type, re] of rules) if (re.test(key)) return type
  return null
}

export function toObligationType(kpiType?: string | null, obligationClass?: string | null, name?: string | null): string {
  const type = words(kpiType ?? '')
  const key = words(`${kpiType ?? ''} ${obligationClass ?? ''}`)
  const byName = firstMatch(NAME_RULES, words(name ?? ''))
  if (GENERIC_TYPES.test(type) && !obligationClass) {
    return byName ?? firstMatch(TYPE_RULES, key) ?? 'other'
  }
  return firstMatch(TYPE_RULES, key) ?? byName ?? 'other'
}

/** The extracted fields of a row — the ones a re-run is allowed to overwrite.
 *  Terms are extracted too: a re-run that reads the rule differently replaces it. */
export function extractedFields(r: SyncRecord) {
  return {
    type:        toObligationType(r.kpiType, r.obligationClass, r.name),
    description: (r.description || r.name || r.quote).slice(0, 4000),
    owner:       partyToOwner(r.partyRole),
    recurrence:  frequencyToRecurrence(r.frequency),
    trigger:     r.trigger ?? null,
    quote:       r.quote,
    page:        r.page ?? null,
    sectionRef:  r.section ?? null,
    needsReview: r.needsReview,
    packId:      r.packId ?? null,
    packVersion: r.packVersion ?? null,
    terms:       (r.terms ?? null) as never,
    ruleType:    r.terms?.ruleType ?? null,
  }
}

// ── Planner ─────────────────────────────────────────────────────────────────

export interface StoredRow {
  id:          string
  externalId:  string | null
  status:      string
  assigneeId:  string | null
}

export interface SyncPlan {
  create:     SyncRecord[]
  update:     Array<{ id: string; record: SyncRecord }>
  delete:     string[]
  /** Gone from the latest extraction but worked on — kept, flagged for review. */
  orphan:     string[]
}

export function planSync(stored: StoredRow[], incoming: SyncRecord[]): SyncPlan {
  const plan: SyncPlan = { create: [], update: [], delete: [], orphan: [] }
  const byExternal = new Map<string, StoredRow>()
  for (const row of stored) if (row.externalId) byExternal.set(row.externalId, row)

  const seen = new Set<string>()
  for (const record of incoming) {
    if (seen.has(record.externalId)) continue // one row per extracted record
    seen.add(record.externalId)
    const row = byExternal.get(record.externalId)
    if (row) plan.update.push({ id: row.id, record })
    else plan.create.push(record)
  }

  for (const row of stored) {
    if (row.externalId && seen.has(row.externalId)) continue
    const touched = row.assigneeId != null || !['OPEN', 'OVERDUE'].includes(row.status)
    if (touched) plan.orphan.push(row.id)
    else plan.delete.push(row.id)
  }
  return plan
}
