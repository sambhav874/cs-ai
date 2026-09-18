/**
 * Second pass on the audit: query the DB directly for the fields the audit
 * script measured via the API, to see which "0/12" findings were real bugs
 * vs measurement artifacts (the API response didn't include that field).
 */
import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

async function main() {
  const u = await p.user.findFirst({ where: { email: 'admin@demo.com' } })
  if (!u) throw new Error('admin@demo.com not found')

  // The audit ran earlier today and cleaned up after itself, but 2 contracts
  // weren't cleaned (Cyberdyne + Tyrell). Check those + any AUDIT prefix.
  // Look at ALL recent contracts (including the AI-demo seed + earlier audit
  // uploads that had rich summaries), to see whether fieldConfidence lives on
  // them — or whether the 0/12 in the audit was real.
  const contracts = await p.contract.findMany({
    where: { orgId: u.orgId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 15,
    include: { versions: { select: { id: true, clauseFlags: true } } },
  })

  console.log(`AUDIT contracts remaining in DB: ${contracts.length}\n`)

  for (const c of contracts) {
    const v = c.versions[0]
    const clauseCount = v
      ? await p.contractClause.count({ where: { versionId: v.id } })
      : 0
    const embedded = v
      ? await p.contractClause.count({ where: { versionId: v.id, embeddedAt: { not: null } } })
      : 0
    const fc = (c.fieldConfidence ?? {}) as Record<string, unknown>
    const kt = (c.keyTerms ?? {}) as Record<string, unknown>
    const flags = (v?.clauseFlags ?? {}) as Record<string, unknown>

    console.log(`── ${c.title}`)
    console.log(`   status: ${c.analysisStatus}  type: ${c.type ?? '—'}  cp: ${c.counterpartyName ?? '—'}`)
    console.log(`   clauses: ${clauseCount} (embedded: ${embedded})`)
    console.log(`   fieldConfidence keys: ${Object.keys(fc).length}  (${Object.keys(fc).slice(0, 5).join(', ')})`)
    console.log(`   keyTerms keys: ${Object.keys(kt).length}  (${Object.keys(kt).slice(0, 5).join(', ')})`)
    console.log(`   jurisdiction column: ${c.jurisdiction ?? '(null)'}`)
    console.log(`   effectiveDate column: ${c.effectiveDate ?? '(null)'}`)
    console.log(`   value column: ${c.value ?? '(null)'}`)
    console.log(`   currency column: ${c.currency ?? '(null)'}`)
    const meta = (c.metadata ?? {}) as Record<string, unknown>
    console.log(`   metadata keys: ${Object.keys(meta).length}  (${Object.keys(meta).slice(0, 5).join(', ')})`)
    console.log(`   clauseFlags: ${Object.keys(flags).length}`)
    console.log(`   summary: ${c.summary ? c.summary.slice(0, 80) + '…' : '(null)'}`)
    console.log(`   riskScore: ${c.riskScore ?? '(null)'}`)
    console.log(`   overallConfidence: ${c.overallConfidence ?? '(null)'}`)
    console.log()
  }

  await p.$disconnect()
}

main().catch(async e => { console.error(e); await p.$disconnect(); process.exit(1) })
