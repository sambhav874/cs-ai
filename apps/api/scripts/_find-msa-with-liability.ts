/**
 * Find an Acme MSA in this admin's org that has a non-sub-chunk
 * limitation_of_liability clause. Used by d51-verify.mjs to pick a
 * contract that actually exercises the playbook_check join.
 */
import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()
const admin = await p.user.findFirst({ where: { email: 'admin@demo.com' }, select: { orgId: true } })
if (!admin) { console.error('admin not found'); process.exit(1) }

const candidates = await p.contract.findMany({
  where: {
    orgId: admin.orgId,
    deletedAt: null,
    title: { contains: 'Acme' },
    currentVersionId: { not: null },
  },
  select: { id: true, title: true, orgId: true, currentVersionId: true },
})

for (const c of candidates) {
  const has = await p.contractClause.findFirst({
    where: { versionId: c.currentVersionId!, isSubChunk: false, clauseType: 'limitation_of_liability' },
    select: { id: true },
  })
  if (has) {
    console.log(JSON.stringify({ id: c.id, orgId: c.orgId, title: c.title }))
    await p.$disconnect()
    process.exit(0)
  }
}
console.log('null')
await p.$disconnect()
