import path from 'node:path'
import { REPO_ROOT } from './lib/repo-root.mjs'
import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const OUT = path.join(REPO_ROOT, 'scripts/audit-screenshots')

const PERSONAS = [
  { email: 'admin@demo.com',    code: 'admin' },
  { email: 'marcus@demo.com',   code: 'marcus' },  // Finance approver on Salesforce
  { email: 'maya@demo.com',     code: 'maya' },    // Legal approver
]
const ROUTES = [
  { code: 'approvals',  path: '/approvals' },
  { code: 'signatures', path: '/signatures' },
  { code: 'review-queue', path: '/review-queue' },
]
;(async () => {
  for (const p of PERSONAS) {
    const br = await chromium.launch({ headless: true })
    const ctx = await br.newContext({ viewport: { width: 1680, height: 1100 } })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await page.fill('input[type="email"]', p.email)
    await page.fill('input[type="password"]', 'password123')
    await page.click('button[type="submit"]')
    await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15_000 })
    await page.evaluate(() => { localStorage.setItem('feature:AGENT_SIDE_PANEL_V2', '1'); localStorage.setItem('side-agent-rail:open', '0') })

    for (const r of ROUTES) {
      console.log(`=== ${p.code} on ${r.path} ===`)
      await page.goto(`${BASE}${r.path}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1000)
      const coach = page.locator('button:has-text("Got it"), button[aria-label*="close" i]').first()
      if (await coach.isVisible().catch(() => false)) await coach.click().catch(() => {})
      await page.screenshot({ path: `${OUT}/q8-${p.code}-${r.code}.png`, fullPage: false })
    }
    await br.close()
  }
  console.log('done')
})()
