#!/usr/bin/env node
/**
 * p7-step5-smoke.mjs — verify the SignatureStatus rail section renders
 * after a signature is sent.
 */
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'screenshots', 'p7-step5')
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'
const API = 'http://localhost:3001'
const wait = (ms) => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const record = (msg, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${msg}`) }
  else    { fail++; console.log(`  ✗ ${msg}${detail ? ' · ' + detail : ''}`) }
}

// Get a contract with an active signature request — or send one
const tok = await (await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({email:'admin@demo.com', password:'password123'}),
})).json()
const accessToken = tok.accessToken

const cs = await (await fetch(`${API}/api/v1/contracts?limit=20`, {
  headers: {Authorization: `Bearer ${accessToken}`},
})).json()
const all = cs.data ?? cs.contracts ?? []

// Find a contract with PENDING_SIGNATURE OR send fresh
let contractId = all.find(c => c.status === 'PENDING_SIGNATURE')?.id
if (!contractId) {
  const draft = all.find(c => c.currentVersionId && c.status === 'DRAFT')
  if (draft) {
    await fetch(`${API}/api/v1/contracts/${draft.id}/send-for-signature`, {
      method: 'POST',
      headers: {'Content-Type':'application/json', Authorization: `Bearer ${accessToken}`},
      body: JSON.stringify({
        signers: [
          { name: 'Alice CEO', email: 'alice@example.com', role: 'CEO', signOrder: 1 },
          { name: 'Bob CFO',   email: 'bob@example.com',   role: 'CFO', signOrder: 2 },
        ],
        signOrder: 'SEQUENTIAL',
        message: 'Please sign in order — Alice first, then Bob.',
        expiresInDays: 14,
      }),
    })
    contractId = draft.id
  }
}
console.log(`  · using contract ${contractId}`)

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
await page.screenshot({ path: path.join(OUT, '01-contract.png') })

// Look for the Signatures rail section title
const railSection = page.locator('section:has-text("Signatures")')
record('Signatures rail section visible', await railSection.isVisible().catch(() => false))

// Section auto-opens when there's a PENDING request
const statusBlock = page.locator('[data-testid="signature-status"]')
const visible = await statusBlock.isVisible().catch(() => false)
if (!visible) {
  // Click to expand
  await railSection.click().catch(() => {})
  await wait(500)
}
await page.screenshot({ path: path.join(OUT, '02-rail-expanded.png') })

record('SignatureStatus block rendered (data-testid)',
  await statusBlock.isVisible().catch(() => false))

const allText = await page.locator('body').textContent()
record('shows "Awaiting signatures" or "Fully signed" status pill',
  /Awaiting signatures|Fully signed|Voided|Expired/.test(allText ?? ''))
record('shows per-signer rows (≥1)', /Alice|Bob|Pending|Signed/.test(allText ?? ''))
record('shows "Copy link" or "Pending" or "Signed" pill', /Copy link|Pending|Signed/.test(allText ?? ''))

// Look for an Activity disclosure
const activity = page.locator('summary:has-text("Activity")')
record('Activity (audit timeline) disclosure visible', await activity.isVisible().catch(() => false))

record('no JS pageerrors', errors.length === 0, errors.slice(0, 1).join(' | '))

await ctx.close()
await br.close()

console.log(`\nP7 step 5: ${pass}/${pass + fail} passed · screenshots ${OUT}/`)
if (fail > 0) process.exit(1)
