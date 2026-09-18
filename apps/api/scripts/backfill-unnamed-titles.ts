/**
 * Backfill contract titles that leaked into the UI as placeholder
 * strings (e.g. "Unnamed Contract - No Identified Parties",
 * "Unidentified Contract - Missing Party Details"). Replaces each
 * with a filename-derived title from the earliest version's s3Key.
 *
 * B.6.8 — defensive companion to the agents-service fix (review.py
 * now refuses to write these placeholders) and the frontend fallback
 * (ContractsPage displayTitle()). This script cleans historical rows.
 *
 * Usage:
 *   pnpm --filter api backfill-unnamed-titles          # dry-run
 *   pnpm --filter api backfill-unnamed-titles -- --fix # apply
 */
import { PrismaClient } from '@prisma/client'

const PLACEHOLDER_RE =
  /^(unnamed|unidentified|untitled|unknown) contract\b|no identified parties|missing party/i

function titleFromS3Key(key: string | null | undefined): string | null {
  if (!key) return null
  const tail = key.split('/').pop() ?? ''
  // S3 key format: `${orgId}/contracts/${timestamp}-${filename}`
  const withoutPrefix = tail.replace(/^\d+-/, '')
  const stem = withoutPrefix.replace(/\.[^.]+$/, '').trim()
  if (!stem) return null
  // Lightly humanise: split camelCase, underscores→spaces
  return stem
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function main() {
  const prisma = new PrismaClient()
  const fix = process.argv.includes('--fix')

  const rows = await prisma.contract.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      title: true,
      orgId: true,
      versions: {
        take: 1,
        orderBy: { versionNumber: 'asc' },
        select: { s3Key: true },
      },
    },
  })

  const candidates = rows.filter((r) => r.title && PLACEHOLDER_RE.test(r.title))
  console.log(`Found ${candidates.length} contract(s) with placeholder titles out of ${rows.length} total.\n`)

  let applied = 0
  let skipped = 0

  for (const c of candidates) {
    const from = c.title
    const derived = titleFromS3Key(c.versions[0]?.s3Key)
    const to = derived || 'Untitled contract'

    console.log(`  ${fix ? '✎' : '·'} ${c.id}  "${from}" → "${to}"`)

    if (fix) {
      await prisma.contract.update({
        where: { id: c.id },
        data: { title: to },
      })
      applied++
    } else {
      skipped++
    }
  }

  console.log(
    fix
      ? `\n✓ Updated ${applied} title(s).`
      : `\n(dry-run — pass --fix to apply ${candidates.length} update(s))`,
  )
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error('backfill failed:', err)
  process.exit(1)
})
