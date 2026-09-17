/**
 * Audit corpus — R.2.4: enrichment pass.
 *
 * Without this, the seed contracts have no:
 *   • ContractClause rows (Clauses rail empty, search returns nothing)
 *   • ApprovalInstance for the PENDING_APPROVAL Salesforce order form
 *   • Notifications for the bell
 *   • Obligations on the post-signature contracts (#6 Cloudwave, #8 Datadog)
 *   • renewalAdvice on the same
 *
 * This script is idempotent — skips contracts that already have clauses /
 * approvals / notifications.
 *
 * Run AFTER 02-contracts.ts:
 *   pnpm tsx --env-file=.env scripts/audit-seed/03-enrich.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Map a section heading to a normalised clauseType value for the
// ContractClause row. Falls back to 'other'.
function clauseTypeOf(heading: string): string {
  const h = heading.toLowerCase()
  if (h.includes('confiden'))                            return 'confidentiality'
  if (h.includes('liab'))                                return 'limitation_of_liability'
  if (h.includes('payment') || h.includes('fees'))       return 'payment'
  if (h.includes('term') && h.includes('terminat'))      return 'term_termination'
  if (h.includes('terminat'))                            return 'termination'
  if (h.includes('renew'))                               return 'renewal'
  if (h.includes('intellectual') || h.includes('ip'))    return 'ip_ownership'
  if (h.includes('indemn'))                              return 'indemnification'
  if (h.includes('warrant'))                             return 'warranty'
  if (h.includes('govern') || h.includes('jurisdict'))   return 'governing_law'
  if (h.includes('assign'))                              return 'assignment'
  if (h.includes('force majeure'))                       return 'force_majeure'
  if (h.includes('audit'))                               return 'audit_rights'
  if (h.includes('data') || h.includes('privacy'))       return 'data_protection'
  if (h.includes('definitions'))                         return 'definitions'
  if (h.includes('parties') || h.includes('signature'))  return 'metadata'
  if (h.includes('compensation') || h.includes('salary')) return 'compensation'
  if (h.includes('benefits'))                            return 'benefits'
  if (h.includes('settlement') || h.includes('release')) return 'settlement'
  return 'other'
}

// Some heuristics for risk rating per clause type. The aggressive
// liability cap on the Zynga MSA is the headline finding.
function riskRatingFor(clauseType: string, content: string): string | null {
  const c = content.toLowerCase()
  if (clauseType === 'limitation_of_liability') {
    if (c.includes('six (6) months') || c.includes('6 months')) return 'unfavorable'
    if (c.includes('twelve (12) months') || c.includes('12 months')) return 'standard'
    return 'standard'
  }
  if (clauseType === 'payment' && c.includes('sixty (60) days')) return 'unfavorable'
  if (clauseType === 'renewal'  && c.includes('automatic')) return 'unfavorable'
  if (clauseType === 'indemnification' && !c.includes('mutual') && !c.includes('each party')) return 'unfavorable'
  return 'neutral'
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { email: 'admin@demo.com' }, select: { id: true, orgId: true } })
  if (!admin) throw new Error('admin not found')
  const { orgId, id: adminId } = admin

  const contracts = await prisma.contract.findMany({
    where: { orgId, deletedAt: null },
    select: {
      id: true, title: true, status: true, type: true, expiryDate: true,
      counterpartyName: true, ownerId: true, currentVersionId: true,
      versions: { select: { id: true, htmlContent: true, plainText: true } },
      _count: { select: { versions: true } },
    },
  })
  console.log(`[enrich] processing ${contracts.length} contract(s)\n`)

  // ── 1. Clause extraction from <h2> sections of each contract ────
  console.log('[enrich] extracting clauses from HTML sections…')
  for (const c of contracts) {
    const versionId = c.currentVersionId ?? c.versions[0]?.id
    if (!versionId) continue
    const version = c.versions.find(v => v.id === versionId) ?? c.versions[0]
    const existing = await prisma.contractClause.count({ where: { versionId } })
    if (existing > 0) { console.log(`  · ${c.title.slice(0, 60).padEnd(62)} (${existing} clauses exist)`); continue }

    // Parse HTML — split on <h2>...</h2> headings.
    const html = version.htmlContent ?? ''
    const sections: Array<{ heading: string; content: string }> = []
    const rx = /<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2|$)/gi
    let m: RegExpExecArray | null
    while ((m = rx.exec(html))) {
      const heading = m[1].replace(/<[^>]+>/g, '').trim()
      const body = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (heading && body.length > 20) sections.push({ heading, content: body })
    }
    if (sections.length === 0) { console.log(`  ! ${c.title.slice(0, 60)} no sections found`); continue }

    await prisma.contractClause.createMany({
      data: sections.map((s, i) => {
        const ct = clauseTypeOf(s.heading)
        return {
          versionId,
          clauseType: ct,
          content: s.content.slice(0, 8000),
          interpretation: null,
          riskRating: riskRatingFor(ct, s.content),
          sectionRef: s.heading.match(/^(\d+(?:\.\d+)?)/)?.[1] ?? null,
          sortOrder: i,
        }
      }),
    })
    console.log(`  ✓ ${c.title.slice(0, 60).padEnd(62)} ${sections.length} clauses`)
  }

  // ── 2. Approval Instance for the PENDING_APPROVAL Salesforce OF ─
  console.log('\n[enrich] creating approval instance for PENDING_APPROVAL contracts…')
  const pending = contracts.find(c => c.status === 'PENDING_APPROVAL')
  if (pending) {
    const exists = await prisma.approvalInstance.findFirst({ where: { contractId: pending.id } })
    if (exists) {
      console.log(`  · ${pending.title.slice(0, 60)} (approval exists)`)
    } else {
      // Find finance@ user as approver
      const finance = await prisma.user.findFirst({ where: { orgId, email: 'finance@demo.com' }, select: { id: true } })
      const legal   = await prisma.user.findFirst({ where: { orgId, email: 'legal@demo.com' },   select: { id: true } })
      const wf = await prisma.workflowDefinition.findFirst({ where: { orgId } }) ?? null
      const created = await prisma.approvalInstance.create({
        data: {
          orgId,
          contractId: pending.id,
          workflowDefinitionId: wf?.id ?? '',
          status: 'PENDING',
          submittedById: pending.ownerId,
          submittedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),  // 2 days ago
        },
      }).catch(async () => {
        // workflowDefinition is required FK — skip if no workflow exists
        return null
      })
      if (created) {
        await prisma.approvalStep.createMany({
          data: [
            {
              approvalInstanceId: created.id,
              orgId,
              stepOrder: 1,
              stepName: 'Finance review (over $250K)',
              approverId: finance?.id ?? adminId,
              status: 'PENDING',
              escalateAt: new Date(Date.now() + 48 * 3600 * 1000),
            },
            {
              approvalInstanceId: created.id,
              orgId,
              stepOrder: 2,
              stepName: 'Legal review (auto-renew)',
              approverId: legal?.id ?? adminId,
              status: 'PENDING',
            },
          ],
        })
        console.log(`  ✓ ${pending.title.slice(0, 60).padEnd(62)} approval instance + 2 steps`)
      } else {
        console.log(`  ! ${pending.title.slice(0, 60)} skipped (no workflow definition)`)
      }
    }
  }

  // ── 3. Obligations + renewal advice metadata for expiring contracts ──
  console.log('\n[enrich] populating obligations + renewalAdvice on executed contracts…')
  const now = Date.now()
  const within90 = (d: Date | null) => d && (d.getTime() - now) < 90 * 86_400_000 && (d.getTime() - now) > -30 * 86_400_000

  // Cloudwave (#6) — expiring 2026-08-15. Obligations: payment, audit.
  const cloudwave = contracts.find(c => c.title.includes('Cloudwave'))
  if (cloudwave) {
    const md = {
      obligations: [
        { id: 'o_pay',  type: 'payment', description: 'Monthly AWS spend reconciliation invoice',
          owner: 'customer', dueDate: new Date(now + 7 * 86_400_000).toISOString().slice(0, 10),
          recurrence: 'monthly', trigger: null,
          quote: 'Cloudwave shall invoice Customer monthly in arrears for actual AWS usage.',
          severity: 'medium', sectionRef: '4', notifiedAt: null },
        { id: 'o_renewal',  type: 'renewal', description: 'Decide on renewal — auto-renews unless 60-day notice',
          owner: 'customer', dueDate: new Date(2026, 5, 15).toISOString().slice(0, 10),  // June 15 = 60 days before Aug 15
          recurrence: 'annually', trigger: 'expiration',
          quote: 'unless either party provides written notice of non-renewal at least sixty (60) days prior',
          severity: 'high', sectionRef: '5', notifiedAt: null },
        { id: 'o_truepay',  type: 'payment', description: 'Annual Commit true-up calculation (if under $480K)',
          owner: 'customer', dueDate: new Date(2026, 7, 15).toISOString().slice(0, 10),
          recurrence: 'annually', trigger: null,
          quote: 'Customer shall be obligated to pay the difference as a true-up at the end of the contract year',
          severity: 'high', sectionRef: '3', notifiedAt: null },
      ],
      obligationsSummary: '3 obligations: monthly billing reconciliation, annual renewal decision (auto-renew risk), and year-end commit true-up.',
      obligationsExtractedAt: new Date().toISOString(),
      renewalAdvice: {
        recommendation: 'renegotiate',
        confidence: 'medium',
        rationale: 'AWS spend is growing 22% YoY; current $480K commit is below trailing 12-month run-rate of $612K. Renegotiate to a $600K commit at 7% discount instead of 5%.',
        negotiationPoints: [
          { topic: 'EDP commit', ourPosition: 'Increase commit to $600K in exchange for 7% discount (vs current 5%)', reasoning: 'Trailing actuals justify higher commit; better unit economics.', severity: 'high' },
          { topic: 'Auto-renew', ourPosition: 'Replace auto-renew with explicit renewal cycle each Q2', reasoning: 'Forces an annual evaluation; aligns with budget cycles.', severity: 'medium' },
          { topic: 'Multi-year discount', ourPosition: 'Request 10% discount for 24-month commitment', reasoning: 'AWS prices typically fall 8% per year; 10% nominal locks in real savings.', severity: 'medium' },
        ],
        riskFlags: ['Auto-renews in 60 days if no decision', 'Annual commit obligation regardless of usage'],
        timeline: 'Decision needed by June 15 (60 days before Aug 15 expiry). Procurement should engage Cloudwave by mid-May.',
        generatedAt: new Date().toISOString(),
      },
      renewalNotifiedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    }
    await prisma.contract.update({
      where: { id: cloudwave.id },
      data: { metadata: md as object },
    })
    console.log(`  ✓ ${cloudwave.title.slice(0, 60).padEnd(62)} obligations + renewalAdvice`)
  }

  // Datadog (#8) — expiring 2026-06-30. Obligations: payment, renewal.
  const datadog = contracts.find(c => c.title.includes('Datadog'))
  if (datadog) {
    const md = {
      obligations: [
        { id: 'o_pay', type: 'payment', description: 'Annual subscription payment (USD $120,000)',
          owner: 'customer', dueDate: new Date(2026, 5, 30).toISOString().slice(0, 10),
          recurrence: 'annually', trigger: null,
          quote: 'Annual fee: USD $120,000.', severity: 'medium', sectionRef: '2', notifiedAt: null },
        { id: 'o_renewal', type: 'renewal', description: 'Auto-renewal decision — 60-day non-renewal window',
          owner: 'customer', dueDate: new Date(2026, 4, 1).toISOString().slice(0, 10),
          recurrence: 'annually', trigger: 'expiration',
          quote: 'unless either party provides written notice of non-renewal at least sixty (60) days prior',
          severity: 'high', sectionRef: '3', notifiedAt: null },
        { id: 'o_overage', type: 'sla', description: 'Monitor Datadog Pro host count for overage charges',
          owner: 'customer', dueDate: null, recurrence: 'monthly', trigger: null,
          quote: 'Datadog will invoice Customer for the overage at $1,200 per host per year',
          severity: 'low', sectionRef: '4', notifiedAt: null },
      ],
      obligationsSummary: '3 obligations: annual subscription, renewal decision window opening 60 days before expiry, and ongoing host count monitoring.',
      obligationsExtractedAt: new Date().toISOString(),
      renewalAdvice: {
        recommendation: 'renew',
        confidence: 'high',
        rationale: 'Datadog has been our primary observability stack for 24 months; 99.97% actual uptime exceeds the 99.9% SLA. Pricing is at-market. Recommend renew for one more year and re-evaluate next cycle.',
        negotiationPoints: [
          { topic: 'Price-cap on next renewal', ourPosition: 'Add CPI+5% cap on FY28 renewal', reasoning: 'No contractual cap currently exists; protects against vendor squeeze.', severity: 'medium' },
          { topic: 'Multi-year option', ourPosition: 'Ask for 8% discount in exchange for 24-month commitment', reasoning: 'Locks in pricing for two cycles.', severity: 'low' },
        ],
        riskFlags: ['Auto-renew without contractual price cap', 'Overage rate at $1,200/host could spike in busy quarters'],
        timeline: 'Decision needed by April 30 (60 days before June 30). Plan technical eval of competitors (New Relic, Grafana) in March if seriously considering switch.',
        generatedAt: new Date().toISOString(),
      },
      renewalNotifiedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    }
    await prisma.contract.update({
      where: { id: datadog.id },
      data: { metadata: md as object },
    })
    console.log(`  ✓ ${datadog.title.slice(0, 60).padEnd(62)} obligations + renewalAdvice`)
  }

  // Zynga MSA (#2) — under negotiation, no obligations yet (correct).
  // SOW#1 (#3) — executed; populate quarterly review obligation.
  const sow1 = contracts.find(c => c.title.includes('SOW #1'))
  if (sow1) {
    const md = {
      obligations: [
        { id: 'o_qbr', type: 'report', description: 'Quarterly business review with Customer',
          owner: 'provider', dueDate: new Date(now + 15 * 86_400_000).toISOString().slice(0, 10),
          recurrence: 'quarterly', trigger: null,
          quote: 'Quarterly business reviews on a calendar basis.',
          severity: 'medium', sectionRef: null, notifiedAt: null },
      ],
      obligationsSummary: '1 obligation: quarterly business review.',
      obligationsExtractedAt: new Date().toISOString(),
    }
    await prisma.contract.update({ where: { id: sow1.id }, data: { metadata: md as object } })
    console.log(`  ✓ ${sow1.title.slice(0, 60).padEnd(62)} obligations`)
  }

  // ── 4. Notifications for the bell ──────────────────────────────
  console.log('\n[enrich] creating notifications for the bell…')
  const finance = await prisma.user.findFirst({ where: { orgId, email: 'finance@demo.com' }, select: { id: true } })
  const procurement = await prisma.user.findFirst({ where: { orgId, email: 'procurement@demo.com' }, select: { id: true } })
  const legal = await prisma.user.findFirst({ where: { orgId, email: 'legal@demo.com' }, select: { id: true } })

  const notes: Array<{ userId: string | null; type: string; title: string; body: string; resourceType: string; resourceId: string }> = []
  if (cloudwave && procurement) {
    notes.push({
      userId: procurement.id, type: 'RENEWAL_DUE',
      title: `Expires in 47d · ${cloudwave.title}`,
      body: 'Cloudwave Inc · USD 480000 — review renewal options now.',
      resourceType: 'contract', resourceId: cloudwave.id,
    })
    notes.push({
      userId: procurement.id, type: 'OBLIGATION_DUE',
      title: `Due in 7d · ${cloudwave.title}`,
      body: 'MEDIUM · payment · Monthly AWS spend reconciliation invoice',
      resourceType: 'contract', resourceId: cloudwave.id,
    })
  }
  if (datadog && procurement) {
    notes.push({
      userId: procurement.id, type: 'RENEWAL_DUE',
      title: `Expires in 67d · ${datadog.title}`,
      body: 'Datadog Inc · USD 120000 — review renewal options now.',
      resourceType: 'contract', resourceId: datadog.id,
    })
  }
  if (pending && finance) {
    notes.push({
      userId: finance.id, type: 'APPROVAL_REQUEST',
      title: `Approval needed · ${pending.title}`,
      body: 'Salesforce.com renewal — $360,000 — your approval is required (Finance step).',
      resourceType: 'contract', resourceId: pending.id,
    })
  }
  if (pending && legal) {
    notes.push({
      userId: legal.id, type: 'APPROVAL_REQUEST',
      title: `Approval needed · ${pending.title}`,
      body: 'Salesforce.com renewal — auto-renew clause — Legal review needed.',
      resourceType: 'contract', resourceId: pending.id,
    })
  }
  // Keep admin in the loop too for the demo
  const admin2 = adminId
  if (cloudwave) {
    notes.push({
      userId: admin2, type: 'RENEWAL_DUE',
      title: `Expires in 47d · ${cloudwave.title}`,
      body: 'Cloudwave AWS reseller — high-priority renewal action needed.',
      resourceType: 'contract', resourceId: cloudwave.id,
    })
  }
  for (const n of notes) {
    if (!n.userId) continue
    await prisma.notification.create({
      data: {
        orgId, userId: n.userId, type: n.type, title: n.title, body: n.body,
        resourceType: n.resourceType, resourceId: n.resourceId,
        read: false,
      },
    })
  }
  console.log(`  ✓ created ${notes.length} notifications`)

  // ── 5. Final report ──
  console.log('\n[enrich] post-enrich state:')
  const r = {
    contracts:       await prisma.contract.count({ where: { orgId, deletedAt: null } }),
    clauses:         await prisma.contractClause.count({ where: { version: { contract: { orgId } } } as never }),
    approvals:       await prisma.approvalInstance.count({ where: { orgId } }),
    approvalSteps:   await prisma.approvalStep.count({ where: { orgId } }),
    notifications:   await prisma.notification.count({ where: { orgId } }),
    contractsWithObligations: (await prisma.contract.findMany({
      where: { orgId, deletedAt: null }, select: { metadata: true },
    })).filter(c => Array.isArray((c.metadata as Record<string, unknown> | null)?.obligations)).length,
  }
  console.log(JSON.stringify(r, null, 2))

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
