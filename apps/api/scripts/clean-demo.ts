/**
 * Clean demo data — removes test artefacts and merges duplicate clause
 * categories across every organisation in the DB.
 *
 * Why: the UX review (docs/27) flagged three BLOCKER-grade data-quality
 * issues visible to a user opening /templates or /clauses:
 *   - "Aniket NDA" template visible in the Demo Org
 *   - "Temp" / "My One" clauses visible in the Demo Org
 *   - Duplicated categories `Limitation of Liability`, `IP Ownership`,
 *     `Confidentiality` (from two different seed runs overlapping)
 *   - Typo/test categories `My Categoty` + child `My Cat`
 *
 * Default mode is dry-run. Pass `--fix` to actually apply.
 *
 * Usage:
 *   pnpm --filter api clean-demo            # dry-run (report only)
 *   pnpm --filter api clean-demo -- --fix   # apply deletions
 *
 * Idempotent: safe to run repeatedly — it only touches rows that match
 * the test patterns or are exact-name duplicates inside the same org.
 */
import { PrismaClient } from '@prisma/client'

const TEST_CATEGORY_NAMES = new Set(['My Categoty', 'My Cat'])
const TEST_TEMPLATE_PATTERNS: RegExp[] = [
  /^aniket\b/i,
  /\btest\s*template\b/i,
  /^temp$/i,
  /^tmp\b/i,
]
const TEST_CLAUSE_TITLE_PATTERNS: RegExp[] = [
  /^temp$/i,
  /^my\s*one$/i,
  /^test\s*clause\b/i,
  /\btmp\b/i,
]

type Decision = {
  kind:
    | 'delete-category'
    | 'merge-category'
    | 'delete-template'
    | 'delete-clause'
    | 'dedupe-clause'
    | 'dedupe-template'
  orgId: string
  orgName: string
  id: string
  label: string
  reason: string
  // For merge-category / dedupe-*:
  mergeIntoId?: string
  mergeIntoLabel?: string
  clauseCount?: number
  playbookCount?: number
}

