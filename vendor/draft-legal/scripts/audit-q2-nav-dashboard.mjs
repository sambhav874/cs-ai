#!/usr/bin/env node
/**
 * Audit Q.2 — Dashboard with HeroAgent enabled + every sidebar nav item.
 *
 * For each route in the sidebar, capture screenshot + check:
 *   • Does the page load (200 / no JS error)?
 *   • Is the empty state appropriate (we have data — list shouldn't be empty)?
 *   • Does the URL match the nav target?
 *   • Are there obvious copy/UX nits worth a finding?
 *
 * Outputs to scripts/audit-screenshots/q2-* + console findings.
 */
import path from 'node:path'
import { REPO_ROOT } from './lib/repo-root.mjs'
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const OUT = path.join(REPO_ROOT, 'scripts/audit-screenshots')

const NAV_ITEMS = [
  { label: 'Dashboard',      path: '/dashboard',     expectVisible: ['Welcome back', 'Active Contracts'] },
  { label: 'Matters',        path: '/matters',        expectVisible: ['Zynga MSA', 'HQ relocation'] },
  { label: 'Contracts',      path: '/contracts',      expectVisible: ['Master Services Agreement', 'Mutual NDA'] },
  { label: 'Requests',       path: '/requests',       expectVisible: [] },
  { label: 'Counterparties', path: '/counterparties', expectVisible: ['Zynga', 'Acme'] },
  { label: 'Templates',      path: '/templates',      expectVisible: ['Mutual NDA', 'Master Services'] },
  { label: 'Clause Library', path: '/clauses',        expectVisible: ['Mutual confidentiality', 'liability'] },
  { label: 'Playbook',       path: '/playbook',       expectVisible: ['Limitation of Liability', 'Payment Terms'] },
  { label: 'Approvals',      path: '/approvals',      expectVisible: ['Salesforce'] },
  { label: 'Signatures',     path: '/signatures',     expectVisible: [] },
  { label: 'Analytics',      path: '/analytics',      expectVisible: [] },
  { label: 'Review Queue',   path: '/review-queue',   expectVisible: [] },
  { label: 'Users (admin)',  path: '/admin/users',    expectVisible: ['legal@demo.com', 'sales@demo.com'] },
  { label: 'Roles (admin)',  path: '/admin/roles',    expectVisible: ['ADMIN', 'LEGAL_COUNSEL'] },
  { label: 'Organization',   path: '/admin/org',      expectVisible: [] },
  { label: 'Skills',         path: '/admin/skills',   expectVisible: [] },
  { label: 'Team',           path: '/team',           expectVisible: ['Maya', 'Daniel'] },
  { label: 'Profile',        path: '/profile',        expectVisible: ['admin@demo.com'] },
  { label: 'Settings',       path: '/settings',       expectVisible: [] },
]

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()

  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)))
  page.on('response', r => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`) })

  // login + enable agent flag
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', 'admin@demo.com')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15_000 })
  await page.evaluate(() => {
    localStorage.setItem('feature:AGENT_SIDE_PANEL_V2', '1')
    localStorage.setItem('side-agent-rail:open', '1')
  })

  const findings = []
  for (const item of NAV_ITEMS) {
    console.log(`\n=== ${item.label} (${item.path}) ===`)
    errors.length = 0
    const errBefore = errors.length
    await page.goto(`${BASE}${item.path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)

    // Dismiss coach mark if present
    const coach = page.locator('button:has-text("Got it"), button[aria-label*="close" i], button:has-text("Dismiss")').first()
    if (await coach.isVisible().catch(() => false)) await coach.click().catch(() => {})

    const slug = item.path.replace(/^\//, '').replace(/\//g, '-') || 'home'
    await page.screenshot({ path: `${OUT}/q2-${slug}.png`, fullPage: false })

    const url = page.url()
    if (!url.includes(item.path)) {
      const f = `${item.label}: redirected from ${item.path} → ${url}`
      console.log(`  ✗ ${f}`)
      findings.push({ code: `Q2-NAV-${slug}`, sev: 'P1', what: f })
      continue
    }

    const body = (await page.locator('body').innerText()).slice(0, 5000)
    const allFound = item.expectVisible.every(s => body.includes(s))
    if (item.expectVisible.length > 0 && !allFound) {
      const missing = item.expectVisible.filter(s => !body.includes(s))
      const f = `Expected text not visible: ${missing.join(', ')}`
      console.log(`  ✗ ${f}`)
      findings.push({ code: `Q2-DATA-${slug}`, sev: 'P1', screen: item.path, what: f })
    } else {
      console.log('  ✓ loads + expected text visible')
    }

    if (errors.length > errBefore) {
      const f = `Page errors: ${errors.slice(errBefore).join(' | ')}`
      console.log(`  ✗ ${f}`)
      findings.push({ code: `Q2-ERR-${slug}`, sev: 'P0', screen: item.path, what: f })
    }
  }

  await browser.close()

  console.log(`\n\n=== Q.2 SUMMARY ===`)
  console.log(`${NAV_ITEMS.length} nav items walked, ${findings.length} findings`)
  findings.forEach(f => console.log(`  ${f.code} [${f.sev}] ${f.screen ?? ''}: ${f.what}`))
})().catch(e => { console.error(e); process.exit(1) })
