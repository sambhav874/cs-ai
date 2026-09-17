/**
 * reindex-personas.ts — backfill ES index for already-seeded persona contracts.
 *
 * Persona-test fix #2 root cause: seed-personas.ts (initial version) created
 * Contract rows in Prisma but did NOT publish them to Elasticsearch. As a
 * result, portfolio_search / contract_search only saw the original 10 demo
 * contracts in ES, hiding all 800 persona-seeded contracts from the agent.
 *
 * The seed script has been updated to index inline going forward. This
 * script is a one-off catch-up for the contracts already created.
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/reindex-personas.ts
 */
import { PrismaClient } from '@prisma/client'
import { indexContract } from '../src/lib/elasticsearch.js'

const PERSONA_SLUGS = [
  'vertex-cloud',
  'caldera-health',
  'ironbridge-industrial',
  'lumen-bio',
  'beacon-logistics',
]

const prisma = new PrismaClient()

async function main() {
  let total = 0
  let ok = 0
  let fail = 0

  for (const slug of PERSONA_SLUGS) {
    const org = await prisma.organization.findUnique({
      where: { slug }, select: { id: true, name: true },
    })
    if (!org) {
      console.log(`  · ${slug}: org not found, skipping`)
      continue
    }

    const contracts = await prisma.contract.findMany({
      where: { orgId: org.id, deletedAt: null },
      select: {
        id: true, title: true, type: true, status: true,
        counterpartyName: true, jurisdiction: true,
        riskScore: true, effectiveDate: true, expiryDate: true,
        createdAt: true, summary: true, tags: true, keyTerms: true,
        versions: {
          select: { plainText: true },
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
    })
    console.log(`\n  ${org.name}: ${contracts.length} contracts to index`)

    let perPersonaOk = 0
    let perPersonaFail = 0
    for (const c of contracts) {
      total++
      try {
        await indexContract(c.id, {
          orgId: org.id,
          title: c.title,
          type: c.type,
          status: c.status,
          counterpartyName: c.counterpartyName ?? undefined,
          jurisdiction: c.jurisdiction ?? undefined,
          plainText: c.versions[0]?.plainText ?? '',
          summary: c.summary ?? undefined,
          tags: c.tags,
          riskScore: c.riskScore ?? undefined,
          effectiveDate: c.effectiveDate?.toISOString(),
          expiryDate:    c.expiryDate?.toISOString(),
          createdAt:     c.createdAt.toISOString(),
          keyTerms: (c.keyTerms ?? {}) as Record<string, unknown>,
        })
        ok++
        perPersonaOk++
      } catch (e) {
        fail++
        perPersonaFail++
        console.warn(`      ⚠ "${c.title.slice(0, 60)}": ${(e as Error).message.slice(0, 80)}`)
      }
    }
    console.log(`    ✓ ${perPersonaOk}/${contracts.length} indexed (${perPersonaFail} failed)`)
  }

  // Refresh the index so a search hits the new docs immediately
  // (without waiting for the default refresh interval).
  try {
    const { Client } = await import('@elastic/elasticsearch')
    const es = new Client({ node: process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200' })
    await es.indices.refresh({ index: 'contracts' })
    console.log(`\n  ↻ ES index refreshed`)
  } catch (e) {
    console.warn(`  ⚠ refresh failed: ${(e as Error).message.slice(0, 80)}`)
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`✓ Reindex complete — ${ok}/${total} indexed, ${fail} failed`)
  console.log(`${'═'.repeat(70)}\n`)
}

main()
  .catch(e => { console.error('reindex failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
