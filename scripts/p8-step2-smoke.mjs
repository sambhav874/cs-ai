#!/usr/bin/env node
/**
 * p8-step2-smoke.mjs — verify obligations auto-extract on signature.completed.
 *
 * Picks a PENDING_SIGNATURE contract with at least one PENDING signer,
 * signs the token, then waits for the fire-and-forget extractor to
 * populate the Obligation table.
 */
import fs from 'node:fs'

const API = 'http://localhost:3001'
let pass = 0, fail = 0
const record = (msg, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${msg}`) }
  else    { fail++; console.log(`  ✗ ${msg}${detail ? ' · ' + detail : ''}`) }
}

console.log('▶ 1. Login admin')
const tok = await (await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@demo.com', password: 'password123' }),
})).json()
const accessToken = tok.accessToken

console.log('\n▶ 2. Find a PENDING_SIGNATURE contract with a PENDING signer')
const pendings = await (await fetch(`${API}/api/v1/contracts?limit=100&status=PENDING_SIGNATURE`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})).json()

let target = null
let signerToken = null
for (const c of (pendings.data ?? pendings.contracts ?? [])) {
  if (!c.currentVersionId) continue
  const srs = await (await fetch(`${API}/api/v1/contracts/${c.id}/signature-requests`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })).json()
  for (const sr of (srs.data ?? srs ?? [])) {
    if (sr.status !== 'PENDING') continue
    const pendingSigner = (sr.signers ?? []).find(s => s.status === 'PENDING')
    if (pendingSigner?.token) {
      target = { contractId: c.id, srId: sr.id, signerEmail: pendingSigner.email, title: c.title }
      signerToken = pendingSigner.token
      break
    }
  }
  if (target) break
}
record(`found pending signer on contract ${target?.contractId?.slice(-8)}`, !!target,
  target ? `${target.title} · ${target.signerEmail}` : 'none')

console.log('\n▶ 3. Verify NO existing obligations on this contract')
const obsBefore = await (await fetch(`${API}/api/v1/contracts/${target.contractId}/obligations`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})).json()
console.log(`  · ${obsBefore.data?.length ?? 0} obligations before signing · extractedAt=${obsBefore.extractedAt}`)
const obsBeforeCount = obsBefore.data?.length ?? 0

console.log('\n▶ 4. Sign via /sign/:token/sign')
const signRes = await fetch(`${API}/api/v1/sign/${signerToken}/sign`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ signedName: 'Test Signer' }),
})
const signBody = await signRes.json()
record(`sign returns 200 (got ${signRes.status})`, signRes.status === 200)
record(`allSigned = true`, signBody.allSigned === true)

console.log('\n▶ 5. Wait 20s for fire-and-forget LLM extractor')
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 1000))
  process.stdout.write('.')
}
process.stdout.write('\n')

console.log('\n▶ 6. GET /contracts/:id/obligations — expect new rows')
const obsAfter = await (await fetch(`${API}/api/v1/contracts/${target.contractId}/obligations`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})).json()
record(`extractedAt populated (was ${obsBefore.extractedAt})`, !!obsAfter.extractedAt && obsAfter.extractedAt !== obsBefore.extractedAt,
  `extractedAt=${obsAfter.extractedAt}`)
record(`obligations count grew (was ${obsBeforeCount}, now ${obsAfter.data?.length ?? 0})`,
  (obsAfter.data?.length ?? 0) > obsBeforeCount)

if (obsAfter.data?.length) {
  console.log('\n  Obligations on this contract after auto-extract:')
  for (const o of obsAfter.data.slice(0, 8)) {
    console.log(`    · ${o.type.padEnd(10)} | ${o.severity.padEnd(6)} | due=${o.dueDate?.slice(0,10) ?? '-'.padEnd(10)} | ${o.description.slice(0, 70)}`)
  }
}

console.log('\n▶ 7. Verify auto-extract log line in /tmp/api.log')
let logFound = false
try {
  const log = fs.readFileSync('/tmp/api.log', 'utf8').split('\n').slice(-300).join('\n')
  logFound = /\[obligations\] auto-extracted on signature\.completed/.test(log)
} catch {}
record('[obligations] auto-extracted log line', logFound, 'check /tmp/api.log')

console.log(`\nP8 step 2: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)
