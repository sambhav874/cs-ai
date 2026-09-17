/**
 * Index-on-create invariant (Wave 3.2) — a source-level tripwire.
 *
 * Every file that creates a Contract row must also index it into Elasticsearch,
 * or agent search can't find contracts made that way. This was violated by 4 of
 * the create paths; the guard fails loudly if a create site is ever added (or an
 * indexContract call removed) so the regression can't silently return.
 *
 * Not a substitute for the runtime path (that needs a live ES), but a cheap,
 * DB-free tripwire that runs in the default unit suite.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONTRACT_CREATE_FILES = [
  'src/routes/contracts.ts',
  'src/routes/requests.ts',
  'src/routes/agents.ts',
  'src/routes/internal-ai.ts',
  'src/workers/parse.worker.ts',
]

describe('index-on-create invariant (Wave 3.2)', () => {
  for (const rel of CONTRACT_CREATE_FILES) {
    it(`${rel}: creates contracts → also calls indexContract`, () => {
      const src = readFileSync(join(process.cwd(), rel), 'utf8')
      const createsContract = /\b(prisma|tx)\.contract\.create\b/.test(src)
      // Only enforce on files that actually create contracts.
      if (createsContract) {
        expect(src, `${rel} creates contracts but never calls indexContract`).toMatch(/\bindexContract\(/)
      }
    })
  }
})
