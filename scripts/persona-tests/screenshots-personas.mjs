#!/usr/bin/env node
/**
 * screenshots-personas.mjs — final-state screenshots for the multi-turn
 * persona conversations. Per the original Phase 4 plan: each conversation
 * gets a transcript JSON (covered by run-personas.mjs) AND a final-state
 * screenshot (this script).
 *
 * Picks ONE conversation per persona (the most representative multi-turn
 * one) and walks it through the actual /agent UI in Playwright. Captures:
 *   • dashboard after login
 *   • /agent page loaded
 *   • after each turn submit
 *   • final screenshot with artifact pane (if any) visible
 *
 * Output:
 *   scripts/persona-tests/output/multi/screenshots/<persona>/turn-N.png
 */
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'output', 'multi', 'screenshots')
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'
const wait = (ms) => new Promise(r => setTimeout(r, ms))

// Pick one rich multi-turn conversation per persona for visual capture.
const SELECTIONS = [
  { persona: 'vertex',     file: 'vertex.mjs',     convId: 'vertex-003-narrow-snowflake' },
  { persona: 'caldera',    file: 'caldera.mjs',    convId: 'caldera-004-drill-mayo-msa' },
  { persona: 'ironbridge', file: 'ironbridge.mjs', convId: 'ironbridge-004-drill-acquisition' },
  { persona: 'lumen',      file: 'lumen.mjs',      convId: 'lumen-006-action-draft-cda' },
  { persona: 'beacon',     file: 'beacon.mjs',     convId: 'beacon-004-drill-memphis-leases' },
]

const PASSWORD = 'password123'
const br = await chromium.launch({ headless: true })

let totalShots = 0

for (const sel of SELECTIONS) {
  console.log(`\n═══ ${sel.persona} · ${sel.convId} ═══`)
  const personaMod = await import(path.join(__dirname, 'personas', sel.file))
  const conv = personaMod.default.conversations.find(c => c.id === sel.convId)
  if (!conv) { console.log(`   ! conversation not found`); continue }

  const dir = path.join(OUT, sel.persona)
  fs.mkdirSync(dir, { recursive: true })

  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log(`     [pageerror] ${e.message.slice(0, 100)}`))

  // Login as conversation's user
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', conv.user)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await wait(2000)
  await page.screenshot({ path: path.join(dir, '00-dashboard.png') })

  // Navigate to /agent
  await page.goto(`${BASE}/agent`, { waitUntil: 'networkidle' })
  await wait(1500)
  await page.screenshot({ path: path.join(dir, '01-agent-empty.png') })

  // Send each turn and wait
  const composer = page.locator('[data-testid="agent-composer"]')
  for (let i = 0; i < conv.turns.length; i++) {
    const turn = conv.turns[i]
    console.log(`   T${i + 1}: ${turn.ask.slice(0, 60)}…`)
    try {
      await composer.click({ timeout: 10_000 })
      await composer.type(turn.ask, { delay: 5 })
      await wait(200)
      const sendBtn = page.locator('[data-testid="agent-send"]')
      const enabled = !(await sendBtn.isDisabled().catch(() => true))
      if (enabled) await sendBtn.click({ timeout: 5_000 })
      else         await composer.press('Enter')
    } catch (e) {
      console.log(`     [warn] failed to submit turn ${i + 1}: ${(e && e.message || '').slice(0, 80)}`)
    }
    // Fixed wait — the agent stream usually completes in 5-25s on gpt-4.1-mini.
    // Long enough that the artifact pane has time to render too.
    await wait(22_000)
    const shotPath = path.join(dir, `0${i + 2}-turn-${i + 1}.png`)
    await page.screenshot({ path: shotPath }).catch(() => {})
    totalShots++
  }

  // Final state with all turns rendered
  await page.screenshot({ path: path.join(dir, 'final.png'), fullPage: false })
  totalShots++

  await ctx.close()
}

await br.close()
console.log(`\n${'═'.repeat(70)}`)
console.log(`✓ Captured ${totalShots} screenshots across ${SELECTIONS.length} personas`)
console.log(`  Output: ${OUT}`)
console.log('═'.repeat(70))
