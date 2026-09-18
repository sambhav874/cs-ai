/**
 * One-off cleanup for contract versions polluted by the pre-A.1 draft agent bug.
 *
 * Before fix A.1, the draft agent would write
 *   "<p>No suitable template found. Please create a template first.</p>"
 * into `draft_html` when Step 2 (select_template) returned nothing. That HTML
 * then got saved as the contract's version body, and the editor rendered it
 * as content.
 *
 * This script finds every contaminated ContractVersion. Default mode is
 * dry-run — pass `--fix` to actually clear the HTML.
 *
 * Usage:
 *   pnpm --filter api cleanup-broken-drafts          # dry run
 *   pnpm --filter api cleanup-broken-drafts -- --fix # apply
 */
import { PrismaClient } from '@prisma/client'

const POISON_FRAGMENT = 'No suitable template found'

async function main() {
  const prisma = new PrismaClient()
  const fix = process.argv.includes('--fix')

  const rows = await prisma.contractVersion.findMany({
    where: { htmlContent: { contains: POISON_FRAGMENT } },
    select: {
      id: true,
      contractId: true,
      versionNumber: true,
      changeNote: true,
      createdAt: true,
      contract: { select: { title: true, status: true, type: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  console.log(`Found ${rows.length} contaminated version(s):\n`)
  for (const r of rows) {
    console.log(
      `  v${r.versionNumber.toString().padStart(2)}  ${r.contract.type.padEnd(16)}  ${r.contract.status.padEnd(14)}  ${r.contract.title.slice(0, 60)}`,
    )
    console.log(`          version.id=${r.id}  note=${r.changeNote ?? '—'}`)
  }

  if (!rows.length) {
    await prisma.$disconnect()
    return
  }

  if (!fix) {
    console.log(
      `\nDry run. Pass --fix to clear htmlContent/plainText on these ${rows.length} version(s).`,
    )
    await prisma.$disconnect()
    return
  }

  const result = await prisma.contractVersion.updateMany({
    where: { htmlContent: { contains: POISON_FRAGMENT } },
    data: { htmlContent: '', plainText: '' },
  })
  console.log(`\nCleared htmlContent/plainText on ${result.count} version(s).`)
  console.log(
    `Contracts remain (with empty bodies) — editor will open to an empty page,`,
  )
  console.log(
    `which is correct behavior. Users can re-run "New Contract" to create a real draft.`,
  )
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
