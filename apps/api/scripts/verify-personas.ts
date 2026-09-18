/**
 * verify-personas.ts — quick DB-level count check against the persona seed
 * targets. Verifies orgs / users / counterparties / contracts / matters per
 * persona, and aggregates a portfolio summary.
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/verify-personas.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const PERSONAS = [
  { slug: 'vertex-cloud',          name: 'Vertex Cloud',          target: { contracts: 150, matters: 5, users: 4 } },
  { slug: 'caldera-health',        name: 'Caldera Health',        target: { contracts: 120, matters: 5, users: 4 } },
  { slug: 'ironbridge-industrial', name: 'Ironbridge Industrial', target: { contracts: 250, matters: 5, users: 5 } },
  { slug: 'lumen-bio',             name: 'Lumen Bio',             target: { contracts:  80, matters: 4, users: 3 } },
  { slug: 'beacon-logistics',      name: 'Beacon Logistics',      target: { contracts: 200, matters: 5, users: 4 } },
]

async function main() {
  console.log(`\n${'═'.repeat(78)}`)
  console.log(`Persona Verification — ${new Date().toISOString().slice(0, 10)}`)
  console.log(`${'═'.repeat(78)}\n`)

  const header = ['Persona', 'Users', 'CPs', 'Contracts', 'Matters', 'Status']
  console.log(`  ${header[0].padEnd(28)} ${header[1].padStart(5)} ${header[2].padStart(5)} ${header[3].padStart(10)} ${header[4].padStart(7)}  ${header[5]}`)
  console.log(`  ${'─'.repeat(28)} ${'─'.repeat(5)} ${'─'.repeat(5)} ${'─'.repeat(10)} ${'─'.repeat(7)}  ${'─'.repeat(8)}`)

  let totalUsers = 0, totalCps = 0, totalContracts = 0, totalMatters = 0
  let allOk = true

  for (const p of PERSONAS) {
    const org = await prisma.organization.findUnique({ where: { slug: p.slug }, select: { id: true } })
    if (!org) {
      console.log(`  ${p.name.padEnd(28)}  -- not seeded --`)
      allOk = false
      continue
    }
    const [users, cps, contracts, matters] = await Promise.all([
      prisma.user.count({ where: { orgId: org.id } }),
      prisma.counterparty.count({ where: { orgId: org.id } }),
      prisma.contract.count({ where: { orgId: org.id } }),
      prisma.matter.count({ where: { orgId: org.id } }),
    ])
    const ok =
      contracts === p.target.contracts &&
      matters === p.target.matters &&
      users === p.target.users
    if (!ok) allOk = false
    const status = ok ? '✓ ok' : '✗ MISS'
    const line = `  ${p.name.padEnd(28)} ${String(users).padStart(5)} ${String(cps).padStart(5)} ${String(contracts).padStart(10)} ${String(matters).padStart(7)}  ${status}`
    console.log(line)
    if (!ok) {
      console.log(`      target: contracts=${p.target.contracts} matters=${p.target.matters} users=${p.target.users}`)
    }
    totalUsers += users
    totalCps += cps
    totalContracts += contracts
    totalMatters += matters
  }

  console.log(`  ${'─'.repeat(28)} ${'─'.repeat(5)} ${'─'.repeat(5)} ${'─'.repeat(10)} ${'─'.repeat(7)}  ${'─'.repeat(8)}`)
  console.log(`  ${'TOTAL'.padEnd(28)} ${String(totalUsers).padStart(5)} ${String(totalCps).padStart(5)} ${String(totalContracts).padStart(10)} ${String(totalMatters).padStart(7)}`)

  // ─── Per-status breakdown for the whole corpus ──────────────────────────
  console.log(`\n  Status distribution across all 5 personas:`)
  const orgIds = (await Promise.all(PERSONAS.map(p => prisma.organization.findUnique({ where: { slug: p.slug }, select: { id: true } })))).map(o => o?.id).filter((id): id is string => !!id)
  const byStatus = await prisma.contract.groupBy({
    by: ['status'],
    where: { orgId: { in: orgIds } },
    _count: { _all: true },
    orderBy: { _count: { id: 'desc' } },
  })
  for (const row of byStatus) {
    const pct = ((row._count._all / totalContracts) * 100).toFixed(1)
    console.log(`    ${row.status.padEnd(22)} ${String(row._count._all).padStart(4)}  ${pct}%`)
  }

  // ─── Per-type breakdown ─────────────────────────────────────────────────
  console.log(`\n  Contract type distribution across all 5 personas:`)
  const byType = await prisma.contract.groupBy({
    by: ['type'],
    where: { orgId: { in: orgIds } },
    _count: { _all: true },
    orderBy: { _count: { id: 'desc' } },
  })
  for (const row of byType) {
    const pct = ((row._count._all / totalContracts) * 100).toFixed(1)
    console.log(`    ${row.type.padEnd(22)} ${String(row._count._all).padStart(4)}  ${pct}%`)
  }

  // ─── Top counterparties by contract count ───────────────────────────────
  console.log(`\n  Top 15 counterparties by contract count (all personas):`)
  const topCps = await prisma.contract.groupBy({
    by: ['orgId', 'counterpartyName'],
    where: { orgId: { in: orgIds } },
    _count: { _all: true },
    orderBy: { _count: { id: 'desc' } },
    take: 15,
  })
  // Resolve org names
  const orgMap = new Map<string, string>()
  for (const p of PERSONAS) {
    const org = await prisma.organization.findUnique({ where: { slug: p.slug }, select: { id: true, name: true } })
    if (org) orgMap.set(org.id, org.name)
  }
  for (const row of topCps) {
    console.log(`    ${(row.counterpartyName ?? '—').padEnd(38)} ${String(row._count._all).padStart(3)}  (${orgMap.get(row.orgId)})`)
  }

  // ─── Date sanity (a few "expiring soon" + "expired" sanity counts) ──────
  const today = new Date('2026-04-27T00:00:00Z')
  const in30 = new Date(today); in30.setUTCDate(in30.getUTCDate() + 30)
  const in90 = new Date(today); in90.setUTCDate(in90.getUTCDate() + 90)
  const expiringIn30 = await prisma.contract.count({
    where: { orgId: { in: orgIds }, expiryDate: { gte: today, lte: in30 } },
  })
  const expiringIn90 = await prisma.contract.count({
    where: { orgId: { in: orgIds }, expiryDate: { gte: today, lte: in90 } },
  })
  const expired = await prisma.contract.count({
    where: { orgId: { in: orgIds }, expiryDate: { lt: today } },
  })

  console.log(`\n  Date sanity (today = 2026-04-27):`)
  console.log(`    expiring in 30 days   ${String(expiringIn30).padStart(4)}`)
  console.log(`    expiring in 90 days   ${String(expiringIn90).padStart(4)}`)
  console.log(`    already expired       ${String(expired).padStart(4)}`)

  console.log(`\n${allOk ? '✓ All persona targets met.' : '✗ One or more personas off-target — see above.'}`)
}

main()
  .catch(e => { console.error('verify failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
