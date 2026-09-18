/**
 * Trace what actually happens to ContractClause rows for the AUDIT contracts.
 * Looking for: did they ever exist? Were they deleted? When?
 */
import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

async function main() {
  const u = await p.user.findFirst({ where: { email: 'admin@demo.com' } })
  if (!u) throw new Error('admin@demo.com not found')

  const auditContracts = await p.contract.findMany({
    where: { orgId: u.orgId, deletedAt: null, title: { startsWith: 'AUDIT:' } },
    orderBy: { createdAt: 'desc' },
    include: { versions: { select: { id: true, plainText: true, clauseFlags: true } } },
  })

  console.log(`AUDIT contracts: ${auditContracts.length}\n`)

  for (const c of auditContracts.slice(0, 6)) {
    console.log(`── ${c.title}`)
    console.log(`   contractId: ${c.id}`)
    console.log(`   analysisStatus: ${c.analysisStatus}`)
    for (const v of c.versions) {
      const clauses = await p.contractClause.findMany({
        where: { versionId: v.id },
        select: { id: true, clauseType: true, sortOrder: true, isSubChunk: true, embeddedAt: true },
        orderBy: { sortOrder: 'asc' },
      })
      const flags = v.clauseFlags as Record<string, unknown> | null
      console.log(`   versionId: ${v.id}  text=${v.plainText?.length ?? 0}ch  clauses=${clauses.length}  flags=${flags ? Object.keys(flags).length : 0}`)
      for (const cl of clauses.slice(0, 3)) {
        console.log(`     - [${cl.sortOrder}] ${cl.clauseType.padEnd(30)} sub=${cl.isSubChunk} emb=${!!cl.embeddedAt}`)
      }
      if (clauses.length > 3) console.log(`     … and ${clauses.length - 3} more`)
    }
    console.log()
  }

  // Global tally
  const versionIds = auditContracts.flatMap(c => c.versions.map(v => v.id))
  const totalClauses = versionIds.length > 0
    ? await p.contractClause.count({ where: { versionId: { in: versionIds } } })
    : 0
  console.log(`Across all ${auditContracts.length} AUDIT contracts: ${totalClauses} total clauses`)

  await p.$disconnect()
}

main().catch(async e => { console.error(e); await p.$disconnect(); process.exit(1) })
