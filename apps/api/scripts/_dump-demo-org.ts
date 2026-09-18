import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const admin = await p.user.findFirst({ where: { email: 'admin@demo.com' }, select: { id: true, orgId: true } })
console.log('admin:', admin)
if (admin) {
  const org = await p.organization.findUnique({ where: { id: admin.orgId }, select: { id: true, name: true } })
  console.log('org:', org)
  const cats = await p.clauseCategory.findMany({ where: { orgId: admin.orgId }, select: { id: true, name: true } })
  console.log('categories in this org:', cats)
  const positions = await p.playbookPosition.findMany({ where: { orgId: admin.orgId }, select: { clauseCategoryId: true, positionType: true } })
  console.log('positions in this org:', positions.length, positions)
  const contracts = await p.contract.findMany({
    where: { orgId: admin.orgId, title: { contains: 'Acme' } },
    select: { id: true, title: true, currentVersionId: true, type: true },
  })
  console.log('Acme contracts:', contracts)
  for (const c of contracts.slice(0, 3)) {
    if (!c.currentVersionId) continue
    const cls = await p.contractClause.findMany({
      where: { versionId: c.currentVersionId, isSubChunk: false },
      select: { clauseType: true },
    })
    console.log('  '+c.title+' clauses:', cls.map(x => x.clauseType))
  }
}
await p.$disconnect()
