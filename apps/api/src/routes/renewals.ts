/**
 * Renewal routes (P8 Step 7).
 *
 *   GET /api/v1/renewals
 *     Org-wide list of EXECUTED contracts that need a renewal decision
 *     inside the lookahead window. Groups by month of expiry and exposes
 *     per-month KPIs (count, total ACV) so the calendar view can render
 *     without additional fetches.
 *
 *   GET /api/v1/renewals/stats
 *     Header KPIs: this week, next 30d, next 60d, next 90d, no-decision.
 *
 * Windows, buckets and counts run on each contract's `actBy`: the last day
 * to serve notice when it may renew itself, its expiry otherwise (see
 * lib/renewal-terms.ts). Counting by expiry put a contract with 90 days'
 * notice in "Next 30d" two months after it had already renewed.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requirePermission } from '../middleware/permissions.js'
import { buildCsv } from '../lib/csv.js'
import {
  candidateExpiryRange, daysFromToday, renewalJson, withRenewalTerms,
} from '../lib/renewal-terms.js'

const DAY_MS = 24 * 60 * 60 * 1000

const ListSchema = z.object({
  bucket: z.enum(['all', 'this_week', 'next_30', 'next_60', 'next_90', 'overdue']).default('all'),
  /** Override the lookahead window. Default 365d. */
  lookaheadDays: z.coerce.number().int().min(1).max(3650).default(365),
  status: z.enum(['all', 'pending', 'decided']).default('all'),
})

interface RenewalRow {
  id:               string
  title:            string
  type:             string
  counterpartyName: string | null
  expiryDate:       string | null
  effectiveDate:    string | null
  value:            string | null
  currency:         string | null
  ownerId:          string
  ownerName:        string | null
  // AI-extracted term sheet. The renewals calendar needs autoRenew +
  // noticeDays to show the notice-to-terminate deadline, which is the date
  // that actually binds — expiry alone is too late to act on.
  keyTerms:         Record<string, unknown> | null
  /** Renewal terms resolved from keyTerms and renewal obligations. */
  renewal:          ReturnType<typeof renewalJson>
  // Renewal-specific from metadata
  renewalDecision:    string | null   // renew | renegotiate | let_expire | pause | unknown
  renewalDecisionAt:  string | null
  renewalAdvice: {
    recommendation: string
    confidence:     string
    rationale:      string
  } | null
}

