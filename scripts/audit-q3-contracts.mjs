#!/usr/bin/env node
/**
 * Audit Q.3 — /contracts list — filters, search, sort, upload, pagination, navigation
 */
import path from 'node:path'
import { REPO_ROOT } from './lib/repo-root.mjs'
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const OUT = path.join(REPO_ROOT, 'scripts/audit-screenshots')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()
  page.on('pageerror', e => console.log('  [PAGEERR]', e.message.slice(0, 200)))

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', 'admin@demo.com')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15_000 })
  await page.evaluate(() => {
    localStorage.setItem('feature:AGENT_SIDE_PANEL_V2', '1')
    localStorage.setItem('side-agent-rail:open', '0')
  })

  console.log('=== /contracts default view ===')
  await page.goto(`${BASE}/contracts`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const coach = page.locator('button:has-text("Got it"), button[aria-label*="close" i], button:has-text("Dismiss")').first()
  if (await coach.isVisible().catch(() => false)) await coach.click().catch(() => {})
  await page.screenshot({ path: `${OUT}/q3-default.png`, fullPage: false })

  // Count rows visible
  const rowCount = await page.locator('table tbody tr, [role="row"]').count()
  console.log(`  rows visible: ${rowCount}`)

  // Search
  console.log('\n=== /contracts search "Zynga" ===')
  const search = page.locator('input[placeholder*="Search"], input[type="search"]').first()
  if (await search.isVisible().catch(() => false)) {
    await search.click()
    await search.fill('Zynga')
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${OUT}/q3-search-zynga.png`, fullPage: false })
    const zRows = await page.locator('table tbody tr, [role="row"]').count()
    console.log(`  results for "Zynga": ${zRows} (expected ~5)`)
    await search.fill('')
    await page.waitForTimeout(400)
  } else {
    console.log('  ✗ search input not found')
  }

  // Filters
  console.log('\n=== /contracts open filters ===')
  const filterBtn = page.locator('button:has-text("Filter")').first()
  if (await filterBtn.isVisible().catch(() => false)) {
    await filterBtn.click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/q3-filters-open.png`, fullPage: false })
    console.log('  ✓ filter panel screenshot taken')
  } else {
    console.log('  ✗ filter button not visible')
  }

  // Click into a contract
  console.log('\n=== /contracts click first row ===')
  await page.goto(`${BASE}/contracts`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const firstRow = page.locator('table tbody tr').first()
  if (await firstRow.isVisible().catch(() => false)) {
    await firstRow.click()
    await page.waitForTimeout(1500)
    const onDetail = page.url().includes('/contracts/') && !page.url().endsWith('/contracts')
    console.log(`  navigated to detail: ${onDetail} (${page.url()})`)
    await page.screenshot({ path: `${OUT}/q3-clicked-row.png`, fullPage: false })
  } else {
    console.log('  ✗ no rows to click')
  }

  // Browser back returns to list?
  console.log('\n=== back button returns to list ===')
  await page.goBack()
  await page.waitForTimeout(800)
  const backOnList = page.url().endsWith('/contracts')
  console.log(`  back ⇒ list: ${backOnList}`)
  await page.screenshot({ path: `${OUT}/q3-after-back.png`, fullPage: false })

  // Upload PDF button
  console.log('\n=== upload button ===')
  const uploadBtn = page.locator('button:has-text("Upload")').first()
  if (await uploadBtn.isVisible().catch(() => false)) {
    await uploadBtn.click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/q3-upload-modal.png`, fullPage: false })
    console.log('  ✓ upload modal screenshot taken')
  }

  await browser.close()
  console.log('\n✓ Q.3 done')
})().catch(e => { console.error(e); process.exit(1) })
