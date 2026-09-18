import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const msa = await p.contract.findFirst({
  where: { title: { contains: 'Acme' } },
  select: { id: true, title: true, orgId: true, type: true, currentVersionId: true },
})
console.log('MSA:', JSON.stringify(msa, null, 2))
if (msa?.currentVersionId) {
  const clauses = await p.contractClause.findMany({
    where: { versionId: msa.currentVersionId, isSubChunk: false },
    orderBy: { sortOrder: 'asc' },
    select: { clauseType: true, sortOrder: true },
  })
  console.log('clauseTypes:', clauses.map(c => `${c.sortOrder}:${c.clauseType}`))
}
const cats = await p.clauseCategory.findMany({
  where: { orgId: msa!.orgId },
  select: { id: true, name: true },
})
console.log('categories:', cats.map(c => c.name))
const positions = await p.playbookPosition.findMany({
  where: { orgId: msa!.orgId },
  select: { clauseCategoryId: true, positionType: true, contractTypes: true },
})
console.log('positions:', positions)
await p.$disconnect()
