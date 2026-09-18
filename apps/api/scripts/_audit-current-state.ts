/**
 * Snapshot of the current Contract AI state across ALL contracts the admin
 * can see. Not a test — a diagnostic to ground the docs/28 audit.
 *
 * Prints per-contract:
 *   id · title · type · analysisStatus · clauseCount · risk · kt keys · conf
 */
import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

async function main() {
  const u = await p.user.findFirst({ where: { email: 'admin@demo.com' } })
  if (!u) throw new Error('admin@demo.com not found')

  const contracts = await p.contract.findMany({
    where: { orgId: u.orgId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: {
      versions: {
        select: { id: true, plainText: true },
      },
    },
  })

  // Bucket analysis status counts.
  const statusCount: Record<string, number> = {}
  for (const c of contracts) {
    statusCount[c.analysisStatus] = (statusCount[c.analysisStatus] ?? 0) + 1
  }

  console.log(`\nTotal contracts in admin's org: ${contracts.length}`)
  console.log(`By analysisStatus:`)
  for (const [s, n] of Object.entries(statusCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(12)} ${n}`)
  }

  // Per-contract breakdown
  console.log('\nPer-contract:')
  console.log('  id                        │ status       │ type            │ clauses │ risk │ conf │ keyTerms')
  console.log('  ' + '─'.repeat(110))

  for (const c of contracts) {
    const versionIds = c.versions.map(v => v.id)
    const clauseCount = versionIds.length > 0
      ? await p.contractClause.count({ where: { versionId: { in: versionIds } } })
      : 0
    const kt = (c.keyTerms ?? {}) as Record<string, unknown>
    const ktKeys = Object.keys(kt).slice(0, 5).join(',')
    const risk = c.riskScore != null ? c.riskScore.toFixed(2) : '—   '
    const conf = c.overallConfidence != null ? c.overallConfidence.toFixed(2) : '—   '
    const textLen = c.versions[0]?.plainText?.length ?? 0

    console.log(
      `  ${c.id.padEnd(25)} │ ${c.analysisStatus.padEnd(12)} │ ${(c.type ?? '—').padEnd(15)} │ ${String(clauseCount).padStart(7)} │ ${risk} │ ${conf} │ ${ktKeys || '(empty)'} (txt ${textLen})`
    )
  }

  // Aggregate "wrote nothing" count (status DONE but 0 clauses or empty keyTerms)
  let emptyDone = 0
  for (const c of contracts) {
    if (c.analysisStatus !== 'DONE') continue
    const versionIds = c.versions.map(v => v.id)
    const clauseCount = versionIds.length > 0
      ? await p.contractClause.count({ where: { versionId: { in: versionIds } } })
      : 0
    const kt = (c.keyTerms ?? {}) as Record<string, unknown>
    if (clauseCount === 0 && Object.keys(kt).length === 0) emptyDone++
  }
  console.log(`\nContracts with status DONE but no clauses AND empty keyTerms: ${emptyDone}`)

  await p.$disconnect()
}

main().catch(async e => { console.error(e); await p.$disconnect(); process.exit(1) })
