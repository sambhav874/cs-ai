#!/usr/bin/env node
/**
 * U.8.3 — Per-page responsive smoke test (doc 32 §11e.25).
 *
 * Loads every major route at 1024 / 1280 / 1680 and asserts:
 *   • no horizontal scrollbar (page never overflows)
 *   • main content area renders (≥200px height of visible content)
 *   • no JS pageerror during the load
 *
 * Saves a screenshot per (route, viewport) into
 * scripts/screenshots/u-build/u8-3-responsive/. Failures are listed
 * with the offending route + viewport.
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'screenshots', 'u-build', 'u8-3-responsive')
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'

const ROUTES = [
  '/dashboard',
  '/agent',
  '/contracts',
  '/counterparties',
  '/matters',
  '/requests',
  '/approvals',
  '/templates',
  '/clauses',
  '/playbook',
  '/review-queue',
  '/settings',
]
const VIEWPORTS = [
  { name: '1024', width: 1024, height: 768 },
  { name: '1280', width: 1280, height: 800 },
  { name: '1680', width: 1680, height: 900 },
]

let fail = 0
let total = 0
const failures = []
const check = (cond, msg) => {
  total++
  if (cond) console.log(`    ✓ ${msg}`)
  else { console.log(`    ✗ ${msg}`); fail++; failures.push(msg) }
}

const br = await chromium.launch({ headless: true })

async function login(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', 'maya@demo.com')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForTimeout(1500)
}

for (const vp of VIEWPORTS) {
  console.log(`\n━━━ Viewport ${vp.name} (${vp.width}×${vp.height}) ━━━`)
  const ctx = await br.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)))
  await login(page)

  for (const route of ROUTES) {
    console.log(`\n  • ${route}`)
    errors.length = 0
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1200)
    } catch (e) {
      check(false, `[${vp.name}${route}] navigation completed (got ${(e).message.slice(0, 100)})`)
      continue
    }

    const layout = await page.evaluate(() => {
      const docHasHScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      const main = document.querySelector('main')
      const mainRect = main?.getBoundingClientRect()
      // Visible main content height
      const mainHeight = mainRect?.height ?? 0
      // Sidebar should always be present
      const sidebar = document.querySelector('[data-testid="app-sidebar"]')
      const sidebarWidth = sidebar?.getBoundingClientRect().width ?? 0
      return { docHasHScroll, mainHeight, sidebarWidth, viewportW: window.innerWidth }
    })

    check(!layout.docHasHScroll, `[${vp.name}${route}] no horizontal scrollbar`)
    check(layout.mainHeight >= 200, `[${vp.name}${route}] main content has height (${Math.round(layout.mainHeight)}px)`)
    check(layout.sidebarWidth > 0, `[${vp.name}${route}] sidebar present (${Math.round(layout.sidebarWidth)}px)`)
    if (vp.width < 1024) {
      check(layout.sidebarWidth <= 80, `[${vp.name}${route}] sidebar collapsed to icons`)
    } else {
      check(layout.sidebarWidth >= 200, `[${vp.name}${route}] sidebar full width`)
    }
    check(errors.length === 0, `[${vp.name}${route}] no pageerrors (${errors.length} fired${errors[0] ? `: ${errors[0]}` : ''})`)

    const slug = route.replace(/[^\w]/g, '_').replace(/^_|_$/g, '') || 'root'
    await page.screenshot({
      path: path.join(OUT, `${vp.name}-${slug}.png`),
      fullPage: false,
    })
  }
  await ctx.close()
}

await br.close()

console.log(`\n${fail === 0 ? '✓' : '✗'} ${total - fail}/${total} checks passed`)
if (fail) {
  console.error(`\nFailures (${failures.length}):`)
  failures.forEach(f => console.error(`  · ${f}`))
  process.exit(1)
}
