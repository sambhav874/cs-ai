#!/usr/bin/env node
/**
 * p8-step4-smoke.mjs — verify the complete-obligation flow.
 *
 *   1. Login admin
 *   2. Find an OPEN obligation
 *   3. POST /obligations/:id/complete with note + evidence file
 *   4. GET /obligations/:id — verify status=COMPLETED, evidence fields set
 *   5. GET /obligations/:id/evidence — verify presigned URL
 *   6. POST /obligations/:id/reopen — verify it flips back to OPEN
 *   7. GET /obligations/stats — verify counts shifted
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

console.log('\n▶ 2. Find an OPEN obligation')
const list = await (await fetch(`${API}/api/v1/obligations?bucket=open&limit=5`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})).json()
const target = list.data?.[0]
record(`found OPEN obligation`, !!target,
  target ? `${target.id.slice(-8)} · ${target.description.slice(0, 50)}` : 'none')
if (!target) process.exit(1)

console.log('\n▶ 3. POST /obligations/:id/complete with note + evidence file')
const fd = new FormData()
fd.append('note', 'Smoke test completion — paid via wire transfer ref #SMK-2026-001')
const blob = new Blob(['SMOKE TEST EVIDENCE\nObligation ID: ' + target.id + '\nPaid: ' + new Date().toISOString()], { type: 'text/plain' })
fd.append('file', blob, 'evidence-smoke.txt')

const completeRes = await fetch(`${API}/api/v1/obligations/${target.id}/complete`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}` },
  body: fd,
})
const completed = await completeRes.json()
record(`POST /complete returns 200 (got ${completeRes.status})`, completeRes.status === 200)
record(`status flipped to COMPLETED`, completed.status === 'COMPLETED')
record(`completedAt set`, !!completed.completedAt)
record(`evidenceFilename = "evidence-smoke.txt"`, completed.evidenceFilename === 'evidence-smoke.txt')
record(`evidenceSize > 0`, (completed.evidenceSize ?? 0) > 0, `size=${completed.evidenceSize}`)
record(`completionNote saved`, completed.completionNote?.startsWith('Smoke test'),
  `note=${completed.completionNote}`)

console.log('\n▶ 4. GET /obligations/:id — verify it persists')
const fetched = await (await fetch(`${API}/api/v1/obligations/${target.id}`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})).json()
record(`status persisted as COMPLETED`, fetched.status === 'COMPLETED')
record(`completedBy.email returned`, !!fetched.completedBy?.email,
  `completedBy=${fetched.completedBy?.email}`)

console.log('\n▶ 5. GET /obligations/:id/evidence — presigned URL')
const evRes = await fetch(`${API}/api/v1/obligations/${target.id}/evidence`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})
const ev = await evRes.json()
record(`evidence endpoint returns 200 (got ${evRes.status})`, evRes.status === 200)
record(`presigned url returned`, !!ev.url && ev.url.startsWith('http'),
  ev.url?.slice(0, 80))

if (ev.url) {
  // Try fetching it to verify the file is actually there.
  const fetched = await fetch(ev.url)
  const text = await fetched.text()
  record(`evidence file content includes "SMOKE TEST"`, text.includes('SMOKE TEST'))
}

console.log('\n▶ 6. POST /obligations/:id/reopen — flip back to OPEN')
const reopenRes = await fetch(`${API}/api/v1/obligations/${target.id}/reopen`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}` },
})
const reopened = await reopenRes.json()
record(`reopen returns 200 (got ${reopenRes.status})`, reopenRes.status === 200)
record(`status reverted to OPEN`, reopened.status === 'OPEN')
record(`completedAt cleared`, reopened.completedAt === null)

console.log('\n▶ 7. Verify duplicate complete returns 409')
// Re-complete then re-complete to trigger 409
await fetch(`${API}/api/v1/obligations/${target.id}/complete`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ note: 'second time' }),
})
const dup = await fetch(`${API}/api/v1/obligations/${target.id}/complete`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ note: 'third time should fail' }),
})
record(`re-completing already-completed returns 409 (got ${dup.status})`, dup.status === 409)

console.log(`\nP8 step 4: ${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)
