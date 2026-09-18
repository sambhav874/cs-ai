/**
 * D.0.4a smoke — exercise admin AI endpoints as a real user.
 * Login → GET settings (default) → PUT settings → GET keys → PUT key
 * → test key → DELETE key → GET usage. All cleanup at the end.
 */
const BASE = 'http://localhost:3001/api/v1'
const EMAIL = 'admin@demo.com'
const PASSWORD = 'password123'

let fail = 0
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { console.log(`  ✗ ${msg}`); fail++ }
}

async function main() {
  // Pre-clean any leftover state from prior smoke runs (settings, keys, usage)
  const { PrismaClient } = await import('@prisma/client')
  const p = new (PrismaClient as new () => InstanceType<typeof PrismaClient>)()
  const u = await p.user.findFirst({ where: { email: EMAIL } })
  if (u) {
    await p.orgAiKey.deleteMany({ where: { orgId: u.orgId } })
    await p.orgAiSettings.deleteMany({ where: { orgId: u.orgId } })
    await p.orgUsageDaily.deleteMany({ where: { orgId: u.orgId } })
  }
  await p.$disconnect()

  // Login
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status}`)
  const { accessToken } = (await loginRes.json()) as { accessToken: string }
  const auth = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }

  // ── GET settings on a fresh org → all defaults null ─────────────────────
  let r = await fetch(`${BASE}/admin/ai/settings`, { headers: auth })
  check(r.status === 200, `GET /settings → 200 (got ${r.status})`)
  let settings = await r.json()
  check(settings.defaultModel === null, `defaultModel starts null`)
  check(typeof settings.platformRouting === 'object', `platformRouting included`)
  check(Array.isArray(settings.platformRouting?.default), `platformRouting.default is an array`)

  // ── PUT settings to flip default model + set cap ─────────────────────────
  r = await fetch(`${BASE}/admin/ai/settings`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ defaultModel: 'openai/gpt-4.1', dailyCostCapUsd: 100 }),
  })
  check(r.status === 200, `PUT /settings → 200 (got ${r.status})`)
  settings = await r.json()
  check(settings.defaultModel === 'openai/gpt-4.1', `defaultModel persisted`)
  check(settings.dailyCostCapUsd === 100, `cap persisted`)

  // ── GET keys on fresh slate → 6 entries, all unconfigured ───────────────
  r = await fetch(`${BASE}/admin/ai/keys`, { headers: auth })
  check(r.status === 200, `GET /keys → 200`)
  const keysBody = await r.json() as { data: Array<{ provider: string; configured: boolean }> }
  check(keysBody.data.length === 6, `6 providers listed (got ${keysBody.data.length})`)
  check(keysBody.data.every((k) => !k.configured), `all unconfigured at start`)
  check(keysBody.data.some((k) => k.provider === 'openai'), `openai listed`)

  // ── PUT a fake openai key (use a real prefix so it looks plausible) ──────
  const fakeKey = 'sk-proj-fake-byok-' + Math.random().toString(36).slice(2)
  r = await fetch(`${BASE}/admin/ai/keys/openai`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ apiKey: fakeKey }),
  })
  check(r.status === 200, `PUT /keys/openai → 200 (got ${r.status})`)
  const putBody = await r.json() as { configured: boolean; keyPrefix: string }
  check(putBody.configured === true, `key marked configured`)
  check(putBody.keyPrefix === fakeKey.slice(0, 8), `keyPrefix = first 8 chars`)

  // Plaintext is NEVER returned in any GET
  r = await fetch(`${BASE}/admin/ai/keys`, { headers: auth })
  const allKeys = (await r.json()) as { data: Array<Record<string, unknown>> }
  const openaiRow = allKeys.data.find((k) => k.provider === 'openai')!
  check(!('apiKey' in openaiRow) && !('encryptedKey' in openaiRow),
    `GET never returns plaintext or ciphertext`)
  check(openaiRow.keyPrefix === fakeKey.slice(0, 8), `keyPrefix visible in list`)

  // ── Test the key (it's fake → should mark failed) ───────────────────────
  // Send an empty JSON body so Fastify doesn't 400 on Content-Type with no body.
  r = await fetch(`${BASE}/admin/ai/keys/openai/test`, { method: 'POST', headers: auth, body: '{}' })
  const testBodyRaw = await r.text()
  if (r.status !== 200) {
    console.log(`    DEBUG status=${r.status} body=${testBodyRaw.slice(0, 200)}`)
  }
  check(r.status === 200, `POST /keys/openai/test → 200`)
  let testBody: { ok?: boolean; error?: string } = {}
  try { testBody = JSON.parse(testBodyRaw) } catch { /* fall through */ }
  check(testBody.ok === false, `fake key fails the live test (got ok=${testBody.ok})`)
  check(typeof testBody.error === 'string', `error message returned`)

  // ── DELETE the key ──────────────────────────────────────────────────────
  r = await fetch(`${BASE}/admin/ai/keys/openai`, { method: 'DELETE', headers: auth })
  check(r.status === 200, `DELETE /keys/openai → 200`)

  // Confirm deletion
  r = await fetch(`${BASE}/admin/ai/keys`, { headers: auth })
  const afterDel = (await r.json()) as { data: Array<{ provider: string; configured: boolean }> }
  check(afterDel.data.find((k) => k.provider === 'openai')?.configured === false,
    `openai key gone after DELETE`)

  // ── Bad provider → 400 ──────────────────────────────────────────────────
  r = await fetch(`${BASE}/admin/ai/keys/nonsense`, {
    method: 'PUT', headers: auth, body: JSON.stringify({ apiKey: 'x' }),
  })
  check(r.status === 400, `bad provider name → 400 (got ${r.status})`)

  // ── GET usage on fresh org → empty totals ────────────────────────────────
  r = await fetch(`${BASE}/admin/ai/usage`, { headers: auth })
  check(r.status === 200, `GET /usage → 200`)
  const usage = await r.json() as { totals: { callCount: number }; byDay: unknown[] }
  check(usage.totals.callCount === 0, `usage starts empty (no calls yet)`)
  check(Array.isArray(usage.byDay), `byDay is an array`)

  // ── Cleanup ──────────────────────────────────────────────────────────────
  await fetch(`${BASE}/admin/ai/settings`, {
    method: 'PUT', headers: auth,
    body: JSON.stringify({ defaultModel: null, dailyCostCapUsd: null }),
  })

  console.log()
  if (fail) { console.log(`✗ ${fail} check(s) failed`); process.exit(1) }
  console.log('✓ All D.0.4a admin-AI checks pass')
}

main().catch((e) => { console.error(e); process.exit(1) })
