import { PrismaClient } from '@prisma/client'
import { indexContract } from '../src/lib/elasticsearch.js'

async function main() {
  const p = new PrismaClient()
  const user = await p.user.findFirst({ where: { email: 'admin@demo.com' } })
  if (!user) return
  const now = new Date()
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const cs = await p.contract.findMany({
    where: { orgId: user.orgId, deletedAt: null, expiryDate: { gte: now, lte: in30 } },
  })
  console.log(`Reindexing ${cs.length} expiring-soon contracts…`)
  for (const c of cs) {
    const v = await p.contractVersion.findFirst({
      where: { contractId: c.id },
      orderBy: { versionNumber: 'desc' },
    })
    await indexContract(c.id, {
      orgId: c.orgId,
      title: c.title ?? '',
      type: c.type,
      status: c.status,
      counterpartyName: c.counterpartyName ?? '',
      jurisdiction: c.jurisdiction ?? '',
      summary: c.summary ?? '',
      tags: c.tags,
      riskScore: c.riskScore ?? null,
      effectiveDate: c.effectiveDate?.toISOString() ?? null,
      expiryDate: c.expiryDate?.toISOString() ?? null,
      plainText: v?.plainText ?? '',
      clauseFlags: (c.metadata as Record<string, unknown>)?.clauseFlags ?? {},
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    } as Parameters<typeof indexContract>[1])
    console.log(`  ✓ ${c.title}`)
  }
  await p.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
