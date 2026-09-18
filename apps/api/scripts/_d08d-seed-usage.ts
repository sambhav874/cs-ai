/**
 * Helper for d08d-verify.mjs — seeds or clears OrgUsageDaily rows on the
 * admin's org so the Usage section has something to render. Not a smoke
 * test in itself; never run directly in CI.
 *
 * Usage:
 *   pnpm tsx scripts/_d08d-seed-usage.ts seed   # insert 3 demo rows
 *   pnpm tsx scripts/_d08d-seed-usage.ts clear  # remove them all
 */
import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()
const action = process.argv[2]
if (!['seed', 'clear'].includes(action)) {
  console.error('Usage: _d08d-seed-usage.ts <seed|clear>')
  process.exit(1)
}

async function main() {
  const user = await p.user.findFirst({ where: { email: 'admin@demo.com' } })
  if (!user) throw new Error('seed user missing')
  const orgId = user.orgId

  // Always nuke first so re-seeds are idempotent.
  await p.orgUsageDaily.deleteMany({ where: { orgId } })

  if (action === 'clear') {
    await p.$disconnect()
    return
  }

  // Three rows totaling $8.00, spread across 3 recent days + 2 providers + 2 tiers.
  const today = new Date()
  const day = (offset: number) => {
    const d = new Date(today)
    d.setDate(d.getDate() - offset)
    return d.toISOString().slice(0, 10)
  }
  await p.orgUsageDaily.createMany({
    data: [
      { orgId, date: day(0), provider: 'openai',    model: 'gpt-4.1',             tier: 'default', callCount: 20, inputTokens: 40_000, outputTokens: 10_000, costUsd: 2.00 },
      { orgId, date: day(1), provider: 'anthropic', model: 'claude-sonnet-4-6',   tier: 'default', callCount: 10, inputTokens: 60_000, outputTokens: 15_000, costUsd: 4.00 },
      { orgId, date: day(2), provider: 'openai',    model: 'gpt-4.1-mini',        tier: 'fast',    callCount: 50, inputTokens: 20_000, outputTokens:  5_000, costUsd: 2.00 },
    ],
  })
  await p.$disconnect()
}

main().catch(async e => { console.error(e); await p.$disconnect(); process.exit(1) })
