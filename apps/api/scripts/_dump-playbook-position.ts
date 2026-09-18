/**
 * Dump a single PlaybookPosition row (id + positionType + rules JSON)
 * for verify scripts.
 *
 * Usage:
 *   _dump-playbook-position.ts <orgId> <positionType> [categoryName]
 *   _dump-playbook-position.ts cmmx5... preferred "Limitation of Liability"
 */
import { PrismaClient } from '@prisma/client'

const orgId = process.argv[2]
const positionType = process.argv[3]
const categoryName = process.argv[4]
if (!orgId || !positionType) {
  console.error('usage: _dump-playbook-position.ts <orgId> <positionType> [categoryName]')
  process.exit(1)
}

const p = new PrismaClient()
let categoryId: string | undefined
if (categoryName) {
  const cat = await p.clauseCategory.findFirst({
    where: { orgId, name: { equals: categoryName, mode: 'insensitive' } },
    select: { id: true },
  })
  categoryId = cat?.id
}

const pos = await p.playbookPosition.findFirst({
  where: { orgId, positionType, ...(categoryId ? { clauseCategoryId: categoryId } : {}) },
  select: { id: true, positionType: true, rules: true, clauseCategoryId: true },
})
console.log(JSON.stringify(pos))
await p.$disconnect()
