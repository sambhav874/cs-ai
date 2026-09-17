import path from 'node:path'
import { REPO_ROOT } from './lib/repo-root.mjs'
import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const API = 'http://localhost:3001'
const OUT = path.join(REPO_ROOT, 'scripts/audit-screenshots')

;(async () => {
  const tok = (await (await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.com', password: 'password123' }),
  })).json()).accessToken
  const matters = (await (await fetch(`${API}/api/v1/matters`, { headers: { authorization: 'Bearer ' + tok } })).json())
  const zyngaMatter = (matters.data ?? matters.matters ?? matters).find?.(m => m.name?.includes('Zynga')) 
                     ?? (Array.isArray(matters) ? matters.find(m => m.name?.includes('Zynga')) : null)
  console.log('zynga matter:', zyngaMatter?.id, zyngaMatter?.name)

  const cps = (await (await fetch(`${API}/api/v1/counterparties?limit=20`, { headers: { authorization: 'Bearer ' + tok } })).json())
  const zynga = (cps.data ?? cps.counterparties ?? cps).find?.(c => c.name?.includes('Zynga'))
                ?? (Array.isArray(cps) ? cps.find(c => c.name?.includes('Zynga')) : null)
  console.log('zynga counterparty:', zynga?.id, zynga?.name)

  const br = await chromium.launch({ headless: true })
  const page = await (await br.newContext({ viewport: { width: 1680, height: 1100 } })).newPage()
  page.on('pageerror', e => console.log('  [PAGEERR]', e.message.slice(0, 200)))

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', 'admin@demo.com')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15_000 })
  await page.evaluate(() => { localStorage.setItem('feature:AGENT_SIDE_PANEL_V2', '1'); localStorage.setItem('side-agent-rail:open', '0') })

  // Q6.1 — Matter detail
  if (zyngaMatter) {
    console.log('\n=== Q6.1 — Matter detail (Zynga) ===')
    await page.goto(`${BASE}/matters/${zyngaMatter.id}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const coach = page.locator('button:has-text("Got it"), button[aria-label*="close" i]').first()
    if (await coach.isVisible().catch(() => false)) await coach.click().catch(() => {})
    await page.screenshot({ path: `${OUT}/q6-1-matter-detail.png`, fullPage: false })

    // Try clicking each tab
    for (const tab of ['Contracts', 'Requests', 'Threads']) {
      const t = page.locator(`button:has-text("${tab}"), [role="tab"]:has-text("${tab}")`).first()
      if (await t.isVisible().catch(() => false)) {
        await t.click()
        await page.waitForTimeout(500)
        await page.screenshot({ path: `${OUT}/q6-1-matter-tab-${tab.toLowerCase()}.png`, fullPage: false })
        console.log(`  ✓ ${tab} tab screenshot`)
      } else {
        console.log(`  ✗ ${tab} tab not visible`)
      }
    }
  }

  // Q6.2 — Counterparties list
  console.log('\n=== Q6.2 — Counterparties list ===')
  await page.goto(`${BASE}/counterparties`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/q6-2-counterparties-list.png`, fullPage: false })

  // Q6.3 — Counterparty detail (click on first counterparty)
  console.log('\n=== Q6.3 — Counterparty detail (click first) ===')
  const firstCp = page.locator('a[href^="/counterparties/"], [data-testid^="counterparty-row"]').first()
  if (await firstCp.isVisible().catch(() => false)) {
    await firstCp.click()
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/q6-3-counterparty-detail.png`, fullPage: false })
    console.log('  ✓ counterparty detail screenshot')
  } else {
    console.log('  ✗ no counterparty link clickable')
    // Try clicking the first row text
    const row = page.locator('text=Zynga, text=Acme').first()
    if (await row.isVisible().catch(() => false)) {
      await row.click()
      await page.waitForTimeout(1000)
      await page.screenshot({ path: `${OUT}/q6-3-counterparty-detail.png`, fullPage: false })
    }
  }

  // Q6.4 — Requests list
  console.log('\n=== Q6.4 — Requests list ===')
  await page.goto(`${BASE}/requests`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/q6-4-requests-list.png`, fullPage: false })

  // Q6.5 — New Request flow
  const newReqBtn = page.locator('button:has-text("New request"), button:has-text("+ New"), a:has-text("New request")').first()
  if (await newReqBtn.isVisible().catch(() => false)) {
    await newReqBtn.click()
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${OUT}/q6-5-new-request.png`, fullPage: false })
    console.log('  ✓ new request flow screenshot')
  }

  await br.close()
  console.log('\n✓ Q.6 done')
})().catch(e => { console.error(e); process.exit(1) })
