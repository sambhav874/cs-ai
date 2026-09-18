import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const versions = await prisma.contractVersion.findMany({
  where: { contractId: 'cmodtj9gz000svopsfu00q258' },
  select: { id: true },
})
const r = await prisma.contractClause.updateMany({
  where: { versionId: { in: versions.map(v => v.id) } },
  data: { reviewState: 'unreviewed' },
})
console.log(`reset ${r.count} clauses across ${versions.length} versions`)
await prisma.$disconnect()
