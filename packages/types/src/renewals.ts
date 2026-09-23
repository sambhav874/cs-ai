/**
 * Renewal terms: when a contract expires, whether it renews on its own, and
 * the last day notice can be served to stop it.
 *
 * The date that binds is not the expiry date. A contract expiring in 40 days
 * with 90 days' notice renewed itself 50 days ago as far as anyone's options
 * go. So everything that asks "what needs a decision soon" — the renewals
 * list, its counts, the daily reminder — works from `actBy`: the notice
 * deadline when there is one, the expiry date otherwise.
 *
 * Terms come from two extractors that spell them differently:
 *   • draftLegal's review writes `keyTerms` (autoRenew, noticePeriodDays),
 *     which people correct in the review queue as a phrase ("90 days"); older
 *     seeds wrote noticeDays / renewalNoticeDays
 *   • ContractSense's obligation register may carry a renewal-notice
 *     obligation whose terms hold the period (value 90, unit "days")
 * A human-reviewed key term wins over an obligation, which wins over nothing.
 */
import type { ObligationTerms } from './obligations'

const DAY_MS = 24 * 60 * 60 * 1000

export interface NoticePeriod {
  amount: number
  unit:   'days' | 'months'
}

const UNIT_ALIASES: Array<[RegExp, NoticePeriod['unit'], number]> = [
  [/^(?:calendar\s+)?d(?:ays?)?$/, 'days', 1],
  [/^w(?:ee)?ks?$|^weeks?$/,        'days', 7],
  [/^m(?:o|on|onths?|ths?)?$/,      'months', 1],
  [/^y(?:rs?|ears?)?$/,             'months', 12],
]

/** A unit word to (unit, multiplier); business days are not calendar days, so they are not guessed at. */
function unitOf(raw: string | null | undefined): [NoticePeriod['unit'], number] | null {
  const u = (raw ?? 'days').trim().toLowerCase().replace(/[()]/g, '')
  if (!u) return ['days', 1]
  for (const [re, unit, mult] of UNIT_ALIASES) if (re.test(u)) return [unit, mult]
  return null
}

/**
 * A notice period from a number (days) or a phrase ("90 days", "3 months",
 * "12 weeks"). Ranges ("30-60 days") and anything else ambiguous are null:
 * this becomes a date people diarise against, and a guess is worse than a gap.
 */
export function parseNoticePeriod(raw: unknown): NoticePeriod | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 && raw <= 3650 ? { amount: Math.round(raw), unit: 'days' } : null
  }
  if (typeof raw !== 'string') return null
  const m = raw.trim().match(/^(\d{1,4})\s*([a-z()\s]*?)['’]?\s*(?:prior\s+(?:written\s+)?notice|notice)?\.?$/i)
  if (!m) return null
  const n = Number(m[1])
  const unit = unitOf(m[2])
  if (!unit || n <= 0) return null
  const amount = n * unit[1]
  return amount <= (unit[0] === 'days' ? 3650 : 120) ? { amount, unit: unit[0] } : null
}

type KeyTerms = Record<string, unknown> | null | undefined

/** Every spelling the codebase writes a notice period under, most authoritative first. */
const NOTICE_KEYS = ['noticePeriod', 'noticePeriodDays', 'noticeDays', 'renewalNoticeDays'] as const

/**
 * The notice period from `keyTerms`. `noticePeriod` is what a reviewer typed
 * when correcting the extraction, so it outranks the model's
 * `noticePeriodDays`. Values may be bare or `{ value, quote }` records.
 */
export function noticeFromKeyTerms(kt: KeyTerms): NoticePeriod | null {
  if (!kt || typeof kt !== 'object') return null
  for (const key of NOTICE_KEYS) {
    let raw = kt[key]
    if (raw && typeof raw === 'object' && 'value' in (raw as object)) raw = (raw as { value: unknown }).value
    const parsed = parseNoticePeriod(raw)
    if (parsed) return parsed
  }
  return null
}

/** The notice period an extracted renewal obligation states, if it states one unambiguously. */
export function noticeFromTerms(terms: ObligationTerms | null | undefined): NoticePeriod | null {
  if (!terms || terms.value == null || terms.valueMin != null || terms.valueMax != null) return null
  if (!Number.isFinite(terms.value) || terms.value <= 0 || !terms.unit) return null
  const unit = unitOf(terms.unit)
  if (!unit) return null
  return parseNoticePeriod(`${Math.round(terms.value * unit[1])} ${unit[0]}`)
}

/** true / false / null from a boolean or the strings the extractors and reviewers write. */
export function autoRenewOf(kt: KeyTerms): boolean | null {
  if (!kt || typeof kt !== 'object') return null
  let raw = kt.autoRenew ?? kt.auto_renew
  if (raw && typeof raw === 'object' && 'value' in (raw as object)) raw = (raw as { value: unknown }).value
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase()
    if (['true', 'yes', 'y', 'auto-renew', 'automatic'].includes(s)) return true
    if (['false', 'no', 'n', 'none'].includes(s)) return false
  }
  return null
}

