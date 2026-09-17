import path from 'node:path'
import { REPO_ROOT } from './lib/repo-root.mjs'
import { chromium } from 'playwright'
const BASE = 'http://localhost:5173'
const OUT = path.join(REPO_ROOT, 'scripts/audit-screenshots')

// For each persona, take a "first-glance dashboard" screenshot — what they
// see immediately after login. This is the audit's most-important moment:
// did the product orient them to their JTBD?
const PERSONAS = [
  { code: 'maya',    email: 'maya@demo.com',    role: 'LEGAL_COUNSEL',    jtbd: 'Review the Zynga MSA in negotiation' },
  { code: 'daniel',  email: 'daniel@demo.com',  role: 'SALES_REP',         jtbd: 'Get my SOW drafted + close the deal' },
  { code: 'lisa',    email: 'lisa@demo.com',    role: 'PROCUREMENT',       jtbd: 'Decide on Cloudwave + Datadog renewals' },
  { code: 'marcus',  email: 'marcus@demo.com',  role: 'FINANCE',           jtbd: 'Approve Salesforce renewal' },
  { code: 'emily',   email: 'emily@demo.com',   role: 'CONTRACT_MANAGER',  jtbd: 'Send Priya her offer letter' },
]

;(async () => {
  for (const p of PERSONAS) {
    console.log(`\n=== ${p.code} (${p.role}) — JTBD: ${p.jtbd} ===`)
    const br = await chromium.launch({ headless: true })
    const page = await (await br.newContext({ viewport: { width: 1680, height: 1100 } })).newPage()
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await page.fill('input[type="email"]', p.email)
    await page.fill('input[type="password"]', 'password123')
    await page.click('button[type="submit"]')
    await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15_000 })
    await page.evaluate(() => { localStorage.setItem('feature:AGENT_SIDE_PANEL_V2', '1'); localStorage.setItem('side-agent-rail:open', '0') })
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const coach = page.locator('button:has-text("Got it"), button[aria-label*="close" i]').first()
    if (await coach.isVisible().catch(() => false)) await coach.click().catch(() => {})
    await page.screenshot({ path: `${OUT}/q10-${p.code}-dashboard.png`, fullPage: false })

    // Inspect sidebar badges + KPI counts to surface what "the org thinks they need to do"
    const body = await page.locator('body').innerText()
    const approvals = body.match(/Approvals\s*(\d+)/)?.[1] ?? '0'
    const requests  = body.match(/Requests\s*(\d+)/)?.[1] ?? '0'
    console.log(`  Sidebar badges: approvals=${approvals} requests=${requests}`)

    // What's the FIRST thing the persona should click?
    // For Maya (legal): /contracts → Zynga MSA  
    // For Marcus (finance): /approvals → Salesforce
    // For Lisa (procurement): /contracts → Cloudwave OR Datadog (renewals)
    // For Daniel (sales): /contracts → SOWs / Reseller
    // For Emily (HR): /contracts → Employment offer

    await br.close()
  }
})()
