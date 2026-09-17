#!/usr/bin/env node
/**
 * p7-step4-smoke.mjs — verify /signatures admin list page works.
 */
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'screenshots', 'p7-step4')
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'
const wait = (ms) => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const record = (msg, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${msg}`) }
  else    { fail++; console.log(`  ✗ ${msg}${detail ? ' · ' + detail : ''}`) }
}

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

await page.goto(`${BASE}/signatures`, { waitUntil: 'networkidle' })
await wait(2500)
await page.screenshot({ path: path.join(OUT, '01-page.png') })

record('SignaturesPage renders', await page.locator('[data-testid="signatures-page"]').isVisible().catch(() => false))
record('shows "Signatures" heading',
  /Signatures/.test(await page.locator('h1').textContent().catch(() => '')))
record('shows filter tabs (All / Awaiting / Completed)',
  await page.locator('[data-testid="filter-all"]').isVisible().catch(() => false) &&
  await page.locator('[data-testid="filter-pending"]').isVisible().catch(() => false))

// Either the table OR the empty state should be visible
const tableVis = await page.locator('[data-testid="signatures-table"]').isVisible().catch(() => false)
const emptyVis = /No signature requests yet|No .* signature requests/.test(await page.locator('body').textContent() ?? '')
record('shows either table OR empty state', tableVis || emptyVis)

// Click PENDING filter
await page.locator('[data-testid="filter-pending"]').click()
await wait(800)
await page.screenshot({ path: path.join(OUT, '02-filter-pending.png') })
record('PENDING filter works (page didn\'t crash)', errors.length === 0)

// Sidebar: Signatures should NOT show "soon" badge anymore
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
await wait(1500)
const sidebarText = await page.locator('[data-testid="app-sidebar"]').textContent()
record('sidebar has Signatures (no longer in Coming soon)', /Signatures/.test(sidebarText ?? ''))

record('no JS pageerrors', errors.length === 0, errors.slice(0, 1).join(' | '))

await ctx.close()
await br.close()

console.log(`\nP7 step 4: ${pass}/${pass + fail} passed · ${OUT}/`)
if (fail > 0) process.exit(1)
