import { prisma } from '../src/lib/prisma.js'

const obs = await prisma.obligation.findMany({
  select: { id: true, contractId: true, type: true, dueDate: true, notifiedAt: true, status: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
})
console.log('total:', obs.length)
for (const o of obs) {
  console.log(`  ${o.id.slice(-8)} | ${o.contractId.slice(-8)} | ${o.type.padEnd(10)} | due=${o.dueDate?.toISOString().slice(0,10) ?? '-'.repeat(10)} | notified=${o.notifiedAt?.toISOString().slice(11,16) ?? '-'.padEnd(5)} | ${o.status}`)
}
process.exit(0)
