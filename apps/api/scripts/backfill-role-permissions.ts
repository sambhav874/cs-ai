/**
 * Backfill role permissions (P7.0.5 / F-72)
 *
 * Many existing orgs have system roles with `permissions: []` because the
 * roles were seeded before DEFAULT_ROLE_PERMISSIONS was wired. This script
 * walks every org × every system role and populates the JSON column from
 * the canonical defaults in `lib/permissions.ts`.
 *
 * Idempotent: skips roles that already have a non-empty permissions array
 * (we don't want to clobber custom-edited org policies).
 *
 * Run:
 *   pnpm tsx --env-file=.env scripts/backfill-role-permissions.ts
 */
import { PrismaClient } from '@prisma/client'
import { DEFAULT_ROLE_PERMISSIONS, DEFAULT_ROLE_DESCRIPTIONS } from '../src/lib/permissions.js'

const prisma = new PrismaClient()

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, slug: true } })
  console.log(`[backfill] ${orgs.length} orgs\n`)

  let updated = 0
  let skipped = 0
  let created = 0
  // P7.1.2 — When --force-roles=R1,R2 is passed, overwrite those roles'
  // permissions even if they already have rows. Used to push out fixes
  // to the default permission sets without clobbering custom edits to
  // OTHER roles. Pass-through flag via env var so tsx doesn't have to
  // parse argv.
  const forceRoles = (process.env.FORCE_ROLES ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (forceRoles.length > 0) console.log(`[backfill] force-overwrite roles: ${forceRoles.join(', ')}\n`)

  for (const org of orgs) {
    console.log(`org ${org.slug} (${org.id.slice(-8)}) — ${org.name}`)
    for (const [roleName, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const existing = await prisma.role.findFirst({
        where: { orgId: org.id, name: roleName },
        select: { id: true, permissions: true },
      })

      if (!existing) {
        // Role doesn't exist for this org — create it
        await prisma.role.create({
          data: {
            orgId: org.id,
            name: roleName,
            isSystem: true,
            description: DEFAULT_ROLE_DESCRIPTIONS[roleName] ?? null,
            permissions: perms as never,
          },
        })
        console.log(`  + ${roleName.padEnd(20)} CREATED with ${perms.length} permissions`)
        created++
        continue
      }

      const current = (existing.permissions ?? []) as unknown[]
      const isForced = forceRoles.includes(roleName)
      if (Array.isArray(current) && current.length > 0 && !isForced) {
        console.log(`  · ${roleName.padEnd(20)} (already has ${current.length} permissions — skipping)`)
        skipped++
        continue
      }

      await prisma.role.update({
        where: { id: existing.id },
        data: {
          permissions: perms as never,
          description: existing.id ? DEFAULT_ROLE_DESCRIPTIONS[roleName] ?? null : null,
        },
      })
      console.log(`  ✓ ${roleName.padEnd(20)} backfilled with ${perms.length} permissions`)
      updated++
    }
    console.log('')
  }

  console.log(`\n[backfill] done. Updated ${updated}, created ${created}, skipped ${skipped}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
