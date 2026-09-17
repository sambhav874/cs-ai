import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
// Bump usage so the demo shows the "Most used" tag + sort works.
const all = await prisma.template.findMany()
const updates = [
  { name: 'Mutual NDA — standard', usage: 12 },
  { name: 'Master Services Agreement — SaaS', usage: 7 },
  { name: 'Statement of Work — under MSA', usage: 3 },
]
for (const u of updates) {
  const ts = all.filter(t => t.name === u.name)
  for (const t of ts) {
    await prisma.template.update({ where: { id: t.id }, data: { usageCount: u.usage } })
    console.log(`bumped ${t.name} → ${u.usage}`)
  }
}
await prisma.$disconnect()
