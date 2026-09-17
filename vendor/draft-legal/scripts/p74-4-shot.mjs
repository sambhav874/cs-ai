#!/usr/bin/env node
/**
 * P7.4.4 — Capture a focused screenshot of the REVIEW PROGRESS rail
 * section (expanded) so we can eyeball the UX quality.
 */
import path from 'node:path'
import { REPO_ROOT } from './lib/repo-root.mjs'
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'

;(async () => {
  const br = await chromium.launch({ headless: true })
  const ctx = await br.newContext({ viewport: { width: 1680, height: 1100 } })
  const page = await ctx.newPage()

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', 'maya@demo.com')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForTimeout(1500)

  // Disable AI side rail so it doesn't steal pixels for this shot
  await page.evaluate(() => {
    localStorage.setItem('feature:AGENT_SIDE_PANEL_V2', '0')
    localStorage.setItem('coach:contract-detail:dismissed', '1')
  })

  // Open Zynga MSA
  await page.goto(`${BASE}/contracts/cmodtj9gz000svopsfu00q258`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(3500)

  // Dismiss any coach mark
  await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label*="started" i]')
    if (dlg) {
      const btn = dlg.querySelector('button')
      if (btn) btn.click()
    }
  })
  await page.waitForTimeout(500)

  // Reset any prior reviews so we see the unreviewed state
  await page.evaluate(() => {
    document.querySelectorAll('[data-testid^="review-row-"]').forEach(() => {})
  })

  // Expand the review section
  const toggle = await page.$('[data-testid="review-progress-toggle"]')
  if (toggle) await toggle.click()
  await page.waitForTimeout(600)

  // Locate the review-progress block and clip to it
  const box = await page.$eval('[data-testid="review-progress"]', el => {
    const r = el.getBoundingClientRect()
    return { x: Math.floor(r.x - 8), y: Math.floor(r.y - 8), width: Math.ceil(r.width + 16), height: Math.ceil(r.height + 16) }
  })
  console.log(`  bbox: ${JSON.stringify(box)}`)

  await page.screenshot({
    path: path.join(REPO_ROOT, 'scripts/screenshots/desktop/213-p74-4-review-rail-focus.png'),
    clip: box,
  })
  console.log('  ✓ focused screenshot saved')

  await br.close()
})().catch(e => { console.error(e); process.exit(1) })
