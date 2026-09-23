/**
 * Obligation scanner (P5.2 / docs/30 Wave H.2 — promoted to first-class
 * Obligation rows in P8 Step 1)
 *
 * Queries the Obligation table for items whose dueDate falls inside the
 * lead window and fires in-app + email notifications. Idempotent —
 * notifiedAt is stamped on each row that gets notified, so re-running
 * the scan the same day skips already-notified items via cooldownMs.
 *
 * Designed to be called:
 *   • manually from the admin UI (POST /cron/obligations)
 *   • daily from a real cron/scheduler
 *   • from a BullMQ repeatable job (P8 Step 6)
 *
 * JTBD — close the loop between "extractor pulled out deliverables"
 * and "someone actually did them on time". Without this, obligations
 * sit dormant and the customer misses a renewal / a payment / an audit
 * window — exactly the failure mode the post-signature wave is meant
 * to kill.
 */
import { prisma } from './prisma.js'
import { queueNotification } from './queue.js'
import { createAuditEvent } from './audit.js'
import { AuditAction, type RenewalTerms } from '@clm/types'
import { candidateExpiryRange, daysFromToday, withRenewalTerms } from './renewal-terms.js'

export interface ScanOptions {
  /** Only walk this one org. Omit to scan all orgs. */
  orgId?:    string
  /** How far ahead to look. Default 7 days; renewal advisor bumps to 90. */
  leadDays?: number
  /** Force-renotify even if notifiedAt was set within the cooldown. */
  force?:    boolean
  /** Min ms between renotifications for the same obligation. Default 72h. */
  cooldownMs?: number
}

export interface ScanResult {
  scannedContracts:  number
  obligationsSeen:   number
  notified:          number
  skippedAcked:      number
  skippedCooldown:   number
  skippedNoOwner:    number
  errors:            string[]
}

/**
 * Resolve who to notify for a given obligation + contract.
 * Priority: the obligation's assignee → the contract owner → an org admin.
 * Each must be an ACTIVE, non-deleted user in the same org: a reminder to a
 * deactivated owner is a reminder nobody reads. The last resort is an admin,
 * never "whichever user was created first", which could be anyone.
 * We never send to the counterparty (they're not in our Users table
 * unless they invited themselves; the portal has its own channel).
 */
async function resolveRecipient(
  orgId: string,
  assigneeId: string | null,
  contractOwnerId: string,
): Promise<{ userId: string; email: string | null } | null> {
  for (const id of [assigneeId, contractOwnerId]) {
    if (!id) continue
    const user = await prisma.user.findFirst({
      where: { id, orgId, status: 'ACTIVE', deletedAt: null },
      select: { id: true, email: true },
    })
    if (user) return { userId: user.id, email: user.email }
  }
  const admin = await prisma.user.findFirst({
    where: {
      orgId, status: 'ACTIVE', deletedAt: null,
      userRoles: { some: { role: { name: 'ADMIN' } } },
    },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  })
  return admin ? { userId: admin.id, email: admin.email } : null
}

/**
 * Walk every OPEN obligation in the lead window, fire notifications,
 * stamp notifiedAt back on each row. Idempotent via the cooldown check.
 */
