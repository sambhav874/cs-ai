#!/usr/bin/env node
/**
 * Audit Q.4 — Zynga MSA contract detail page (the headline screen).
 *
 * Captures the View, Edit, and rail-section UX as maya@demo.com (the
 * actual owner). Walks the most important JTBD: "Review a single contract".
 */
import path from 'node:path'
import { REPO_ROOT } from './lib/repo-root.mjs'
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const OUT = path.join(REPO_ROOT, 'scripts/audit-screenshots')
const API = 'http://localhost:3001'

;(async () => {
  // Find Zynga MSA id
  const adminToken = (await (await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.com', password: 'password123' }),
  })).json()).accessToken
  const list = await (await fetch(`${API}/api/v1/contracts?limit=20`, {
    headers: { authorization: 'Bearer ' + adminToken },
  })).json()
  const msa = (list.data ?? list.contracts ?? []).find(c => c.title?.includes('Master Services Agreement — Zynga'))
  if (!msa) { console.error('Zynga MSA not found'); process.exit(1) }
  console.log(`Found Zynga MSA: ${msa.id}`)

  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1100 } })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('  [PAGEERR]', e.message.slice(0, 200)))

  // Login as maya@demo.com (the actual owner)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', 'maya@demo.com')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15_000 })
  await page.evaluate(() => {
    localStorage.setItem('feature:AGENT_SIDE_PANEL_V2', '1')
    localStorage.setItem('side-agent-rail:open', '0')
  })

  // ── Q4.1 Default view as Legal owner ───────────────────────────
  console.log('\n=== Q4.1 — Default view ===')
  await page.goto(`${BASE}/contracts/${msa.id}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const coach = page.locator('button:has-text("Got it"), button[aria-label*="close" i], button:has-text("Dismiss")').first()
  if (await coach.isVisible().catch(() => false)) await coach.click().catch(() => {})
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/q4-1-default-as-legal.png`, fullPage: false })

  // What's visible? Header, status, doc, rail
  const hasTitle = await page.locator(`text="${msa.title.slice(0, 40)}"`).count()
  const hasStatusPill = await page.locator('text=UNDER_NEGOTIATION, text=Under negotiation').count()
  console.log(`  title visible: ${hasTitle > 0}, status pill: ${hasStatusPill > 0}`)

  // Rail sections to verify
  const rails = ['OVERVIEW', 'OBLIGATIONS', 'KEY TERMS', 'RISKS', 'CLAUSES', 'HISTORY', 'COMMENTS', 'ACTIVITY']
  for (const r of rails) {
    const v = await page.getByText(r, { exact: false }).count()
    console.log(`  rail "${r}": ${v > 0 ? '✓' : '✗'}`)
  }

  // ── Q4.2 Full-page screenshot to see entire scrollable content ─
  console.log('\n=== Q4.2 — Full-page capture ===')
  await page.screenshot({ path: `${OUT}/q4-2-fullpage.png`, fullPage: true })

  // ── Q4.3 Open Edit mode ────────────────────────────────────────
  console.log('\n=== Q4.3 — Edit mode ===')
  const editBtn = page.getByTestId('enter-edit-btn').or(page.locator('button:has-text("Edit")')).first()
  if (await editBtn.isVisible().catch(() => false)) {
    await editBtn.click()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/q4-3-edit-mode.png`, fullPage: false })
    console.log('  ✓ entered edit mode')
  } else {
    console.log('  ✗ Edit button not visible')
  }

  // ── Q4.4 Original PDF toggle ───────────────────────────────────
  console.log('\n=== Q4.4 — Toggle to Original PDF ===')
  // First exit edit
  const doneBtn = page.locator('button:has-text("Done")').first()
  if (await doneBtn.isVisible().catch(() => false)) await doneBtn.click()
  await page.waitForTimeout(800)
  const originalBtn = page.locator('button:has-text("Original")').first()
  if (await originalBtn.isVisible().catch(() => false)) {
    await originalBtn.click()
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT}/q4-4-original-pdf.png`, fullPage: false })
    console.log('  ✓ Original PDF toggle clicked')
  } else {
    console.log('  ✗ Original toggle not found')
  }

  // ── Q4.5 Risks toggle ──────────────────────────────────────────
  console.log('\n=== Q4.5 — Risks toggle ===')
  // Back to Styled
  const styledBtn = page.locator('button:has-text("Styled")').first()
  if (await styledBtn.isVisible().catch(() => false)) await styledBtn.click()
  await page.waitForTimeout(500)
  const risksBtn = page.locator('button:has-text("Risks:")').first()
  if (await risksBtn.isVisible().catch(() => false)) {
    await risksBtn.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/q4-5-risks-menu.png`, fullPage: false })
    console.log('  ✓ Risks menu opened')
  } else {
    console.log('  ✗ Risks button not found')
  }

  // ── Q4.6 Compare versions (likely won't work — only 1 version exists) ─
  console.log('\n=== Q4.6 — Compare versions ===')
  const compareBtn = page.locator('button:has-text("Compare")').first()
  if (await compareBtn.isVisible().catch(() => false)) {
    await compareBtn.click()
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${OUT}/q4-6-compare.png`, fullPage: false })
    console.log('  ✓ Compare clicked')
  } else {
    console.log('  ✗ Compare button not visible (likely needs ≥2 versions)')
  }

  await browser.close()
  console.log('\n✓ Q.4 done')
})().catch(e => { console.error(e); process.exit(1) })
