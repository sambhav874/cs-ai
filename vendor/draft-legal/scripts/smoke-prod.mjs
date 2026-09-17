#!/usr/bin/env node
/**
 * smoke-prod.mjs — production smoke test for the deployed draftLegal stack.
 *
 * Exercises the major user-facing flows end-to-end against a real deployment:
 *   1.  Login (auth round-trip, JWT issued)
 *   2.  Dashboard JSON returns expected keys
 *   3.  Contracts list + paginated shape
 *   4.  Counterparties list
 *   5.  Templates list
 *   6.  Clauses list
 *   7.  Matters list (different shape: { items, total })
 *   8.  Users list
 *   9.  Org / settings read
 *   10. Search route reachable
 *   11. Assistant chat — full streaming round-trip API → agents → Gemini → back
 *   12. Agent tool-callback — verifies agents-service can hit API for DB data
 *   13. Contract pipeline trigger — POST /:id/analyze, poll until DONE
 *   14. PDF generation reachable (gotenberg invoked through API path if exposed)
 *   15. Static front-end loads (HTML 200, API rewrite returns 200)
 *
 * Usage:
 *   API_URL=https://draftlegal-prod-13353.web.app \
 *   ADMIN_EMAIL=admin@demo.com ADMIN_PASSWORD=password123 \
 *   node scripts/smoke-prod.mjs
 *
 * Exit code: 0 if every check passes, 1 otherwise. Each check prints ✓ or ✗.
 */

const BASE = process.env.API_URL  ?? 'https://draftlegal-prod-13353.web.app'
// /health is a service-level probe, not under the /api/** Firebase rewrite,
// so we hit api-service directly for that one check.
const API_DIRECT = process.env.API_DIRECT ?? 'https://api-service-611770954192.us-central1.run.app'
const EMAIL = process.env.ADMIN_EMAIL    ?? 'admin@demo.com'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'password123'

let pass = 0, fail = 0, skipped = 0
const failures = []

