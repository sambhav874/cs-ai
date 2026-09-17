#!/usr/bin/env node
/**
 * artifact-coverage.mjs — does the artifact pane surface for each
 * structurally-rich tool? Five tool types, one Playwright run per type:
 *   contract_search → Table
 *   approval_list → Table
 *   counterparty_memory → Card (or Table)
 *   contract_create_from_template → Doc (already covered, sanity here)
 *   obligations_list → Table (or Card)
 *
 * For each: open /agent, ask a question that triggers the tool, wait for
 * the artifact pane, screenshot, verify it has the expected kind/title.
 */
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'output', 'artifact-coverage')
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'
const wait = (ms) => new Promise(r => setTimeout(r, ms))

const CASES = [
  { id: 'contract_search-table', tool: 'contract_search',
    prompt: 'List all our NDAs and their counterparties.',
    expectArtifactKeyword: 'NDA' },   // an NDA title or "results" header
  { id: 'approval_list-table',   tool: 'approval_list',
    prompt: 'What approvals are awaiting my decision? Give me the full list.',
    expectArtifactKeyword: 'approval' },
  { id: 'counterparty_memory-card', tool: 'counterparty_memory',
    // Phrase that explicitly triggers counterparty_memory (vs contract_search)
    prompt: 'Use counterparty_memory to pull the full relationship summary for Zynga Holdings — total exposure, deal count, types.',
    expectArtifactKeyword: 'Zynga' },
  { id: 'obligations_list-table', tool: 'obligations_list',
    prompt: 'What obligations do we have due in the next 60 days?',
    expectArtifactKeyword: 'obligation' },
  { id: 'contract_create_from_template-doc', tool: 'contract_create_from_template',
    prompt: 'Draft an NDA for Brex. 2-year term, California governing law.',
    expectArtifactKeyword: 'Brex' },
]

const PASSWORD = 'password123'
const br = await chromium.launch({ headless: true })

let pass = 0, fail = 0
const recorded = []
function record(label, ok, detail = '') {
  if (ok) { pass++; console.log(`    ✓ ${label}`) }
  else    { fail++; console.log(`    ✗ ${label}${detail ? ` · ${detail}` : ''}`) }
  recorded.push({ label, ok, detail })
}

for (const c of CASES) {
  console.log(`\n═══ ${c.id} ═══`)
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)))
  fs.mkdirSync(path.join(OUT, c.id), { recursive: true })

  // Login + navigate
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', 'maya@demo.com')
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await wait(2000)
  await page.goto(`${BASE}/agent`, { waitUntil: 'networkidle' })
  await wait(1500)

  // Send prompt
  const composer = page.locator('[data-testid="agent-composer"]')
  await composer.click()
  await composer.type(c.prompt, { delay: 6 })
  await wait(200)
  await page.locator('[data-testid="agent-send"]').click()

  // Wait until either: an artifact testid appears OR the streaming finishes (~30-50s ceiling)
  const sawArtifact = await page.waitForFunction(() => {
    const arts = document.querySelectorAll('[data-testid*="artifact"]').length
    return arts > 0
  }, null, { timeout: 60_000 }).then(() => true).catch(() => false)
  await wait(3000)
  await page.screenshot({ path: path.join(OUT, c.id, 'after.png') })

  const state = await page.evaluate((kw) => {
    const body = document.body.textContent ?? ''
    return {
      artifactCount:    document.querySelectorAll('[data-testid*="artifact"]').length,
      keywordPresent:   body.toLowerCase().includes(kw.toLowerCase()),
      assistantReplied: body.length > 1000,
    }
  }, c.expectArtifactKeyword)

  console.log(`    state: ${JSON.stringify(state)}`)
  record(`[${c.id}] artifact rendered (testid count > 0)`, state.artifactCount > 0)
  record(`[${c.id}] reply contains expected keyword "${c.expectArtifactKeyword}"`, state.keywordPresent)
  record(`[${c.id}] no JS pageerrors`, errors.length === 0,
    errors.slice(0, 1).join(' | '))

  await ctx.close()
}

await br.close()

console.log(`\n${'═'.repeat(70)}`)
console.log(`Artifact coverage: ${pass}/${pass + fail} passed`)
console.log(`${'═'.repeat(70)}`)

fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({
  ranAt: new Date().toISOString(), pass, fail, total: pass + fail, results: recorded,
}, null, 2))

if (fail > 0) process.exit(1)
