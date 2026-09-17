#!/usr/bin/env node
/**
 * p7-step3-smoke.mjs — verify Send-for-Signature dialog renders + sends
 * end-to-end via the actual UI (not just direct API).
 */
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'screenshots', 'p7-step3')
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'
const API = 'http://localhost:3001'
const wait = (ms) => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const record = (msg, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${msg}`) }
  else    { fail++; console.log(`  ✗ ${msg}${detail ? ' · ' + detail : ''}`) }
}

// 1. login as admin (to get permission)
const tokRes = await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@demo.com', password: 'password123' }),
})
const { accessToken } = await tokRes.json()

// 2. find an APPROVED contract (or any non-EXECUTED with version)
const cs = await fetch(`${API}/api/v1/contracts?limit=100`, {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then(r => r.json())
const contracts = (cs.data ?? cs.contracts ?? [])
// Prefer APPROVED, fallback to anything with currentVersionId not EXECUTED
let target = contracts.find(c => c.status === 'APPROVED' && c.currentVersionId)
          ?? contracts.find(c => c.currentVersionId && c.status !== 'EXECUTED' && c.status !== 'PENDING_SIGNATURE' && c.status !== 'EXPIRED')
if (!target) {
  // Generate fresh draft so the smoke is repeatable
  const draft = await fetch(`${API}/api/v1/agent/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      userMessage: 'Mutual NDA for P7 Step3 Test, 2-year term, California governing law.',
      saveAs: { title: 'P7 Step3 Test — NDA' },
    }),
  }).then(r => r.json())
  if (draft.contractId) target = { id: draft.contractId, title: 'P7 Step3 Test — NDA', status: 'DRAFT', currentVersionId: draft.versionId }
}

if (!target) {
  // Promote a DRAFT to APPROVED so the button shows up
  const draft = contracts.find(c => c.currentVersionId && c.status === 'DRAFT')
  if (draft) {
    await fetch(`${API}/api/v1/contracts/${draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ status: 'APPROVED' }),
    })
    console.log(`  · promoted ${draft.title} → APPROVED for testing`)
  }
}
const contractId = target?.id ?? contracts.find(c => c.currentVersionId)?.id
console.log(`  · target: ${contractId} (${target?.title}, ${target?.status})`)

const br = await chromium.launch({ headless: true })
const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message.slice(0, 200)))

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 'admin@demo.com')
await page.fill('input[type="password"]', 'password123')
await page.click('button[type="submit"]')
await wait(2000)

await page.goto(`${BASE}/contracts/${contractId}`, { waitUntil: 'networkidle' })
await wait(2500)
await page.screenshot({ path: path.join(OUT, '01-contract-detail.png') })

const sendBtn = page.locator('[data-testid="send-for-signature-btn"]')
const visible = await sendBtn.isVisible().catch(() => false)
record('Send for Signature button visible (contract is APPROVED)', visible)
if (!visible) {
  const status = await page.evaluate(() => document.body.textContent?.match(/(DRAFT|APPROVED|EXECUTED|PENDING_SIGNATURE)/)?.[0])
  console.log(`    page status detected: ${status}`)
}

if (visible) {
  await sendBtn.click()
  await wait(700)
  await page.screenshot({ path: path.join(OUT, '02-dialog-open.png') })
  const dialog = page.locator('[data-testid="send-for-signature-dialog"]')
  record('dialog rendered', await dialog.isVisible().catch(() => false))

  // Fill 1 signer
  await page.locator('[data-testid="signer-name-0"]').fill('Test Signer')
  await page.locator('[data-testid="signer-email-0"]').fill('test@example.com')
  await page.locator('[data-testid="signer-role-0"]').fill('CFO')
  await page.locator('[data-testid="sign-message"]').fill('Please review and sign at your earliest convenience.')
  await wait(300)
  await page.screenshot({ path: path.join(OUT, '03-dialog-filled.png') })

  // Validate form state
  const confirmBtn = page.locator('[data-testid="send-for-signature-confirm"]')
  const enabled = !(await confirmBtn.isDisabled().catch(() => true))
  record('confirm button enabled with 1 valid signer', enabled)

  // Submit
  if (enabled) {
    await confirmBtn.click()
    await wait(2500)
    await page.screenshot({ path: path.join(OUT, '04-after-submit.png') })

    // Check backend state — contract should be PENDING_SIGNATURE now
    const c = await fetch(`${API}/api/v1/contracts/${contractId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(r => r.json())
    record(`contract.status flipped to PENDING_SIGNATURE (got ${c.status})`, c.status === 'PENDING_SIGNATURE')

    const srs = await fetch(`${API}/api/v1/contracts/${contractId}/signature-requests`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(r => r.json())
    const list = srs.data ?? srs ?? []
    record(`signature_request created (count=${list.length})`, list.length >= 1)
  }
}

record('no JS pageerrors', errors.length === 0, errors.slice(0, 1).join(' | '))

await ctx.close()
await br.close()

console.log(`\n${'═'.repeat(70)}`)
console.log(`P7 step 3 smoke: ${pass}/${pass + fail} passed`)
console.log(`screenshots: ${OUT}/`)
if (fail > 0) process.exit(1)
