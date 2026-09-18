/**
 * D.0.3 smoke — exercises the resolver across the four scenarios:
 *   (A) no override + no BYOK       → platform OpenAI
 *   (B) tier override (anthropic)   → falls back to OpenAI (no Anthropic key)
 *   (C) BYOK present                → returns BYOK key
 *   (D) override + BYOK both set    → BYOK wins for the chosen provider
 *
 * Cleans up after itself so it's safe to re-run.
 */
import { PrismaClient } from '@prisma/client'
import { resolveLlm, NoProviderAvailable } from '../src/lib/aiRouter.js'
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

  // Tear down anything from a previous run
  await p.orgAiKey.deleteMany({ where: { orgId } })
  await p.orgAiSettings.deleteMany({ where: { orgId } })

  // ── A — clean slate ────────────────────────────────────────────────────
  let r = await resolveLlm(orgId, 'default')
  check(r.provider === 'openai' && r.source === 'platform',
    `(A) clean: default tier → openai/platform (got ${r.provider}/${r.source})`)
  check(r.apiKey.startsWith('sk-'),
    `(A) clean: returned a real OpenAI key (prefix ${r.apiKey.slice(0, 5)}…)`)

  // ── B — set tier override to a provider with no key (anthropic) ────────
  await p.orgAiSettings.upsert({
    where: { orgId },
    create: { orgId, defaultModel: 'anthropic/claude-sonnet-4-6' },
    update: { defaultModel: 'anthropic/claude-sonnet-4-6' },
  })
  try {
    r = await resolveLlm(orgId, 'default')
    // Override forces ONLY anthropic candidate; with no anthropic key we expect throw
    check(false, `(B) override to anthropic: should throw NoProviderAvailable`)
  } catch (e) {
    check(e instanceof NoProviderAvailable,
      `(B) override to anthropic with no key → NoProviderAvailable thrown`)
  }

  // ── C — keep the override, add a BYOK Anthropic key ────────────────────
  const fakeKey = 'sk-ant-byok-FAKE-' + Math.random().toString(36).slice(2, 12)
  await p.orgAiKey.create({
    data: {
      orgId,
      provider: 'anthropic',
      encryptedKey: encrypt(fakeKey),
      keyPrefix: keyPrefix(fakeKey),
      createdById: user.id,
    },
  })
  r = await resolveLlm(orgId, 'default')
  check(r.provider === 'anthropic' && r.source === 'byok',
    `(C) BYOK present → returns anthropic/byok (got ${r.provider}/${r.source})`)
  check(r.apiKey === fakeKey,
    `(C) decrypted apiKey matches what we encrypted`)

  // ── D — drop the override; BYOK still present for anthropic ────────────
  await p.orgAiSettings.update({
    where: { orgId },
    data: { defaultModel: null },  // back to platform default order
  })
  r = await resolveLlm(orgId, 'default')
  // Default tier order: anthropic/sonnet → openai/4.1
  // Anthropic is first; we have BYOK for it → returns BYOK.
  check(r.provider === 'anthropic' && r.source === 'byok',
    `(D) no override but BYOK for highest-priority provider → uses BYOK`)

  // ── E — fast tier with no override + no BYOK for anthropic-fast ────────
  // Should fall through anthropic-haiku (no key) → openai-mini (platform)
  // (We have BYOK for anthropic but the model is haiku, and routing logic
  // operates on provider not model. So anthropic candidate uses BYOK.)
  // Actually this should resolve to anthropic/haiku with BYOK key — let's verify.
  r = await resolveLlm(orgId, 'fast')
  check(r.provider === 'anthropic' && r.source === 'byok',
    `(E) fast tier with anthropic BYOK → anthropic-haiku via BYOK key (got ${r.provider}/${r.model})`)

  // ── F — embed tier (no anthropic candidate; openai only) ───────────────
  r = await resolveLlm(orgId, 'embed')
  check(r.provider === 'openai' && r.source === 'platform',
    `(F) embed tier → openai/platform (only openai candidate)`)

  // ── Cleanup ────────────────────────────────────────────────────────────
  await p.orgAiKey.deleteMany({ where: { orgId } })
  await p.orgAiSettings.deleteMany({ where: { orgId } })

  console.log()
  if (fail) {
    console.log(`✗ ${fail} check(s) failed`)
    process.exit(1)
  }
  console.log('✓ All D.0.3 router checks pass')
  await p.$disconnect()
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1) })