export async function scanObligations(opts: ScanOptions = {}): Promise<ScanResult> {
  const leadDays   = opts.leadDays   ?? 7
  const cooldownMs = opts.cooldownMs ?? 72 * 60 * 60 * 1000
  const now        = Date.now()
  const windowEnd  = new Date(now + leadDays * 24 * 60 * 60 * 1000)
  const graceStart = new Date(now - 7 * 24 * 60 * 60 * 1000)

  const res: ScanResult = {
    scannedContracts: 0,
    obligationsSeen:  0,
    notified:         0,
    skippedAcked:     0,
    skippedCooldown:  0,
    skippedNoOwner:   0,
    errors:           [],
  }

  const obWhere: Record<string, unknown> = {
    status:  'OPEN',
    dueDate: { gte: graceStart, lte: windowEnd },
    // A deleted contract's obligations are not anyone's job any more.
    contract: { is: { deletedAt: null } },
  }
  if (opts.orgId) obWhere.orgId = opts.orgId

  const obligations = await prisma.obligation.findMany({
    where: obWhere as never,
    include: {
      contract: {
        select: { id: true, orgId: true, title: true, ownerId: true, status: true },
      },
    },
    take: 5_000,
  })
  res.obligationsSeen = obligations.length
  res.scannedContracts = new Set(obligations.map(o => o.contractId)).size

  for (const o of obligations) {
    if (!o.dueDate) continue
    if (!o.contract) continue

    if (!opts.force && o.notifiedAt) {
      const lastNote = o.notifiedAt.getTime()
      if (now - lastNote < cooldownMs) {
        res.skippedCooldown++
        continue
      }
    }

    const recipient = await resolveRecipient(o.contract.orgId, o.assigneeId, o.contract.ownerId)
    if (!recipient) { res.skippedNoOwner++; continue }

    const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0)
    const dueMid   = new Date(o.dueDate); dueMid.setHours(0, 0, 0, 0)
    const daysOut  = Math.round((dueMid.getTime() - todayMid.getTime()) / (24 * 60 * 60 * 1000))
    const severity = (o.severity ?? 'medium').toUpperCase()
    const prefix   = daysOut < 0
      ? `Overdue ${Math.abs(daysOut)}d`
      : daysOut === 0
        ? 'Due today'
        : daysOut === 1
          ? 'Due tomorrow'
          : `Due in ${daysOut}d`

    queueNotification({
      orgId:        o.contract.orgId,
      userId:       recipient.userId,
      type:         'OBLIGATION_DUE',
      title:        `${prefix} · ${o.contract.title}`,
      body:         `${severity} · ${o.type} · ${o.description}`.slice(0, 400),
      resourceType: 'contract',
      resourceId:   o.contract.id,
      email:        recipient.email ?? undefined,
    })

    try {
      await prisma.obligation.update({
        where: { id: o.id },
        data:  { notifiedAt: new Date() },
      })
      res.notified++
    } catch (err) {
      res.errors.push(`${o.id}: ${(err as Error).message.slice(0, 160)}`)
    }

    // P8 Step 5 — fire OBLIGATION_OVERDUE audit event the first time we
    // see an obligation past its due date. Idempotent — we check the
    // audit log for a prior event keyed on this obligationId before
    // writing, so re-running the scanner doesn't spam the trail.
    if (daysOut < 0) {
      try {
        // Matched on obligationId in memory: Prisma's JSON `path` filter is
        // relational-only and throws on MongoDB, which meant this event was
        // never written.
        const priors = await prisma.auditEvent.findMany({
          where: {
            orgId: o.contract.orgId,
            action: AuditAction.OBLIGATION_OVERDUE,
            resourceType: 'contract',
            resourceId: o.contract.id,
          },
          select: { metadata: true },
          take: 1_000,
        })
        const prior = priors.some(p => (p.metadata as { obligationId?: string } | null)?.obligationId === o.id)
        if (!prior) {
          await createAuditEvent({
            orgId: o.contract.orgId,
            // No userId — scanner is system-driven.
            action: AuditAction.OBLIGATION_OVERDUE,
            resourceType: 'contract',
            resourceId: o.contract.id,
            metadata: {
              obligationId: o.id,
              type: o.type,
              severity: o.severity,
              daysOverdue: -daysOut,
              dueDate: o.dueDate?.toISOString().slice(0, 10),
            },
          })
        }
      } catch (err) {
        res.errors.push(`overdue-audit ${o.id}: ${(err as Error).message.slice(0, 120)}`)
      }
    }
  }

  return res
}

// ─── P5.3 — Renewal scanner ─────────────────────────────────────────────────
/**
 * Walk every EXECUTED contract, fire a RENEWAL_DUE notification for each
 * whose binding date — the notice deadline for a contract that may renew
 * itself, else expiry (see lib/renewal-terms.ts) — falls within the lead
 * window and hasn't been notified during the cooldown.
 *
 * Separate from scanObligations() because the signal is different:
 *   • obligations scanner watches Obligation.dueDate
 *   • renewal  scanner watches the contract's renewal terms + metadata.renewalNotifiedAt
 *
 * Leading from expiry alone was the failure this exists to prevent: with
 * 90 days' notice and a 90-day lead, the first reminder landed on the day
 * the contract had already renewed. A renewal notification is *high-value,
 * low-frequency* — we ping once per cooldown until someone records a decision.
 */
export interface ScanRenewalsOptions {
  orgId?:       string
  /** Days ahead of the binding date to start reminding. Default 90. */
  leadDays?:    number
  /** Ignore cooldown and renotify. */
  force?:       boolean
  /** Min ms between renotifications. Default 7 days. */
  cooldownMs?:  number
  /** For tests. */
  now?:         Date
}

export interface RenewalScanResult {
  scannedContracts:  number
  candidates:        number
  notified:          number
  skippedCooldown:   number
  skippedDecided:    number
  skippedNoOwner:    number
  errors:            string[]
}

