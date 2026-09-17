import path from 'node:path'
import { REPO_ROOT } from './lib/repo-root.mjs'
import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const OUT = path.join(REPO_ROOT, 'scripts/audit-screenshots')

;(async () => {
  const br = await chromium.launch({ headless: true })
  const page = await (await br.newContext({ viewport: { width: 1680, height: 1100 } })).newPage()
  page.on('pageerror', e => console.log('  [PAGEERR]', e.message.slice(0, 200)))

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', 'admin@demo.com')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15_000 })
  await page.evaluate(() => { localStorage.setItem('feature:AGENT_SIDE_PANEL_V2', '1'); localStorage.setItem('side-agent-rail:open', '0') })

  const screens = [
    { code: 'templates', path: '/templates' },
    { code: 'clauses',   path: '/clauses' },
    { code: 'playbook',  path: '/playbook' },
  ]
  for (const s of screens) {
    console.log(`=== ${s.code} ===`)
    await page.goto(`${BASE}${s.path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const coach = page.locator('button:has-text("Got it"), button[aria-label*="close" i]').first()
    if (await coach.isVisible().catch(() => false)) await coach.click().catch(() => {})
    await page.screenshot({ path: `${OUT}/q7-${s.code}.png`, fullPage: false })
    // Click first row to see detail
    const firstClick = page.locator(`a[href^="${s.path}/"], button:has-text("Edit"), [data-testid^="row-"]`).first()
    if (await firstClick.isVisible().catch(() => false)) {
      await firstClick.click({ force: true })
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${OUT}/q7-${s.code}-detail.png`, fullPage: false })
      console.log(`  ✓ detail screenshot`)
    }
  }

  await br.close()
})()
