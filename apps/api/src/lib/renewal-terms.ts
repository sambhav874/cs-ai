/**
 * Renewal candidates with their binding date.
 *
 * The renewals list, its header counts, the CSV and the daily reminder all
 * need the same thing: executed contracts, each with the date by which
 * someone has to act (`actBy` — the notice deadline for a contract that may
 * renew itself, the expiry otherwise; see renewalTerms in @clm/types). The
 * notice deadline can sit up to a year before expiry, so candidates are
 * fetched by expiry out to the window plus that year and then kept by actBy.
 */
import {
  MAX_NOTICE_LOOKAHEAD_DAYS, ObligationTermsSchema, renewalTerms,
  type ObligationTerms, type RenewalTerms,
} from '@clm/types'
import { prisma } from './prisma.js'

const DAY_MS = 24 * 60 * 60 * 1000

/** Terms of each contract's renewal-type obligations, the fallback notice source. */
export async function renewalObligationTerms(contractIds: string[]): Promise<Map<string, ObligationTerms[]>> {
  const out = new Map<string, ObligationTerms[]>()
  if (contractIds.length === 0) return out
  const rows = await prisma.obligation.findMany({
    where: {
      contractId: { in: contractIds },
      type: 'renewal',
      status: { in: ['OPEN', 'OVERDUE'] },
    },
    select: { contractId: true, terms: true },
  })
  for (const r of rows) {
    const parsed = ObligationTermsSchema.safeParse(r.terms ?? null)
    if (!parsed.success) continue
    const list = out.get(r.contractId) ?? []
    list.push(parsed.data)
    out.set(r.contractId, list)
  }
  return out
}

export interface CandidateWindow {
  now:           Date
  /** Keep contracts whose actBy is on or before now + this. */
  lookaheadDays: number
  /** Keep contracts that expired at most this long ago. */
  lookbackDays?: number
}

/**
 * The expiry range that can contain a contract whose actBy falls inside the
 * window. Use in the `where` of the candidate query.
 */
export function candidateExpiryRange(w: CandidateWindow): { gte: Date; lte: Date } {
  const back = w.lookbackDays ?? 30
  return {
    gte: new Date(w.now.getTime() - back * DAY_MS),
    lte: new Date(w.now.getTime() + (w.lookaheadDays + MAX_NOTICE_LOOKAHEAD_DAYS) * DAY_MS),
  }
}

/**
 * Attach renewal terms to fetched contracts and keep those whose actBy falls
 * inside the window, soonest first.
 */
export async function withRenewalTerms<C extends { id: string; expiryDate: Date | null; keyTerms?: unknown }>(
  contracts: C[],
  w: CandidateWindow,
): Promise<Array<C & { renewal: RenewalTerms }>> {
  const obligations = await renewalObligationTerms(contracts.map(c => c.id))
  const horizon = w.now.getTime() + w.lookaheadDays * DAY_MS
  return contracts
    .map(c => ({
      ...c,
      renewal: renewalTerms({
        expiryDate: c.expiryDate,
        keyTerms: c.keyTerms,
        obligationTerms: obligations.get(c.id),
      }),
    }))
    .filter(c => c.renewal.actBy != null && c.renewal.actBy.getTime() <= horizon)
    .sort((a, b) => a.renewal.actBy!.getTime() - b.renewal.actBy!.getTime())
}

/** Whole days from today (UTC midnight) to `d`; negative in the past. */
export function daysFromToday(d: Date, now = new Date()): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const then  = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return Math.round((then - today) / DAY_MS)
}

/** The wire shape of renewal terms. */
export function renewalJson(r: RenewalTerms) {
  return {
    autoRenew:      r.autoRenew,
    noticeDays:     r.noticeDays,
    noticeSource:   r.noticeSource,
    noticeDeadline: r.noticeDeadline?.toISOString() ?? null,
    actBy:          r.actBy?.toISOString() ?? null,
  }
}
