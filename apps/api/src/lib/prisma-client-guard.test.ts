/**
 * Only src/lib/prisma.ts may construct a PrismaClient.
 *
 * The shared client carries the soft-delete extension that writes
 * `deletedAt: null` on create. On MongoDB, `where: { deletedAt: null }` does
 * NOT match a document where the field is absent — and Prisma omits unset
 * optional fields. So a raw `new PrismaClient()` writes rows that every list
 * query in the app silently cannot see.
 *
 * This was not hypothetical: prisma/seed.ts used a raw client and produced 10
 * demo contracts the app could not see. Caught only by inspecting the stored
 * documents, never by a failing test — which is why this guard exists.
 *
 * scripts/ is deliberately out of scope: those are dev tools, not shipped
 * code. If one of them seeds data an operator will use, it must import the
 * shared client too.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../..', import.meta.url).pathname
const SCANNED = ['src', 'prisma']
const ALLOWED = ['src/lib/prisma.ts']

function stripComments(src: string): string {
  // Prose that merely NAMES the pattern is not a violation — this file and
  // seed.ts both explain it in comments.
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|mts|mjs|js)$/.test(entry)) out.push(full)
  }
  return out
}

describe('PrismaClient construction', () => {
  it('happens only in src/lib/prisma.ts', () => {
    const offenders = SCANNED
      .flatMap(d => walk(join(ROOT, d)))
      .filter(f => /new\s+PrismaClient\s*\(/.test(stripComments(readFileSync(f, 'utf8'))))
      .map(f => relative(ROOT, f))
      .filter(f => !ALLOWED.includes(f))
      .sort()

    expect(offenders).toEqual([])
  })
})
