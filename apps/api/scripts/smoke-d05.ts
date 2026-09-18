/**
 * D.0.5 smoke — verify the cost cap gates platform calls, lets BYOK through,
 * tracks daily spend correctly, and respects warn vs block policy.
 */
import { PrismaClient } from '@prisma/client'
import { resolveLlm } from '../src/lib/aiRouter.js'
import {
  recordCost, getDailyCost, resetDailyCost, getCostCapStatus, CostCapExceededError,
  invalidateCapConfig,
} from '../src/lib/costCap.js'
import { redis } from '../src/lib/redis.js'
import { encrypt, keyPrefix } from '../src/lib/encryption.js'

const p = new PrismaClient()
let fail = 0
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { console.log(`  ✗ ${msg}`); fail++ }
}

async function main() {
  const user = await p.user.findFirst({ where: { email: 'admin@demo.com' } })
  if (!user) throw new Error('seed missing')
  const orgId = user.orgId

  // Pre-clean
  await resetDailyCost(orgId)
  await p.orgAiKey.deleteMany({ where: { orgId } })
  await p.orgAiSettings.deleteMany({ where: { orgId } })

  // ── A — fresh slate, daily spend = 0 ───────────────────────────────────
  let used = await getDailyCost(orgId)
  check(used === 0, `(A) daily cost starts at $0 (got $${used})`)

  // ── B — recordCost increments atomically ───────────────────────────────
  await recordCost(orgId, 0.0042)
  await recordCost(orgId, 0.0008)
  used = await getDailyCost(orgId)
  check(Math.abs(used - 0.005) < 1e-9, `(B) two recordCost calls sum to $0.005 (got $${used})`)

  // ── C — under cap, router resolves cleanly ─────────────────────────────
  let r = await resolveLlm(orgId, 'default')
  check(r.source === 'platform', `(C) under cap → router returns platform key`)

  // ── D — set a tiny cap below current spend, expect block ───────────────
  await p.orgAiSettings.upsert({
    where: { orgId },
    create: { orgId, dailyCostCapUsd: 0.001, capPolicy: 'block' },
    update: { dailyCostCapUsd: 0.001, capPolicy: 'block' },
  })
  await invalidateCapConfig(orgId) // direct DB write → bust the 30s cache
  let blocked = false
  try { await resolveLlm(orgId, 'default') }
  catch (e) { if (e instanceof CostCapExceededError) blocked = true }
  check(blocked, `(D) over cap with block policy → CostCapExceededError`)

  // ── E — switch to warn policy, expect call to succeed ──────────────────
  await p.orgAiSettings.update({
    where: { orgId },
    data: { capPolicy: 'warn' },
  })
  await invalidateCapConfig(orgId)
  await resetDailyCost(orgId)
  await recordCost(orgId, 0.005) // back over the $0.001 cap
  let warnPassed = false
  try {
    r = await resolveLlm(orgId, 'default')
    warnPassed = r.source === 'platform'
  } catch { /* unexpected */ }
  check(warnPassed, `(E) over cap with warn policy → call still succeeds`)

  // ── F — BYOK bypasses cap entirely (cap=0, BYOK key present) ───────────
  await p.orgAiSettings.update({
    where: { orgId },
    data: { dailyCostCapUsd: 0, capPolicy: 'block' },
  })
  await invalidateCapConfig(orgId)
  await resetDailyCost(orgId) // clear cached config too
  await p.orgAiKey.create({
    data: {
      orgId, provider: 'openai',
      encryptedKey: encrypt('sk-byok-bypass-test'),
      keyPrefix: keyPrefix('sk-byok-bypass-test'),
      createdById: user.id,
    },
  })
  await recordCost(orgId, 1000) // way over any reasonable cap
  // Default tier order: anthropic/sonnet → openai/4.1; no anthropic key, openai BYOK present
  r = await resolveLlm(orgId, 'default')
  check(r.source === 'byok', `(F) BYOK present → bypasses cap entirely (got source=${r.source})`)

  // ── G — getCostCapStatus snapshot ──────────────────────────────────────
  const status = await getCostCapStatus(orgId)
  check(typeof status.usedUsd === 'number', `(G) cap-status returns usedUsd number`)
  check(typeof status.capUsd === 'number', `(G) cap-status returns capUsd number`)
  check(typeof status.pctUsed === 'number', `(G) cap-status returns pctUsed number`)
  check(['block', 'warn'].includes(status.policy), `(G) cap-status returns valid policy`)

  // ── Cleanup ────────────────────────────────────────────────────────────
  await resetDailyCost(orgId)
  await p.orgAiKey.deleteMany({ where: { orgId } })
  await p.orgAiSettings.deleteMany({ where: { orgId } })

  console.log()
  if (fail) {
    console.log(`✗ ${fail} check(s) failed`)
    process.exit(1)
  }
  console.log('✓ All D.0.5 cost-cap checks pass')
  await p.$disconnect()
  await redis.quit()
}

main().catch(async (e) => {
  console.error(e)
  await p.$disconnect()
  await redis.quit()
  process.exit(1)
})