export async function renewalRoutes(app: FastifyInstance) {
  // ── GET / ──────────────────────────────────────────────────────────────
  app.get('/', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    let q
    try { q = ListSchema.parse(req.query as Record<string, unknown>) }
    catch (err) {
      return reply.status(400).send({ detail: 'Invalid query', issues: (err as { issues?: unknown }).issues })
    }
    const { orgId } = req.user
    const now = new Date()

    // Default 365 days lookahead by actBy; expired up to 30 days ago.
    const window    = { now, lookaheadDays: q.lookaheadDays }
    const lookahead = new Date(now.getTime() + q.lookaheadDays * DAY_MS)
    const lookback  = candidateExpiryRange(window).gte

    const fetched = await prisma.contract.findMany({
      where: {
        orgId, deletedAt: null,
        status:     'EXECUTED',
        expiryDate: candidateExpiryRange(window),
      },
      select: {
        id: true, title: true, type: true,
        counterpartyName: true, expiryDate: true, effectiveDate: true,
        value: true, currency: true, metadata: true, keyTerms: true,
        ownerId: true,
        owner: { select: { name: true } },
      },
      orderBy: { expiryDate: 'asc' },
      take: 2_000,
    })
    const contracts = await withRenewalTerms(fetched, window)

    const rows: RenewalRow[] = contracts.map(c => {
      const md = (c.metadata ?? {}) as {
        renewalDecision?:   string | null
        renewalDecisionAt?: string | null
        renewalAdvice?:     { recommendation?: string; confidence?: string; rationale?: string }
      }
      return {
        id:               c.id,
        title:            c.title,
        type:             c.type,
        counterpartyName: c.counterpartyName,
        expiryDate:       c.expiryDate?.toISOString() ?? null,
        effectiveDate:    c.effectiveDate?.toISOString() ?? null,
        value:            c.value ? c.value.toString() : null,
        currency:         c.currency ?? null,
        ownerId:          c.ownerId,
        ownerName:        c.owner?.name ?? null,
        keyTerms:         (c.keyTerms && typeof c.keyTerms === 'object' && !Array.isArray(c.keyTerms))
          ? (c.keyTerms as Record<string, unknown>)
          : null,
        renewal:          renewalJson(c.renewal),
        renewalDecision:    md.renewalDecision ?? null,
        renewalDecisionAt:  md.renewalDecisionAt ?? null,
        renewalAdvice:    md.renewalAdvice
          ? {
              recommendation: md.renewalAdvice.recommendation ?? '',
              confidence:     md.renewalAdvice.confidence ?? '',
              rationale:      md.renewalAdvice.rationale ?? '',
            }
          : null,
      }
    })

    // Bucket filter, by the date that binds.
    let filtered = rows
    if (q.bucket !== 'all') {
      filtered = rows.filter(r => r.renewal.actBy != null && inBucket(q.bucket, new Date(r.renewal.actBy), now))
    }
    if (q.status !== 'all') {
      filtered = filtered.filter(r =>
        q.status === 'decided'
          ? r.renewalDecision != null && r.renewalDecision !== 'unknown'
          : r.renewalDecision == null || r.renewalDecision === 'unknown',
      )
    }

    // Group by month-of-expiry (YYYY-MM) for the calendar UI.
    const groups: Record<string, { month: string; label: string; rows: RenewalRow[]; totalValue: number; currency: string }> = {}
    for (const r of filtered) {
      if (!r.expiryDate) continue
      const d = new Date(r.expiryDate)
      const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      if (!groups[monthKey]) {
        groups[monthKey] = { month: monthKey, label, rows: [], totalValue: 0, currency: r.currency ?? 'USD' }
      }
      groups[monthKey].rows.push(r)
      if (r.value) {
        const n = Number(r.value)
        if (!isNaN(n)) groups[monthKey].totalValue += n
      }
    }
    const months = Object.values(groups).sort((a, b) => a.month.localeCompare(b.month))

    return reply.send({
      data:    filtered,
      months,
      total:   filtered.length,
      window:  { from: lookback.toISOString(), to: lookahead.toISOString() },
    })
  })

  // ── GET /export — CSV download (P9 Step 7) ─────────────────────────
  app.get('/export', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const format = ((req.query as { format?: string }).format ?? 'csv').toLowerCase()
    if (format !== 'csv') return reply.status(400).send({ detail: 'Only csv is supported' })
    const { orgId } = req.user
    const now = new Date()
    const window = { now, lookaheadDays: 365 }

    const fetched = await prisma.contract.findMany({
      where: {
        orgId, deletedAt: null, status: 'EXECUTED',
        expiryDate: candidateExpiryRange(window),
      },
      select: {
        id: true, title: true, type: true, counterpartyName: true,
        effectiveDate: true, expiryDate: true, value: true, currency: true,
        metadata: true, keyTerms: true,
        owner: { select: { name: true, email: true } },
      },
      orderBy: { expiryDate: 'asc' },
      take: 5_000,
    })
    const contracts = await withRenewalTerms(fetched, window)

    const headers = [
      'Title', 'Type', 'Counterparty', 'Owner', 'Effective Date', 'Expiry Date',
      'Days Until Expiry', 'Auto-renews', 'Notice Period (days)', 'Notice Deadline', 'Act By',
      'Days Until Act By', 'Value', 'Currency', 'AI Recommendation', 'AI Confidence', 'Decision',
    ]
    const ymd = (d: Date | null) => d?.toISOString().slice(0, 10) ?? ''
    const rows = contracts.map(c => {
      const md = (c.metadata ?? {}) as { renewalAdvice?: { recommendation?: string; confidence?: string }; renewalDecision?: string }
      const r = c.renewal
      return [
        c.title, c.type, c.counterpartyName ?? '',
        c.owner?.name ?? '',
        ymd(c.effectiveDate),
        ymd(c.expiryDate),
        c.expiryDate ? daysFromToday(c.expiryDate, now) : '',
        r.autoRenew == null ? 'unknown' : r.autoRenew ? 'yes' : 'no',
        r.noticeDays ?? '',
        ymd(r.noticeDeadline),
        ymd(r.actBy),
        r.actBy ? daysFromToday(r.actBy, now) : '',
        c.value ? Number(c.value.toString()) : '',
        c.currency ?? '',
        md.renewalAdvice?.recommendation ?? '',
        md.renewalAdvice?.confidence ?? '',
        md.renewalDecision ?? '',
      ]
    })
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="renewals-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(buildCsv(headers, rows))
  })

  // ── GET /stats — header KPIs ──────────────────────────────────────────
  app.get('/stats', { preHandler: requirePermission('view', 'contract') }, async (req, reply) => {
    const { orgId } = req.user
    const now = new Date()
    const window = { now, lookaheadDays: 90 }

    const fetched = await prisma.contract.findMany({
      where:  { orgId, deletedAt: null, status: 'EXECUTED', expiryDate: candidateExpiryRange(window) },
      select: { id: true, expiryDate: true, keyTerms: true, value: true, metadata: true },
      take: 5_000,
    })
    const contracts = await withRenewalTerms(fetched, window)

    const counts = { overdue: 0, thisWeek: 0, next30: 0, next60: 0, next90: 0 }
    let totalAcvNext90 = 0
    let undecided = 0
    let noticeNext30 = 0
    for (const c of contracts) {
      const actBy = c.renewal.actBy!
      if (inBucket('overdue', actBy, now))   counts.overdue++
      if (inBucket('this_week', actBy, now)) counts.thisWeek++
      if (inBucket('next_30', actBy, now))   counts.next30++
      if (inBucket('next_60', actBy, now))   counts.next60++
      if (!inBucket('next_90', actBy, now)) continue
      counts.next90++
      if (c.renewal.noticeDeadline && inBucket('next_30', c.renewal.noticeDeadline, now)) noticeNext30++
      if (c.value) {
        const n = Number(c.value.toString())
        if (!isNaN(n)) totalAcvNext90 += n
      }
      const md = (c.metadata ?? {}) as { renewalDecision?: string | null }
      if (!md.renewalDecision || md.renewalDecision === 'unknown') undecided++
    }

    return reply.send({ ...counts, undecided, totalAcvNext90, noticeNext30 })
  })
}

type Bucket = z.infer<typeof ListSchema>['bucket']

/** Whether a binding date falls in a bucket. Day-granular: "today" is not overdue. */
export function inBucket(bucket: Bucket, d: Date, now: Date): boolean {
  const days = daysFromToday(d, now)
  switch (bucket) {
    case 'overdue':   return days < 0
    case 'this_week': return days >= 0 && days <= 7
    case 'next_30':   return days >= 0 && days <= 30
    case 'next_60':   return days >= 0 && days <= 60
    case 'next_90':   return days >= 0 && days <= 90
    default:          return true
  }
}
