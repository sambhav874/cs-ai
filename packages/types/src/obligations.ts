/**
 * Obligation terms — what an obligation actually requires, carried from
 * ContractSense's extraction onto the platform's Obligation row — and the
 * helpers both the API and the web app read them with.
 *
 * One definition, so the validator on the sync endpoint, the CSV export and
 * the tracking view can never disagree about the shape or the wording.
 */
import { z } from 'zod'

const num = z.number().finite().nullish()
const text = (max: number) => z.string().trim().max(max).nullish()

export const ObligationTierSchema = z.object({
  label:     z.string().trim().max(80),
  range:     text(160),
  value:     num,
  unit:      text(32),
  currency:  text(8),
  creditPct: num,
})

export const ObligationConsequenceSchema = z.object({
  value:     num,
  unit:      text(40),
  currency:  text(8),
  mechanism: text(60),
})

export const ObligationTermsSchema = z.object({
  ruleType:          text(40),
  operator:          text(40),
  value:             num,
  valueMin:          num,
  valueMax:          num,
  unit:              text(32),
  aggregation:       text(40),
  period:            text(40),
  tiers:             z.array(ObligationTierSchema).max(50).default([]),
  consequence:       ObligationConsequenceSchema.nullish(),
  remediation:       text(1000),
  remediationSla:    text(200),
  gracePeriodDays:   num,
  action:            text(500),
  exceptions:        z.array(z.string().trim().max(300)).max(20).default([]),
  collapsedRowCount: num,
})

export type ObligationTier = z.infer<typeof ObligationTierSchema>
export type ObligationConsequence = z.infer<typeof ObligationConsequenceSchema>
export type ObligationTerms = z.infer<typeof ObligationTermsSchema>

// ── Wording ──────────────────────────────────────────────────────────────────

const OPERATOR_WORDS: Record<string, string> = {
  '>=': 'at least', minimum: 'at least', at_least: 'at least',
  '>': 'more than',
  '<=': 'at most', maximum: 'at most', at_most: 'at most',
  '<': 'less than',
  '=': 'exactly', '==': 'exactly', equals: 'exactly',
  within: 'within',
  no_later_than: 'no later than',
  conforms_to: 'conforms to',
}

const MECHANISM_WORDS: Record<string, string> = {
  service_credit: 'service credit',
  liquidated_damages: 'liquidated damages',
  financial_consequence: 'financial consequence',
  fee_reduction: 'fee reduction',
  penalty: 'penalty',
  termination_right: 'termination right',
  corrective_action: 'corrective action',
}

const humanize = (s: string) => s.replace(/_/g, ' ').trim()

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString('en-US')
    : value.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

/** A value in its unit: "95%", "USD 12,000", "30 days", "420 per turn". */
export function formatAmount(value: number | null | undefined, unit?: string | null, currency?: string | null): string | null {
  if (value === null || value === undefined) return null
  const n = formatNumber(value)
  const u = (unit ?? '').trim()
  if (currency) return `${currency.toUpperCase()} ${n}${u && u !== currency ? ` ${u}` : ''}`
  if (u === '%' || u.toLowerCase() === 'percent' || u.toLowerCase() === 'percentage') return `${n}%`
  if (u === '$') return `$${n}`
  return u ? `${n} ${u}` : n
}

function periodPhrase(terms: ObligationTerms): string | null {
  const aggregation = terms.aggregation && terms.aggregation !== 'per_event' ? humanize(terms.aggregation) : null
  if (aggregation) return aggregation
  return terms.period && terms.period !== 'per_event' ? humanize(terms.period) : null
}

/**
 * The requirement in one line — "at least 95% · monthly average",
 * "between 2 and 4 hours", "4 tiers" — or null when the record carries no
 * rule (a qualitative or process obligation, or a pattern-matched one).
 */
export function termsHeadline(terms: ObligationTerms | null | undefined): string | null {
  if (!terms) return null
  const period = periodPhrase(terms)
  const withPeriod = (s: string) => (period ? `${s} · ${period}` : s)

  if (terms.tiers.length > 0) {
    return withPeriod(`${terms.tiers.length} tier${terms.tiers.length === 1 ? '' : 's'}`)
  }
  if (terms.valueMin != null && terms.valueMax != null) {
    return withPeriod(`between ${formatAmount(terms.valueMin, terms.unit)} and ${formatAmount(terms.valueMax, terms.unit)}`)
  }
  const amount = formatAmount(terms.value, terms.unit)
  if (amount) {
    const op = terms.operator ? (OPERATOR_WORDS[terms.operator] ?? humanize(terms.operator)) : null
    return withPeriod(op ? `${op} ${amount}` : amount)
  }
  return null
}

/** What happens on a miss — "USD 12,000 per 0.1 point · service credit". */
export function consequenceLine(terms: ObligationTerms | null | undefined): string | null {
  const c = terms?.consequence
  if (!c) return null
  const mechanism = c.mechanism ? (MECHANISM_WORDS[c.mechanism] ?? humanize(c.mechanism)) : null
  const currencyUnit = c.currency && c.unit && c.unit.toUpperCase() === c.currency.toUpperCase()
  const amount = formatAmount(c.value, currencyUnit ? null : c.unit, c.currency)
  const parts = [amount, mechanism].filter(Boolean) as string[]
  if (parts.length === 0 && c.unit) parts.push(c.unit)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** One line per tier — "Tier 1: 99.990%–99.994% → 5% credit". */
export function tierLines(terms: ObligationTerms | null | undefined): string[] {
  return (terms?.tiers ?? []).map(t => {
    const outcome = [
      formatAmount(t.value, t.unit, t.currency),
      t.creditPct != null ? `${formatNumber(t.creditPct)}% credit` : null,
    ].filter(Boolean).join(', ')
    const head = t.range ? `${t.label}: ${t.range}` : t.label
    return outcome ? `${head} → ${outcome}` : head
  })
}

// ── Recurrence ───────────────────────────────────────────────────────────────

export const RECURRING = ['daily', 'weekly', 'monthly', 'quarterly', 'annually'] as const
export type Recurring = typeof RECURRING[number]

export function isRecurring(recurrence: string | null | undefined): recurrence is Recurring {
  return (RECURRING as readonly string[]).includes(recurrence ?? '')
}

/**
 * The next due date after `due` for a recurring obligation, in UTC. Month
 * steps clamp to the month's last day, so "31 January, monthly" is followed by
 * 28/29 February, then 31 March — anchored on the original day, not drifting.
 */
export function nextDueDate(due: Date, recurrence: string | null | undefined, anchorDay?: number): Date | null {
  if (!isRecurring(recurrence)) return null
  const d = new Date(due.getTime())
  if (recurrence === 'daily')  { d.setUTCDate(d.getUTCDate() + 1); return d }
  if (recurrence === 'weekly') { d.setUTCDate(d.getUTCDate() + 7); return d }
  const months = recurrence === 'monthly' ? 1 : recurrence === 'quarterly' ? 3 : 12
  const day = anchorDay ?? d.getUTCDate()
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1,
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target
}
