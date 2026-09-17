/** Dump all versions of a contract for debug. */
import { PrismaClient } from '@prisma/client'
const id = process.argv[2]
if (!id) { console.error('usage: _dump-contract-versions.ts <contractId>'); process.exit(1) }
const p = new PrismaClient()
const c = await p.contract.findUnique({
  where: { id }, select: { id: true, currentVersionId: true, title: true },
})
const vs = await p.contractVersion.findMany({
  where: { contractId: id },
  orderBy: { versionNumber: 'asc' },
  select: { id: true, versionNumber: true, changeNote: true, createdAt: true },
})
console.log(JSON.stringify({ contract: c, versions: vs }, null, 2))
await p.$disconnect()
