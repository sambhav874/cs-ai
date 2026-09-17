import path from 'node:path'
import { REPO_ROOT } from './lib/repo-root.mjs'
import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const OUT = path.join(REPO_ROOT, 'scripts/audit-screenshots')

const ROUTES = [
  { code: 'admin-users',  path: '/admin/users' },
  { code: 'admin-roles',  path: '/admin/roles' },
  { code: 'admin-org',    path: '/admin/org' },
  { code: 'admin-skills', path: '/admin/skills' },
  { code: 'team',         path: '/team' },
  { code: 'profile',      path: '/profile' },
  { code: 'settings',     path: '/settings' },
]

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

  for (const r of ROUTES) {
    console.log(`=== ${r.code} ===`)
    await page.goto(`${BASE}${r.path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const coach = page.locator('button:has-text("Got it"), button[aria-label*="close" i]').first()
    if (await coach.isVisible().catch(() => false)) await coach.click().catch(() => {})
    await page.screenshot({ path: `${OUT}/q9-${r.code}.png`, fullPage: false })
  }
  await br.close()
})()
