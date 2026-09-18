import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const r = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_events' ORDER BY ordinal_position`
console.log(r.map(c => c.column_name))
await prisma.$disconnect()
