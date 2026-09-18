/**
 * Print admin@demo.com's orgId on stdout. Used by smoke scripts that need
 * to scope tool calls to the seeded org without going through the auth flow.
 */
import { PrismaClient } from '@prisma/client'

async function main() {
  const p = new PrismaClient()
  const u = await p.user.findFirst({ where: { email: 'admin@demo.com' } })
  if (!u) throw new Error('admin@demo.com not found — run the baseline seed first')
  console.log(u.orgId)
  await p.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
