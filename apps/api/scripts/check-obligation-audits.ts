/**
 * Verify Phase 08 audit events.
 *
 *   1. Force one OPEN obligation's dueDate to yesterday
 *   2. Call scanObligations() twice
 *   3. Confirm OBLIGATION_OVERDUE audit row exists ONCE for that obligation
 *   4. Confirm OBLIGATION_EXTRACTED + OBLIGATION_COMPLETED also exist somewhere
 */
import { prisma } from '../src/lib/prisma.js'
import { scanObligations } from '../src/lib/obligation-scanner.js'

let pass = 0, fail = 0
const r = (msg: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${msg}`) }
  else    { fail++; console.log(`  ✗ ${msg}${detail ? ' · ' + detail : ''}`) }
}

const candidate = await prisma.obligation.findFirst({
  where: { status: 'OPEN' },
  orderBy: { createdAt: 'asc' },
  include: { contract: { select: { orgId: true, title: true } } },
})
if (!candidate) {
  console.log('No OPEN obligation found — skipping')
  process.exit(0)
}
console.log(`▶ Forcing obligation ${candidate.id.slice(-8)} dueDate to yesterday + clearing notifiedAt`)
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
await prisma.obligation.update({
  where: { id: candidate.id },
  data: { dueDate: yesterday, notifiedAt: null, status: 'OPEN' },
})

// Clear any prior OBLIGATION_OVERDUE for this exact obligation so we get a clean read.
await prisma.auditEvent.deleteMany({
  where: {
    action: 'OBLIGATION_OVERDUE',
    resourceId: candidate.contractId,
    metadata: { path: ['obligationId'], equals: candidate.id } as never,
  },
})

console.log('▶ Scanner pass 1')
const res1 = await scanObligations({ leadDays: 365, force: true })
console.log(`  notified=${res1.notified} obligationsSeen=${res1.obligationsSeen} errors=${res1.errors.length}`)

console.log('▶ Scanner pass 2 (should be no-op for audit events)')
const res2 = await scanObligations({ leadDays: 365, force: true })
console.log(`  notified=${res2.notified} obligationsSeen=${res2.obligationsSeen} errors=${res2.errors.length}`)

const overdueEvents = await prisma.auditEvent.findMany({
  where: {
    action: 'OBLIGATION_OVERDUE',
    resourceId: candidate.contractId,
    metadata: { path: ['obligationId'], equals: candidate.id } as never,
  },
  orderBy: { createdAt: 'asc' },
})
r(`exactly 1 OBLIGATION_OVERDUE audit for obligation ${candidate.id.slice(-8)}`, overdueEvents.length === 1,
  `count=${overdueEvents.length}`)
if (overdueEvents[0]) {
  const md = overdueEvents[0].metadata as { obligationId?: string; daysOverdue?: number; severity?: string }
  r(`metadata.obligationId set`, md.obligationId === candidate.id)
  r(`metadata.daysOverdue >= 1`, (md.daysOverdue ?? 0) >= 1, `daysOverdue=${md.daysOverdue}`)
  r(`metadata.severity present`, !!md.severity)
}

// Spot check the other two audit types exist somewhere.
const extractedCount = await prisma.auditEvent.count({ where: { action: 'OBLIGATION_EXTRACTED' } })
const completedCount = await prisma.auditEvent.count({ where: { action: 'OBLIGATION_COMPLETED' } })
r(`OBLIGATION_EXTRACTED audits exist (${extractedCount})`, extractedCount > 0)
r(`OBLIGATION_COMPLETED audits exist (${completedCount})`, completedCount > 0)

console.log(`\nP8 step 5: ${pass}/${pass + fail} passed`)
process.exit(fail > 0 ? 1 : 0)
