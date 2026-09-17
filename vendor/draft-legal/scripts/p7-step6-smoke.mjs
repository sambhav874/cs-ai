#!/usr/bin/env node
/**
 * p7-step6-smoke.mjs — verify PDF binding produces a signed PDF version
 * with a certificate page.
 */
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'screenshots', 'p7-step6')
fs.mkdirSync(OUT, { recursive: true })
const API = 'http://localhost:3001'

let pass = 0, fail = 0
const record = (msg, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${msg}`) }
  else    { fail++; console.log(`  ✗ ${msg}${detail ? ' · ' + detail : ''}`) }
}

console.log('▶ 1. Login as admin')
const tokRes = await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({email:'admin@demo.com', password:'password123'}),
})
const { accessToken } = await tokRes.json()

console.log('\n▶ 2. Pick contract with currentVersionId + not EXECUTED')
const cs = await fetch(`${API}/api/v1/contracts?limit=100`, {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then(r => r.json())
let target = (cs.data ?? cs.contracts ?? [])
  .find(c => c.currentVersionId && c.status !== 'EXECUTED' && c.status !== 'PENDING_SIGNATURE' && c.status !== 'EXPIRED')
if (!target) {
  console.log('  · no eligible contract — drafting fresh')
  const draft = await fetch(`${API}/api/v1/agent/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      userMessage: 'Mutual NDA for P7 Step6 Test, 2-year term, California governing law.',
      saveAs: { title: 'P7 Step6 Test — NDA' },
    }),
  }).then(r => r.json())
  if (draft.contractId) target = { id: draft.contractId, title: 'P7 Step6 Test — NDA', currentVersionId: draft.versionId }
}
record(`found target contract`, !!target)
const contractId = target?.id
console.log(`  → ${target?.title} (${contractId}, version ${target?.currentVersionId})`)

const versionBefore = target.currentVersionId

console.log('\n▶ 3. Send for signature with 1 signer')
const sendRes = await fetch(`${API}/api/v1/contracts/${contractId}/send-for-signature`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({
    signers: [{ name: 'PDF Test Signer', email: 'pdftest@example.com', role: 'CFO', signOrder: 1 }],
    signOrder: 'ANY',
    expiresInDays: 7,
  }),
})
const sent = await sendRes.json()
record(`send returns 201 (got ${sendRes.status})`, sendRes.status === 201)
const token = sent.signers?.[0]?.token

console.log('\n▶ 4. Submit signature via /sign/:token/sign')
const signRes = await fetch(`${API}/api/v1/sign/${token}/sign`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ signedName: 'PDF Test Signer' }),
})
const signBody = await signRes.json()
record(`sign returns 200 (got ${signRes.status})`, signRes.status === 200)
record(`allSigned = true`, signBody.allSigned === true)

console.log('\n▶ 5. Wait 3s for async PDF generation, then check version was added')
await new Promise(r => setTimeout(r, 3500))

const c2 = await fetch(`${API}/api/v1/contracts/${contractId}`, {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then(r => r.json())
record(`contract.status = EXECUTED`, c2.status === 'EXECUTED')
record(`currentVersionId advanced (was ${versionBefore.slice(-6)}…, now ${(c2.currentVersionId ?? '').slice(-6)}…)`,
  c2.currentVersionId && c2.currentVersionId !== versionBefore)

console.log('\n▶ 6. Inspect new version: should be a PDF with signed/<contractId> S3 key')
const versions = await fetch(`${API}/api/v1/contracts/${contractId}/versions`, {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then(r => r.json())
const allVer = versions.data ?? versions ?? []
const newVer = allVer.find(v => v.id === c2.currentVersionId)
record(`new version exists in versions list`, !!newVer)
record(`new version.mimeType = application/pdf`, newVer?.mimeType === 'application/pdf')
record(`new version.changeNote includes "Signed by"`,
  /Signed by/i.test(newVer?.changeNote ?? ''),
  `changeNote=${newVer?.changeNote}`)

console.log('\n▶ 7. Download the canonical PDF (uses /contracts/:id/download)')
const dlRes = await fetch(`${API}/api/v1/contracts/${contractId}/download`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})
record(`download responds 200 (got ${dlRes.status})`, dlRes.status === 200)

let pdfBytes = null
if (dlRes.status === 200) {
  const body = await dlRes.json().catch(() => null)
  // /download returns { url, artifact } where url is a presigned S3 URL
  if (body?.url) {
    const r2 = await fetch(body.url)
    if (r2.ok) pdfBytes = Buffer.from(await r2.arrayBuffer())
  }
}
record(`PDF bytes downloaded`, !!pdfBytes && pdfBytes.length > 1000, pdfBytes ? `${pdfBytes.length} bytes` : 'no bytes')
record(`magic bytes are %PDF-`,
  !!pdfBytes && pdfBytes.subarray(0, 5).toString('utf8') === '%PDF-',
  pdfBytes ? pdfBytes.subarray(0, 8).toString('utf8') : '')

if (pdfBytes) {
  fs.writeFileSync(path.join(OUT, 'signed.pdf'), pdfBytes)
  console.log(`  · saved signed PDF: ${OUT}/signed.pdf (${(pdfBytes.length / 1024).toFixed(1)} KB)`)
}

console.log(`\nP7 step 6: ${pass}/${pass + fail} passed · ${OUT}/`)
if (fail > 0) process.exit(1)