const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** Title and body of a renewal reminder; exported for tests. */
export function renewalMessage(
  c: { title: string; counterpartyName: string | null; value: { toString(): string } | null; currency: string | null },
  r: RenewalTerms,
  now: Date,
): { title: string; body: string } {
  const valueStr = c.value ? ` · ${c.currency ?? 'USD'} ${c.value.toString()}` : ''
  const who = `${c.counterpartyName ?? 'Counterparty'}${valueStr}`
  const expiry = r.expiryDate!

  if (r.noticeDeadline) {
    const days = daysFromToday(r.noticeDeadline, now)
    const notice = `${r.noticeDays} days' notice`
    const renews = r.autoRenew ? 'Renews automatically' : 'May renew automatically'
    if (days < 0) {
      return {
        title: `Notice deadline passed ${-days}d ago · ${c.title}`,
        body:  `${who} — ${renews.toLowerCase()} on ${fmtDay(expiry)}; the ${notice} deadline was ${fmtDay(r.noticeDeadline)}. Check whether notice can still be served.`.slice(0, 400),
      }
    }
    const when = days === 0 ? 'Notice due today' : `Notice due in ${days}d`
    return {
      title: `${when} · ${c.title}`,
      body:  `${who} — ${renews} on ${fmtDay(expiry)} unless notice is served by ${fmtDay(r.noticeDeadline)} (${notice}). Record a renewal decision.`.slice(0, 400),
    }
  }

  const days = daysFromToday(expiry, now)
  const label = days < 0 ? `Expired ${-days}d ago` : days === 0 ? 'Expires today' : `Expires in ${days}d`
  return {
    title: `${label} · ${c.title}`,
    body:  `${who} — review renewal options now.`.slice(0, 400),
  }
}

export async function scanRenewals(
  opts: ScanRenewalsOptions = {},
): Promise<RenewalScanResult> {
  const leadDays   = opts.leadDays   ?? 90
  const cooldownMs = opts.cooldownMs ?? 7 * 24 * 60 * 60 * 1000
  const nowDate    = opts.now ?? new Date()
  const now        = nowDate.getTime()
  const window     = { now: nowDate, lookaheadDays: leadDays }

  const res: RenewalScanResult = {
    scannedContracts: 0, candidates: 0, notified: 0,
    skippedCooldown: 0, skippedDecided: 0, skippedNoOwner: 0, errors: [],
  }

  const where: Record<string, unknown> = {
    deletedAt:  null,
    status:     'EXECUTED',
    expiryDate: candidateExpiryRange(window),
  }
  if (opts.orgId) where.orgId = opts.orgId

  const fetched = await prisma.contract.findMany({
    where: where as never,
    select: {
      id: true, orgId: true, title: true, ownerId: true,
      counterpartyName: true, metadata: true, expiryDate: true, keyTerms: true,
      type: true, value: true, currency: true,
    },
    take: 5_000,
  })
  res.scannedContracts = fetched.length
  const contracts = await withRenewalTerms(fetched, window)

  for (const c of contracts) {
    res.candidates++

    const md = (c.metadata ?? {}) as {
      renewalNotifiedAt?:  string
      renewalDecision?:    string  // 'renew' | 'renegotiate' | 'let_expire' | 'unknown'
    }
    if (md.renewalDecision && md.renewalDecision !== 'unknown') {
      // Owner already logged a decision — no more reminders.
      res.skippedDecided++
      continue
    }
    if (!opts.force && md.renewalNotifiedAt) {
      const last = new Date(md.renewalNotifiedAt).getTime()
      if (!isNaN(last) && now - last < cooldownMs) {
        res.skippedCooldown++
        continue
      }
    }

    const recipient = await resolveRecipient(c.orgId, null, c.ownerId)
    if (!recipient) { res.skippedNoOwner++; continue }

    const msg = renewalMessage(c, c.renewal, nowDate)
    queueNotification({
      orgId:        c.orgId,
      userId:       recipient.userId,
      type:         'RENEWAL_DUE',
      title:        msg.title,
      body:         msg.body,
      resourceType: 'contract',
      resourceId:   c.id,
      email:        recipient.email ?? undefined,
    })

    try {
      const nextMeta = { ...(c.metadata as Record<string, unknown>), renewalNotifiedAt: new Date(now).toISOString() }
      await prisma.contract.update({
        where: { id: c.id },
        data:  { metadata: nextMeta as never },
      })
      res.notified++
    } catch (err) {
      res.errors.push(`${c.id}: ${(err as Error).message.slice(0, 160)}`)
    }
  }

  return res
}
