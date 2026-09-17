#!/usr/bin/env node
/**
 * Thorough test of contract-header redo across:
 *   • multiple contracts (short title, long title, with/without value/expiry)
 *   • multiple viewports (1280, 1440, 1680)
 *   • rail collapsed + expanded
 *
 * For each combo we capture a screenshot and assert layout invariants.
 * Output: scripts/screenshots/u-build/u8-header-thorough/<viewport>-<rail>-<contract-slug>.png
 */
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'screenshots', 'u-build', 'u8-header-thorough')
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'

let fail = 0
let total = 0
const check = (cond, msg) => { total++; console.log(cond ? `    ✓ ${msg}` : `    ✗ ${msg}`); if (!cond) fail++ }

async function login(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', 'maya@demo.com')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForTimeout(1500)
}

async function setRail(page, state) {
  const cur = await page.locator('[data-testid="side-agent-rail"]').getAttribute('data-state').catch(() => null)
  if (!cur) return
  if (state === 'collapsed' && cur === 'expanded') {
    await page.locator('[data-testid="side-agent-rail"] button:has(svg.lucide-chevron-right)').first().click()
    await page.waitForTimeout(500)
  } else if (state === 'expanded' && cur === 'collapsed') {
    await page.locator('[data-testid="side-agent-rail"]').click()
    await page.waitForTimeout(500)
  }
}

const tokenRes = await fetch('http://localhost:3001/api/v1/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'maya@demo.com', password: 'password123' }),
})
const { accessToken } = await tokenRes.json()
const cs = await fetch('http://localhost:3001/api/v1/contracts?limit=20', {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then(r => r.json())
const contracts = cs.contracts ?? cs.data ?? []

// Pick THREE diverse contracts:
//  1. Long title with amendment (the one the user circled)
//  2. Shortest title in the org (sanity for narrow content)
//  3. One with a contract.value populated (so the value chip renders)
const longTitle = contracts.find(c => c.title.length >= 50) ?? contracts[0]
const shortTitle = [...contracts].sort((a, b) => a.title.length - b.title.length)[0]
const withValue = contracts.find(c => c.value != null && c.id !== longTitle.id && c.id !== shortTitle.id) ?? contracts.find(c => c.value != null) ?? longTitle

const cases = [
  { label: 'long-title', contract: longTitle },
  { label: 'short-title', contract: shortTitle },
  { label: 'with-value', contract: withValue },
]
for (const c of cases) {
  console.log(`  • ${c.label}: "${c.contract.title}" (${c.contract.title.length} chars, value=${c.contract.value ?? '—'})`)
}

const viewports = [
  { name: '1280', width: 1280, height: 800 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1680', width: 1680, height: 900 },
]

const railStates = ['collapsed', 'expanded']

const br = await chromium.launch({ headless: true })

for (const vp of viewports) {
  for (const railState of railStates) {
    for (const tcase of cases) {
      const tag = `${vp.name}-${railState}-${tcase.label}`
      console.log(`\n── ${tag} ──`)
      const ctx = await br.newContext({ viewport: { width: vp.width, height: vp.height } })
      const page = await ctx.newPage()
      page.on('pageerror', e => console.log(`    [PAGEERR] ${e.message.slice(0, 120)}`))

      await login(page)
      await page.goto(`${BASE}/contracts/${tcase.contract.id}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1500)
      await setRail(page, railState)

      const layout = await page.evaluate(() => {
        const header = document.querySelector('main .bg-white.border-b')
        if (!header) return { err: 'no header' }
        const headerRect = header.getBoundingClientRect()
        const titleEl = header.querySelector('h1')
        const titleRect = titleEl?.getBoundingClientRect()
        const titleScrollWidth = titleEl?.scrollWidth ?? 0
        const titleClientWidth = titleEl?.clientWidth ?? 0
        const buttons = header.querySelector('.flex.items-center.gap-2.flex-shrink-0')
        const btnRect = buttons?.getBoundingClientRect()
        const oldStrip = header.querySelector('[data-testid="contract-meta-strip"]')
        const docHasHScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth
        // Count metadata rows: get every direct chip element in the metadata wrap and find unique top Y values
        const metaRow = header.querySelector('.flex.items-center.flex-wrap')
        const chips = metaRow ? Array.from(metaRow.children) : []
        const topYs = new Set(chips.map(el => Math.round(el.getBoundingClientRect().top)))
        return {
          headerWidth: headerRect.width,
          titleClientWidth,
          titleScrollWidth,
          titleEllipsised: titleScrollWidth > titleClientWidth + 1,
          buttonsRight: btnRect?.right,
          headerRight: headerRect.right,
          rightTrailing: headerRect.right - (btnRect?.right ?? headerRect.right),
          hasOldMetaStrip: !!oldStrip,
          metaRowCount: topYs.size,
          docHasHScroll,
          headerHeight: headerRect.height,
        }
      })
      console.log(`    layout:`, JSON.stringify(layout))

      check(!layout.hasOldMetaStrip, `[${tag}] no orphan meta-strip`)
      check(layout.rightTrailing >= 18 && layout.rightTrailing <= 32, `[${tag}] buttons flush right (got ${layout.rightTrailing}px, expect ~24px)`)
      check(!layout.docHasHScroll, `[${tag}] no horizontal scrollbar`)
      // At wide main (collapsed rail at 1440+), title should NOT clip for our long-title contract.
      if (railState === 'collapsed' && vp.width >= 1440 && tcase.label === 'long-title') {
        check(!layout.titleEllipsised, `[${tag}] long title fits at wide main`)
      }
      // Header height ceiling. At wide viewports (1440+) we expect a tight 2-row header.
      // At 1280 with rail expanded, main column is only ~620px so the metadata row wraps
      // to 4-5 rows naturally — accept up to 320px there. If we exceed even this, something
      // is genuinely broken (e.g. an overflow / unbounded element).
      const headerCeiling = (vp.width <= 1280 && railState === 'expanded') ? 320 : 220
      check(layout.headerHeight <= headerCeiling, `[${tag}] header height ≤ ${headerCeiling}px (got ${Math.round(layout.headerHeight)}px)`)

      await page.screenshot({
        path: path.join(OUT, `${tag}.png`),
        fullPage: false,
        clip: { x: 0, y: 0, width: vp.width, height: 260 },
      })
      await ctx.close()
    }
  }
}

await br.close()

console.log(`\n${fail === 0 ? '✓' : '✗'} ${total - fail}/${total} checks passed`)
if (fail) process.exit(1)
