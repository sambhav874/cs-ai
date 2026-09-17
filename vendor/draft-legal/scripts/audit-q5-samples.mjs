import path from 'node:path'
import { REPO_ROOT } from './lib/repo-root.mjs'
import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const API = 'http://localhost:3001'
const OUT = path.join(REPO_ROOT, 'scripts/audit-screenshots')

const SAMPLES = [
  { code: 'cloudwave',  titleMatch: 'Cloudwave AWS Reseller',          asUser: 'lisa@demo.com',    note: 'EXECUTED, expiring 47d, obligations + renewalAdvice' },
  { code: 'salesforce', titleMatch: 'Salesforce Subscription Renewal', asUser: 'marcus@demo.com',  note: 'PENDING_APPROVAL with active workflow' },
  { code: 'settlement', titleMatch: 'Settlement & Release',            asUser: 'maya@demo.com',    note: 'EXECUTED, in Matter, sensitive' },
  { code: 'nda-acme',   titleMatch: 'Mutual NDA — Acme',               asUser: 'maya@demo.com',    note: 'EXECUTED, simple baseline' },
]

;(async () => {
  const tok = (await (await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.com', password: 'password123' }),
  })).json()).accessToken
  const list = (await (await fetch(`${API}/api/v1/contracts?limit=20`, { headers: { authorization: 'Bearer ' + tok } })).json()).data ?? []

  const br = await chromium.launch({ headless: true })
  const ctx = await br.newContext({ viewport: { width: 1680, height: 1100 } })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('  [PAGEERR]', e.message.slice(0, 200)))

  for (const s of SAMPLES) {
    const c = list.find(c => c.title?.includes(s.titleMatch))
    if (!c) { console.log(`✗ ${s.code} not found`); continue }
    console.log(`\n=== ${s.code}: ${c.title.slice(0, 60)} ===`)
    console.log(`  ${s.note}, login as ${s.asUser}`)

    // Logout: clear cookies + go to /login
    await ctx.clearCookies()
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await page.evaluate(() => localStorage.clear())
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await page.fill('input[type="email"]', s.asUser)
    await page.fill('input[type="password"]', 'password123')
    await page.click('button[type="submit"]')
    await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15_000 })
    await page.evaluate(() => { localStorage.setItem('feature:AGENT_SIDE_PANEL_V2', '1'); localStorage.setItem('side-agent-rail:open', '0') })
    await page.goto(`${BASE}/contracts/${c.id}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const coach = page.locator('button:has-text("Got it"), button[aria-label*="close" i], button:has-text("Dismiss")').first()
    if (await coach.isVisible().catch(() => false)) await coach.click().catch(() => {})

    await page.screenshot({ path: `${OUT}/q5-${s.code}.png`, fullPage: false })
    // Also rail-only zoom
    await page.screenshot({ path: `${OUT}/q5-${s.code}-rail.png`, clip: { x: 1320, y: 0, width: 360, height: 1080 } })

    // Detect "not found" error
    const err = await page.locator('text=Contract not found, text=Not authorized').count()
    if (err > 0) console.log(`  ✗ ${s.asUser} cannot access this contract — RBAC over-blocks`)
    else console.log(`  ✓ ${s.asUser} can view`)
  }

  await br.close()
})()
