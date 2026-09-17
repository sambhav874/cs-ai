/**
 * Phase 08 Step 1 — backfill Contract.metadata.obligations[] into the new
 * Obligation table.
 *
 * Idempotent: skips contracts whose obligations are already in the table.
 * Strips obligations[] / obligationsExtractedAt / obligationsSummary off
 * metadata after migrating; the table is now the source of truth.
 *
 * Usage:  pnpm tsx prisma/scripts/backfill-obligations.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface LegacyObligation {
  id?:          string
  type?:        string
  description?: string
  owner?:       string
  dueDate?:     string | null
  recurrence?:  string
  trigger?:     string | null
  quote?:       string
  severity?:    string
  sectionRef?:  string | null
  notifiedAt?:  string | null
  acknowledged?: boolean
}

async function main() {
  const contracts = await prisma.contract.findMany({
    select: { id: true, orgId: true, metadata: true },
  })

  let scanned   = 0
  let migrated  = 0
  let skipped   = 0
  let cleaned   = 0

  for (const c of contracts) {
    scanned++
    const md = (c.metadata ?? {}) as { obligations?: LegacyObligation[] }
    const list = Array.isArray(md.obligations) ? md.obligations : []
    if (list.length === 0) continue

    // If any rows already exist for this contract, treat as already-migrated.
    const existing = await prisma.obligation.count({ where: { contractId: c.id } })
    if (existing > 0) {
      skipped += list.length
    } else {
      for (const o of list) {
        const dueDate = o.dueDate ? safeDate(o.dueDate) : null
        const notifiedAt = o.notifiedAt ? safeDate(o.notifiedAt) : null
        const acknowledged = o.acknowledged === true

        await prisma.obligation.create({
          data: {
            // Don't reuse the legacy id — seed data has cross-contract collisions
            // and nothing external references obligation ids by FK.
            orgId:        c.orgId,
            contractId:   c.id,
            type:         (o.type ?? 'other').toLowerCase(),
            description:  (o.description ?? '').slice(0, 4000),
            owner:        (o.owner ?? 'unknown').toLowerCase(),
            dueDate,
            recurrence:   (o.recurrence ?? 'one-time').toLowerCase(),
            trigger:      o.trigger ? o.trigger.slice(0, 1000) : null,
            quote:        (o.quote ?? '').slice(0, 4000),
            severity:     (o.severity ?? 'medium').toLowerCase(),
            sectionRef:   o.sectionRef ?? null,
            status:       acknowledged ? 'COMPLETED' : 'OPEN',
            completedAt:  acknowledged ? new Date() : null,
            notifiedAt,
          },
        })
        migrated++
      }
    }

    // Strip the obligations off metadata so we don't end up with two sources of truth.
    const next: Record<string, unknown> = { ...(c.metadata as Record<string, unknown>) }
    delete next.obligations
    delete next.obligationsExtractedAt
    delete next.obligationsSummary
    await prisma.contract.update({
      where: { id: c.id },
      data:  { metadata: next as never },
    })
    cleaned++
  }

  console.log(`scanned ${scanned} contracts · migrated ${migrated} obligations · skipped ${skipped} already-migrated · cleaned ${cleaned} metadata blobs`)
}

function safeDate(s: string): Date | null {
  const t = new Date(s)
  return isNaN(t.getTime()) ? null : t
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
