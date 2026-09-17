#!/usr/bin/env node
/**
 * p7-smoke.mjs — Phase 07 end-to-end smoke. Verifies the existing
 * eSignature flow works before building new features on top.
 *
 * Steps:
 *   1. Login as Maya (acme org)
 *   2. Find a contract that's ready to send (status APPROVED or DRAFT)
 *   3. POST /contracts/:id/send-for-signature with 1 internal signer (Maya herself)
 *   4. Verify SignatureRequest + Signer rows created
 *   5. Open /sign/:token in headless Playwright
 *   6. Verify SignerPortal renders (contract title, signer name, sign button)
 *   7. Click Sign → type name → confirm
 *   8. Verify status flips to SIGNED + contract.status = EXECUTED
 *   9. Screenshot at each step
 */
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'screenshots', 'p7-smoke')
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'
const API  = 'http://localhost:3001'
const wait = (ms) => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const record = (msg, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${msg}`) }
  else    { fail++; console.log(`  ✗ ${msg}${detail ? ' · ' + detail : ''}`) }
}

console.log('▶ 1. Login as admin@demo.com (need configure:contract perm)')
const tokenRes = await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@demo.com', password: 'password123' }),
})
const { accessToken, user } = await tokenRes.json()
record('login succeeds', !!accessToken, accessToken ? '' : JSON.stringify(await tokenRes.text()))

console.log('\n▶ 2. Find a contract that has a current version + isn\'t already executed')
const cs = await fetch(`${API}/api/v1/contracts?limit=20`, {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then(r => r.json())
const contracts = cs.data ?? cs.contracts ?? []
const target = contracts.find(c =>
  c.currentVersionId && c.status !== 'EXECUTED' && c.status !== 'EXPIRED'
)
if (!target) {
  console.log('   no eligible contract found — picking first contract anyway')
}
const contractId = target?.id ?? contracts[0]?.id
console.log(`   → using contract: ${contractId} (${target?.title ?? '?'}, status=${target?.status ?? '?'})`)
record('found target contract', !!contractId, contractId)

console.log('\n▶ 3. POST /contracts/:id/send-for-signature (Maya as sole signer)')
const sendRes = await fetch(`${API}/api/v1/contracts/${contractId}/send-for-signature`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({
    signers: [{ name: 'Maya Goldberg', email: 'maya@demo.com', role: 'GC', signOrder: 1 }],
    message: 'Please review and sign the attached agreement.',
    signOrder: 'ANY',
    expiresInDays: 7,
  }),
})
const sentBody = await sendRes.json()
record(`POST send-for-signature returns 201 (got ${sendRes.status})`, sendRes.status === 201,
  JSON.stringify(sentBody).slice(0, 200))

const signerToken = sentBody.signers?.[0]?.token
console.log(`   signer token: ${signerToken?.slice(0, 16)}…`)
record('signer token issued', !!signerToken)

console.log('\n▶ 4. Verify contract.status flipped to PENDING_SIGNATURE')
const c2 = await fetch(`${API}/api/v1/contracts/${contractId}`, {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then(r => r.json())
record(`contract.status = PENDING_SIGNATURE (got ${c2.status})`, c2.status === 'PENDING_SIGNATURE')

console.log('\n▶ 5. Open SignerPortal at /sign/:token in Playwright')
const br = await chromium.launch({ headless: true })
const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message.slice(0, 200)))

await page.goto(`${BASE}/sign/${signerToken}`, { waitUntil: 'networkidle' })
await wait(2000)
await page.screenshot({ path: path.join(OUT, '01-portal-loaded.png') })

const titleSeen = await page.evaluate(() => document.body.textContent ?? '')
record('SignerPortal renders contract title', titleSeen.includes(target?.title?.split(' ')[0] ?? ''),
  `body length=${titleSeen.length}`)
record('SignerPortal renders without JS errors', errors.length === 0,
  errors.slice(0, 1).join(' | '))

console.log('\n▶ 6. Click Sign button (data-testid="signer-sign-btn")')
const signBtn = page.locator('[data-testid="signer-sign-btn"]')
const signBtnVisible = await signBtn.isVisible().catch(() => false)
record('sign button visible', signBtnVisible)
if (signBtnVisible) await signBtn.click()
await wait(800)
await page.screenshot({ path: path.join(OUT, '02-sign-dialog.png') })

console.log('\n▶ 7. Type name + confirm in dialog')
const nameInput = page.locator('[data-testid="signer-name-input"]')
const dialogVisible = await nameInput.isVisible().catch(() => false)
record('sign dialog visible after click', dialogVisible)
if (dialogVisible) {
  await nameInput.fill('Maya Goldberg')
  await wait(300)
  await page.screenshot({ path: path.join(OUT, '03-name-typed.png') })
  const confirmBtn = page.locator('[data-testid="signer-confirm-btn"]')
  await confirmBtn.click()
  await wait(4000)
  await page.screenshot({ path: path.join(OUT, '04-after-submit.png') })
}

console.log('\n▶ 8. Verify backend state: signer SIGNED + contract EXECUTED')
const finalC = await fetch(`${API}/api/v1/contracts/${contractId}`, {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then(r => r.json())
record(`contract.status = EXECUTED (got ${finalC.status})`, finalC.status === 'EXECUTED')

const srList = await fetch(`${API}/api/v1/contracts/${contractId}/signature-requests`, {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then(r => r.json())
const latest = (srList.data ?? srList ?? [])[0]
record(`signature_request.status = COMPLETED (got ${latest?.status})`, latest?.status === 'COMPLETED')

await ctx.close()
await br.close()

console.log(`\n${'═'.repeat(70)}`)
console.log(`P7 smoke: ${pass}/${pass + fail} checks passed`)
console.log(`screenshots: ${OUT}/`)
console.log('═'.repeat(70))
if (fail > 0) process.exit(1)