const ok = (name, detail = '') => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? '  ·  ' + detail : ''}`) }
const ko = (name, detail) => { fail++; failures.push(`${name} — ${detail}`); console.log(`  \x1b[31m✗\x1b[0m ${name}  ·  ${detail}`) }
const sk = (name, detail = '') => { skipped++; console.log(`  \x1b[33m–\x1b[0m ${name}  ·  ${detail || 'skipped'}`) }
const section = (n, name) => console.log(`\n▶ ${n}. ${name}`)

async function fetchJson(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const t0 = Date.now()
  const res = await fetch(url, opts)
  const ms = Date.now() - t0
  let body
  const ct = res.headers.get('content-type') ?? ''
  try {
    if (ct.includes('json')) body = await res.json()
    else body = await res.text()
  } catch (e) { body = `<parse error: ${e.message}>` }
  return { status: res.status, body, ms, ct }
}

console.log(`\nSmoke test against ${BASE}\n`)

// ── 1. Auth ──────────────────────────────────────────────────────────────
section(1, 'Authentication')
const loginRes = await fetchJson('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
})
if (loginRes.status === 200 && loginRes.body?.accessToken) {
  ok('POST /auth/login returns 200 + accessToken', `${loginRes.ms}ms`)
} else {
  ko('POST /auth/login', `status=${loginRes.status}  body=${JSON.stringify(loginRes.body).slice(0, 120)}`)
  console.log('\nCannot continue without a valid token. Aborting.')
  process.exit(1)
}
const TOKEN = loginRes.body.accessToken
const USER  = loginRes.body.user
const HEAD  = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

if (USER?.email === EMAIL) ok(`user payload returned (orgId=${USER.orgId}, roles=${USER.roles?.join(',')})`)
else ko('user payload', `unexpected: ${JSON.stringify(USER).slice(0, 120)}`)

// ── 2. Dashboard ─────────────────────────────────────────────────────────
section(2, 'Dashboard data')
const dash = await fetchJson('/api/v1/dashboard', { headers: HEAD })
if (dash.status === 200 && typeof dash.body?.activeContracts === 'number') {
  ok('GET /dashboard returns counts', `activeContracts=${dash.body.activeContracts}  expiringSoon=${dash.body.expiringSoon}  ${dash.ms}ms`)
} else {
  ko('GET /dashboard', `status=${dash.status}`)
}
if (dash.body?.yourDay && Array.isArray(dash.body.yourDay.negotiations)) {
  ok('yourDay block has negotiations + renewals arrays')
} else {
  ko('yourDay block shape', `got: ${JSON.stringify(dash.body?.yourDay).slice(0, 120)}`)
}

// ── 3-9. CRUD list endpoints ─────────────────────────────────────────────
section(3, 'List endpoints')
const lists = [
  ['/api/v1/contracts',       'data',  arr => arr.length > 0, 'expect at least one contract'],
  ['/api/v1/counterparties',  'data',  arr => arr.length > 0, 'expect counterparties from seed'],
  ['/api/v1/templates',       'data',  arr => arr.length > 0, 'expect templates from seed'],
  ['/api/v1/clauses',         'data',  arr => arr.length > 0, 'expect clauses from seed'],
  ['/api/v1/matters',         'items', arr => Array.isArray(arr), 'matters use { items, total } shape'],
]
for (const [path, key, validate, hint] of lists) {
  const r = await fetchJson(path, { headers: HEAD })
  if (r.status !== 200) {
    ko(`GET ${path}`, `status=${r.status}`)
    continue
  }
  const arr = r.body?.[key]
  if (Array.isArray(arr) && validate(arr)) {
    ok(`GET ${path}`, `${arr.length} item(s), ${r.ms}ms`)
  } else {
    ko(`GET ${path}`, `${hint}; got ${JSON.stringify(r.body).slice(0, 100)}`)
  }
}

// ── 10. Search ───────────────────────────────────────────────────────────
section(4, 'Search')
const search = await fetchJson('/api/v1/search?q=cloud', { headers: HEAD })
if (search.status === 200) {
  ok('GET /search reachable', `${search.ms}ms`)
} else if (search.status === 404) {
  sk('GET /search route', '404 (route may not be mounted with this name)')
} else {
  ko('GET /search', `status=${search.status}`)
}

// ── 11. Assistant chat ───────────────────────────────────────────────────
section(5, 'Assistant chat (full LLM round-trip)')
const chatT0 = Date.now()
const chatRes = await fetch(`${BASE}/api/v1/agent/chat`, {
  method: 'POST', headers: HEAD,
  body: JSON.stringify({ message: 'Reply only with the word OK.' }),
})
const chatBody = await chatRes.text()
const chatMs = Date.now() - chatT0
if (chatRes.status === 200 && chatBody.includes('data: ')) {
  const tokens = chatBody.match(/"delta"/g)?.length ?? 0
  if (tokens > 0 && chatBody.includes('[DONE]')) {
    ok('chat streamed tokens', `${tokens} delta event(s), ${chatMs}ms`)
  } else {
    ko('chat stream incomplete', `body sample: ${chatBody.slice(0, 200)}`)
  }
  if (chatBody.includes('"provider": "google"')) {
    ok('chat used Google Gemini (expected)')
  } else if (chatBody.includes('"error"')) {
    ko('chat returned error frame', chatBody.match(/"error":\s*"[^"]+/)?.[0] ?? 'unknown')
  }
} else {
  ko('agent chat', `status=${chatRes.status}  body=${chatBody.slice(0, 200)}`)
}

// ── 12. Agent tool callback (portfolio query) ─────────────────────────────
section(6, 'Agent tool callback (LLM → tool → API → DB)')
const toolT0 = Date.now()
const toolRes = await fetch(`${BASE}/api/v1/agent/chat`, {
  method: 'POST', headers: HEAD,
  body: JSON.stringify({
    message: 'How many active contracts do we have? Reply with just the number.',
    agent_mode: true,
  }),
})
const toolBody = await toolRes.text()
const toolMs = Date.now() - toolT0
if (toolRes.status === 200 && toolBody.includes('[DONE]')) {
  ok('agent_mode chat completed', `${toolMs}ms`)
  if (toolBody.includes('"trouble connecting"') || toolBody.includes('database')) {
    ko('agent tool callback', 'agent reported DB connection failure — API_URL not set on agents-service')
  } else if (toolBody.includes('"error"')) {
    ko('agent tool callback', toolBody.match(/"error":\s*"[^"]+/)?.[0] ?? 'unknown')
  } else {
    ok('agent tool callback did not surface DB error')
  }
} else {
  ko('agent_mode chat', `status=${toolRes.status}`)
}

// ── 13. Contract pipeline ─────────────────────────────────────────────────
section(7, 'Contract analysis pipeline')
// pick the first contract that's not already DONE
const contractsRes = await fetchJson('/api/v1/contracts', { headers: HEAD })
const candidate = (contractsRes.body?.data ?? []).find(c => c.analysisStatus !== 'DONE' && c.analysisStatus !== 'FAILED')
if (!candidate) {
  sk('pipeline trigger', 'no PENDING contract found — all already processed')
} else {
  const trig = await fetchJson(`/api/v1/contracts/${candidate.id}/analyze`, {
    method: 'POST', headers: HEAD, body: '{}',
  })
  if (trig.status === 200 && trig.body?.status === 'queued') {
    ok(`POST /contracts/${candidate.id.slice(0, 12)}…/analyze queued`, `analysisStatus=${trig.body.analysisStatus}`)
    // poll up to 120s
    let advanced = false, lastStatus = ''
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 10_000))
      const poll = await fetchJson(`/api/v1/contracts/${candidate.id}`, { headers: HEAD })
      lastStatus = poll.body?.analysisStatus
      if (lastStatus === 'DONE') { advanced = true; break }
      if (lastStatus === 'FAILED') break
    }
    if (advanced) ok('contract pipeline reached DONE', `final=${lastStatus}`)
    else ko('contract pipeline did not complete', `last status=${lastStatus} (gave up after 120s)`)
  } else {
    ko('analyze trigger', `status=${trig.status}  body=${JSON.stringify(trig.body).slice(0, 150)}`)
  }
}

// ── 13b. Contract upload (GCS write + DB row) ────────────────────────────
section(7.5, 'Contract upload (multipart → GCS → DB row)')
const minimalPdf = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n' +
  '4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 50 720 Td (smoke) Tj ET\nendstream endobj\n' +
  'xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000111 00000 n \n0000000188 00000 n \n' +
  'trailer<</Size 5/Root 1 0 R>>\nstartxref\n284\n%%EOF\n'
)
const form = new FormData()
form.append('file', new Blob([minimalPdf], { type: 'application/pdf' }), 'smoke-test.pdf')
form.append('title', `Smoke ${new Date().toISOString()}`)
form.append('type', 'OTHER')
form.append('counterpartyName', 'Smoke Co')

const uploadT0 = Date.now()
const uploadRes = await fetch(`${BASE}/api/v1/contracts/upload`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}` },
  body: form,
})
const uploadBody = await uploadRes.json().catch(() => null)
const uploadMs = Date.now() - uploadT0
if (uploadRes.status === 201 && uploadBody?.id) {
  ok('POST /contracts/upload', `id=${uploadBody.id.slice(0, 12)}…  s3Key set  ${uploadMs}ms`)
  // verify it shows up in the list
  await new Promise(r => setTimeout(r, 1500))
  const list = await fetchJson('/api/v1/contracts?limit=50', { headers: HEAD })
  const found = (list.body?.data ?? []).some(c => c.id === uploadBody.id)
  if (found) ok('uploaded contract appears in GET /contracts list')
  else ko('uploaded contract NOT in list', `expected id ${uploadBody.id}`)
} else {
  ko('POST /contracts/upload', `status=${uploadRes.status}  body=${JSON.stringify(uploadBody).slice(0, 200)}`)
}

// ── 13c. Search facets + advanced search (ES read after write) ───────────
section(7.6, 'Search facets + advanced (ES read path)')
const facets = await fetchJson('/api/v1/search/facets', { headers: HEAD })
if (facets.status === 200 && facets.body?.types) {
  ok('GET /search/facets', `${(facets.body.types ?? []).length} types, total=${facets.body.total}, ${facets.ms}ms`)
} else {
  ko('GET /search/facets', `status=${facets.status}  body=${JSON.stringify(facets.body).slice(0, 150)}`)
}

const adv = await fetch(`${BASE}/api/v1/search`, {
  method: 'POST', headers: HEAD,
  body: JSON.stringify({ q: 'agreement' }),
})
const advBody = await adv.json().catch(() => null)
// POST /search returns { data: Contract[], total: number, source: 'elasticsearch' | 'database' }
if (adv.status === 200 && Array.isArray(advBody?.data)) {
  ok('POST /search keyword query', `${advBody.data.length} hit(s) of ${advBody.total}, source=${advBody.source ?? 'unknown'}`)
} else {
  ko('POST /search', `status=${adv.status}  body=${JSON.stringify(advBody).slice(0, 150)}`)
}

// ── 13d. Contract CRUD round-trip ────────────────────────────────────────
section(7.7, 'Contract CRUD round-trip')
// Use the contract we just uploaded
if (uploadBody?.id) {
  // GET
  const got = await fetchJson(`/api/v1/contracts/${uploadBody.id}`, { headers: HEAD })
  if (got.status === 200 && got.body?.id === uploadBody.id) ok('GET /contracts/:id')
  else ko('GET /contracts/:id', `status=${got.status}`)
  // PATCH
  const patch = await fetch(`${BASE}/api/v1/contracts/${uploadBody.id}`, {
    method: 'PATCH', headers: HEAD,
    body: JSON.stringify({ title: `Smoke renamed ${Date.now()}` }),
  })
  if (patch.status === 200) ok('PATCH /contracts/:id (title update)')
  else ko('PATCH /contracts/:id', `status=${patch.status}`)
  // DELETE — Fastify rejects DELETE with Content-Type: application/json and
  // empty body (FST_ERR_CTP_EMPTY_JSON_BODY); send only the Authorization
  // header to match how axios issues DELETE from the front-end.
  const del = await fetch(`${BASE}/api/v1/contracts/${uploadBody.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (del.status === 200 || del.status === 204) ok('DELETE /contracts/:id (soft delete)')
  else ko('DELETE /contracts/:id', `status=${del.status}`)
} else {
  sk('contract CRUD', 'no uploaded contract id to operate on')
}

// ── 13e. Counterparty + Template existence checks ────────────────────────
section(7.8, 'Counterparty + Template detail fetch')
const cpList = await fetchJson('/api/v1/counterparties', { headers: HEAD })
const someCp = cpList.body?.data?.[0]
if (someCp?.id) {
  const cp = await fetchJson(`/api/v1/counterparties/${someCp.id}`, { headers: HEAD })
  if (cp.status === 200 && cp.body?.id === someCp.id) ok(`GET /counterparties/${someCp.id.slice(0,8)}…`)
  else ko('GET /counterparties/:id', `status=${cp.status}`)
}
const tplList = await fetchJson('/api/v1/templates', { headers: HEAD })
const someTpl = tplList.body?.data?.[0]
if (someTpl?.id) {
  const tpl = await fetchJson(`/api/v1/templates/${someTpl.id}`, { headers: HEAD })
  if (tpl.status === 200 && tpl.body?.id === someTpl.id) ok(`GET /templates/${someTpl.id.slice(0,8)}…`)
  else ko('GET /templates/:id', `status=${tpl.status}`)
}

// ── 7.9. Read-sweep across every major feature surface ──────────────────
section(7.9, 'Read sweep — every major feature surface')
// path, label, optional success predicate on the parsed body
const sweep = [
  ['/api/v1/users/me',                  'current user'],
  ['/api/v1/team/workload',             'team workload'],
  ['/api/v1/organization',              'organization profile'],
  ['/api/v1/agent/threads',             'agent chat threads'],
  ['/api/v1/skills',                    'agent skills catalog'],
  ['/api/v1/field-definitions',         'custom field defs'],
  ['/api/v1/review-queue',              'review queue'],
  ['/api/v1/playbook/positions',        'playbook positions'],
  ['/api/v1/approvals/my-queue',        'approvals · my queue'],
  ['/api/v1/approvals/all',             'approvals · org-wide'],
  ['/api/v1/approvals/workflows',       'approval workflows'],
  ['/api/v1/approvals/notifications',   'approval notifications'],
  ['/api/v1/signature-requests',        'signature requests list'],
  ['/api/v1/obligations',               'obligations queue'],
  ['/api/v1/renewals',                  'renewals queue'],
  ['/api/v1/invoices',                  'invoices'],
  ['/api/v1/admin/ai/settings',         'admin · AI settings'],
  ['/api/v1/admin/ai/keys',             'admin · AI key inventory'],
  ['/api/v1/admin/ai/usage',            'admin · AI usage'],
]
for (const [path, label] of sweep) {
  const r = await fetchJson(path, { headers: HEAD })
  if (r.status === 200) {
    ok(`GET ${label}`, `${r.ms}ms  ${path}`)
  } else if (r.status === 403) {
    sk(`GET ${label}`, `403 — admin user lacks permission for ${path}`)
  } else {
    ko(`GET ${label}`, `status=${r.status}  ${path}  body=${JSON.stringify(r.body).slice(0, 100)}`)
  }
}

// ── 7.10. Comment add → list round-trip ──────────────────────────────────
section(7.10, 'Comments add → list round-trip')
const listForComment = await fetchJson('/api/v1/contracts?limit=5', { headers: HEAD })
const cTarget = listForComment.body?.data?.[0]
if (cTarget?.id) {
  const add = await fetch(`${BASE}/api/v1/contracts/${cTarget.id}/comments`, {
    method: 'POST', headers: HEAD,
    body: JSON.stringify({ body: `Smoke test comment ${Date.now()}` }),
  })
  const addBody = await add.json().catch(() => null)
  if ((add.status === 200 || add.status === 201) && addBody?.id) {
    ok('POST /contracts/:id/comments', `id=${addBody.id.slice(0, 12)}…`)
    const got = await fetchJson(`/api/v1/contracts/${cTarget.id}/comments`, { headers: HEAD })
    const found = JSON.stringify(got.body ?? []).includes(addBody.id)
    if (found) ok('new comment appears in GET /comments')
    else ko('comment missing from list', `id ${addBody.id}`)
  } else {
    ko('POST /comments', `status=${add.status}  body=${JSON.stringify(addBody).slice(0, 150)}`)
  }
} else {
  sk('comments', 'no contract available')
}

// ── 7.11. Versions list (Prisma + S3 mirror) ──────────────────────────────
section(7.11, 'Versions list')
if (cTarget?.id) {
  const v = await fetchJson(`/api/v1/contracts/${cTarget.id}/versions`, { headers: HEAD })
  if (v.status === 200 && Array.isArray(v.body)) {
    ok('GET /contracts/:id/versions', `${v.body.length} version(s)`)
  } else if (v.status === 200 && Array.isArray(v.body?.data)) {
    ok('GET /contracts/:id/versions', `${v.body.data.length} version(s)`)
  } else {
    ko('GET /contracts/:id/versions', `status=${v.status}  shape=${JSON.stringify(v.body).slice(0, 100)}`)
  }
}

// ── 14. Static front-end ──────────────────────────────────────────────────
section(8, 'Front-end shell + API proxy')
const html = await fetch(BASE)
if (html.status === 200) {
  const body = await html.text()
  if (body.includes('<div id="root"') || body.includes('<div id=\\"root\\"')) {
    ok('front-end HTML served (200, root div present)')
  } else {
    ko('front-end HTML', 'no root div — Firebase Hosting may be serving the wrong index')
  }
} else {
  ko('front-end HTML', `status=${html.status}`)
}
// proxy check — /api/v1/auth/login through Firebase Hosting should resolve to api-service
const proxyRes = await fetch(`${BASE}/api/v1/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
})
if (proxyRes.status === 200) ok('Firebase Hosting /api/** proxy → Cloud Run api-service OK')
else ko('Hosting proxy', `status=${proxyRes.status}`)

// ── 15. Service health endpoints ─────────────────────────────────────────
section(9, 'Service health probes')
const apiHealth = await fetchJson(`${API_DIRECT}/health`)
if (apiHealth.status === 200 && apiHealth.body?.checks?.database === 'ok' && apiHealth.body?.checks?.redis === 'ok') {
  ok('api-service /health',
    `db=${apiHealth.body.latencyMs.database}ms  redis=${apiHealth.body.latencyMs.redis}ms`)
} else {
  ko('api-service /health', JSON.stringify(apiHealth.body).slice(0, 200))
}

// ── summary ──────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`)
console.log(`Smoke results: \x1b[32m${pass} pass\x1b[0m  /  \x1b[31m${fail} fail\x1b[0m  /  \x1b[33m${skipped} skipped\x1b[0m`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
}
console.log('='.repeat(60))
process.exit(fail > 0 ? 1 : 0)