async function main() {
  const prisma = new PrismaClient()
  const fix = process.argv.includes('--fix')

  const decisions: Decision[] = []

  const orgs = await prisma.organization.findMany({ orderBy: { createdAt: 'asc' } })
  console.log(`Scanning ${orgs.length} organisation(s)…\n`)

  for (const org of orgs) {
    // ---- 1. Duplicate categories (same name within the org, multiple IDs) ----
    const cats = await prisma.clauseCategory.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: 'asc' },
    })
    const byName = new Map<string, typeof cats>()
    for (const c of cats) {
      const key = c.name.trim().toLowerCase()
      const list = byName.get(key) ?? []
      list.push(c)
      byName.set(key, list)
    }

    for (const [name, group] of byName) {
      if (group.length < 2) continue
      // Canonical = oldest. Non-canonical copies are merge candidates.
      const canonical = group[0]
      const dupes = group.slice(1)

      for (const dupe of dupes) {
        const [clauseCount, playbookCount] = await Promise.all([
          prisma.clauseLibraryItem.count({ where: { categoryId: dupe.id } }),
          prisma.playbookPosition.count({ where: { clauseCategoryId: dupe.id } }),
        ])
        decisions.push({
          kind: 'merge-category',
          orgId: org.id,
          orgName: org.name,
          id: dupe.id,
          label: `"${dupe.name}"`,
          mergeIntoId: canonical.id,
          mergeIntoLabel: `"${canonical.name}" (${canonical.id})`,
          clauseCount,
          playbookCount,
          reason: `duplicate-of-canonical (same name "${name}")`,
        })
      }
    }

    // ---- 2. Test-pattern categories ----
    for (const c of cats) {
      if (TEST_CATEGORY_NAMES.has(c.name)) {
        const clauseCount = await prisma.clauseLibraryItem.count({ where: { categoryId: c.id } })
        const childCount = await prisma.clauseCategory.count({ where: { parentCategoryId: c.id } })
        const playbookCount = await prisma.playbookPosition.count({ where: { clauseCategoryId: c.id } })
        decisions.push({
          kind: 'delete-category',
          orgId: org.id,
          orgName: org.name,
          id: c.id,
          label: `"${c.name}"${c.parentCategoryId ? ' (child)' : ''}`,
          clauseCount,
          playbookCount,
          reason: `test-artefact (children=${childCount}, clauses=${clauseCount}, playbook=${playbookCount})`,
        })
      }
    }

    // ---- 3. Test templates ----
    const tmpls = await prisma.template.findMany({
      where: { orgId: org.id, deletedAt: null },
    })
    for (const t of tmpls) {
      if (TEST_TEMPLATE_PATTERNS.some((re) => re.test(t.name))) {
        decisions.push({
          kind: 'delete-template',
          orgId: org.id,
          orgName: org.name,
          id: t.id,
          label: `"${t.name}"`,
          reason: 'test-pattern',
        })
      }
    }

    // ---- 4. Test clauses ----
    const clauses = await prisma.clauseLibraryItem.findMany({
      where: { orgId: org.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })
    const testClauseIds = new Set<string>()
    for (const c of clauses) {
      if (TEST_CLAUSE_TITLE_PATTERNS.some((re) => re.test(c.title))) {
        decisions.push({
          kind: 'delete-clause',
          orgId: org.id,
          orgName: org.name,
          id: c.id,
          label: `"${c.title}"`,
          reason: 'test-pattern',
        })
        testClauseIds.add(c.id)
      }
    }

    // ---- 5. Duplicate clauses within same (category, title) ----
    // Typically falls out of merged categories where both orgs had the same
    // canonical clause. Keep the oldest; soft-delete the rest.
    const clauseGroups = new Map<string, typeof clauses>()
    for (const c of clauses) {
      if (testClauseIds.has(c.id)) continue
      const key = `${c.categoryId}::${c.title.trim().toLowerCase()}`
      const list = clauseGroups.get(key) ?? []
      list.push(c)
      clauseGroups.set(key, list)
    }
    for (const [, group] of clauseGroups) {
      if (group.length < 2) continue
      const canonical = group[0]
      for (const dupe of group.slice(1)) {
        decisions.push({
          kind: 'dedupe-clause',
          orgId: org.id,
          orgName: org.name,
          id: dupe.id,
          label: `"${dupe.title}"`,
          mergeIntoId: canonical.id,
          mergeIntoLabel: `"${canonical.title}" (${canonical.id})`,
          reason: 'duplicate-in-same-category',
        })
      }
    }

    // ---- 6. Duplicate templates within same (org, name) ----
    const tmplGroups = new Map<string, typeof tmpls>()
    for (const t of tmpls) {
      if (TEST_TEMPLATE_PATTERNS.some((re) => re.test(t.name))) continue
      const key = t.name.trim().toLowerCase()
      const list = tmplGroups.get(key) ?? []
      list.push(t)
      tmplGroups.set(key, list)
    }
    for (const [, group] of tmplGroups) {
      if (group.length < 2) continue
      const canonical = group[0]
      for (const dupe of group.slice(1)) {
        decisions.push({
          kind: 'dedupe-template',
          orgId: org.id,
          orgName: org.name,
          id: dupe.id,
          label: `"${dupe.name}"`,
          mergeIntoId: canonical.id,
          mergeIntoLabel: `"${canonical.name}" (${canonical.id})`,
          reason: 'duplicate-name-in-same-org',
        })
      }
    }
  }

  // ---- Report ----
  if (!decisions.length) {
    console.log('✓ Nothing to clean. Data looks good.')
    await prisma.$disconnect()
    return
  }

  const byKind: Record<string, Decision[]> = {}
  for (const d of decisions) (byKind[d.kind] ??= []).push(d)

  const headings: Record<Decision['kind'], string> = {
    'merge-category': 'Duplicate clause categories to MERGE',
    'delete-category': 'Test-artefact categories to DELETE',
    'delete-template': 'Test-artefact templates to DELETE',
    'delete-clause': 'Test-artefact clauses to DELETE',
    'dedupe-clause': 'Duplicate clauses to SOFT-DELETE',
    'dedupe-template': 'Duplicate templates to SOFT-DELETE',
  }

  for (const kind of [
    'merge-category',
    'delete-category',
    'delete-template',
    'delete-clause',
    'dedupe-clause',
    'dedupe-template',
  ] as const) {
    const items = byKind[kind]
    if (!items?.length) continue
    console.log(`\n── ${headings[kind]} (${items.length}) ──`)
    for (const d of items) {
      const prefix = `  [${d.orgName}]`
      if (d.kind === 'merge-category') {
        console.log(
          `${prefix} ${d.label} (${d.id}) → ${d.mergeIntoLabel} :: clauses=${d.clauseCount}, playbook=${d.playbookCount}`,
        )
      } else if (d.kind === 'delete-category') {
        console.log(`${prefix} ${d.label} (${d.id}) :: ${d.reason}`)
      } else {
        console.log(`${prefix} ${d.label} (${d.id})`)
      }
    }
  }

  console.log(`\nTotal actions: ${decisions.length}`)

  if (!fix) {
    console.log('\n(dry-run — pass --fix to apply)')
    await prisma.$disconnect()
    return
  }

  // ---- Apply ----
  console.log('\nApplying changes…')
  let applied = 0

  // Process merges first so we don't delete a category that still has clauses.
  for (const d of decisions.filter((x) => x.kind === 'merge-category')) {
    // Move clauses into canonical
    await prisma.clauseLibraryItem.updateMany({
      where: { categoryId: d.id },
      data: { categoryId: d.mergeIntoId },
    })
    // Move playbook positions into canonical
    await prisma.playbookPosition.updateMany({
      where: { clauseCategoryId: d.id },
      data: { clauseCategoryId: d.mergeIntoId },
    })
    // Re-parent any children pointing at this category to the canonical parent instead
    await prisma.clauseCategory.updateMany({
      where: { parentCategoryId: d.id },
      data: { parentCategoryId: d.mergeIntoId },
    })
    // Now safe to delete the dupe
    await prisma.clauseCategory.delete({ where: { id: d.id } })
    console.log(`  ✓ merged category ${d.label} → ${d.mergeIntoLabel}`)
    applied++
  }

  // Now delete test categories — first orphan their children (re-parent to null)
  // and move their clauses + playbook to the parent (if any) or delete.
  for (const d of decisions.filter((x) => x.kind === 'delete-category')) {
    // Children: re-parent to null so they aren't cascaded, then delete them
    // in a second pass only if they're also in the delete list.
    await prisma.clauseCategory.updateMany({
      where: { parentCategoryId: d.id },
      data: { parentCategoryId: null },
    })
    // Delete any clauses inside (they're test data living in a test category)
    const clausesDeleted = await prisma.clauseLibraryItem.deleteMany({
      where: { categoryId: d.id },
    })
    // Delete any playbook positions
    await prisma.playbookPosition.deleteMany({ where: { clauseCategoryId: d.id } })
    // Delete the category
    await prisma.clauseCategory.delete({ where: { id: d.id } })
    console.log(`  ✓ deleted category ${d.label} (${clausesDeleted.count} clause(s) removed with it)`)
    applied++
  }

  for (const d of decisions.filter((x) => x.kind === 'delete-template')) {
    // Soft-delete; updateMany tolerates the row already being gone.
    const res = await prisma.template.updateMany({
      where: { id: d.id, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    if (res.count) console.log(`  ✓ soft-deleted template ${d.label}`)
    else console.log(`  · template already gone ${d.label}`)
    applied++
  }

  for (const d of decisions.filter((x) => x.kind === 'delete-clause')) {
    // updateMany tolerates the clause having been hard-deleted with its category
    const res = await prisma.clauseLibraryItem.updateMany({
      where: { id: d.id, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    if (res.count) console.log(`  ✓ soft-deleted clause ${d.label}`)
    else console.log(`  · clause already gone ${d.label}`)
    applied++
  }

  for (const d of decisions.filter((x) => x.kind === 'dedupe-clause')) {
    const res = await prisma.clauseLibraryItem.updateMany({
      where: { id: d.id, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    if (res.count) console.log(`  ✓ de-duplicated clause ${d.label} → ${d.mergeIntoLabel}`)
    applied++
  }

  for (const d of decisions.filter((x) => x.kind === 'dedupe-template')) {
    const res = await prisma.template.updateMany({
      where: { id: d.id, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    if (res.count) console.log(`  ✓ de-duplicated template ${d.label} → ${d.mergeIntoLabel}`)
    applied++
  }

  console.log(`\n✓ Applied ${applied} change(s).`)
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('clean-demo failed:', err)
  process.exit(1)
})