/** `date` minus the period, clamping a month-end the way calendars do (31 May − 3 months = 28/29 Feb). */
export function subtractNotice(date: Date, notice: NoticePeriod): Date {
  if (notice.unit === 'days') return new Date(date.getTime() - notice.amount * DAY_MS)
  const d = new Date(date.getTime())
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - notice.amount)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d
}

export type NoticeSource = 'key_terms' | 'obligation'

export interface RenewalTerms {
  expiryDate:     Date | null
  /** null: the contract does not say, or nobody extracted it. */
  autoRenew:      boolean | null
  noticeDays:     number | null
  noticeSource:   NoticeSource | null
  /** Last day to serve notice. Only when the contract may renew on its own. */
  noticeDeadline: Date | null
  /** The date that binds: the notice deadline if there is one, else expiry. */
  actBy:          Date | null
}

export interface RenewalInput {
  expiryDate:  Date | string | null | undefined
  keyTerms?:   KeyTerms | unknown
  /** Terms of this contract's renewal-type obligations. */
  obligationTerms?: Array<ObligationTerms | null | undefined>
}

export function renewalTerms(input: RenewalInput): RenewalTerms {
  const expiry = input.expiryDate ? new Date(input.expiryDate) : null
  const expiryDate = expiry && !isNaN(expiry.getTime()) ? expiry : null
  const kt = (input.keyTerms && typeof input.keyTerms === 'object' && !Array.isArray(input.keyTerms))
    ? input.keyTerms as Record<string, unknown>
    : null
  const autoRenew = autoRenewOf(kt)

  let notice = noticeFromKeyTerms(kt)
  let noticeSource: NoticeSource | null = notice ? 'key_terms' : null
  if (!notice) {
    // Several renewal obligations: the longest period gives the earliest
    // deadline, which is the one that can still be missed.
    for (const t of input.obligationTerms ?? []) {
      const n = noticeFromTerms(t)
      if (!n) continue
      if (!notice || (expiryDate && subtractNotice(expiryDate, n) < subtractNotice(expiryDate, notice))) notice = n
    }
    if (notice) noticeSource = 'obligation'
  }

  // A contract that says it does not renew has no notice to serve: it ends.
  // Unknown is treated as "may renew" — an early reminder costs a glance, a
  // late one costs a year's term.
  const noticeDeadline = expiryDate && notice && autoRenew !== false ? subtractNotice(expiryDate, notice) : null
  const noticeDays = notice && expiryDate
    ? Math.round((expiryDate.getTime() - subtractNotice(expiryDate, notice).getTime()) / DAY_MS)
    : notice?.unit === 'days' ? notice.amount : null

  return {
    expiryDate,
    autoRenew,
    noticeDays,
    noticeSource,
    noticeDeadline,
    actBy: noticeDeadline ?? expiryDate,
  }
}

/** Notice periods above a year are rare; the lookahead that finds contracts whose notice falls due soon. */
export const MAX_NOTICE_LOOKAHEAD_DAYS = 366
