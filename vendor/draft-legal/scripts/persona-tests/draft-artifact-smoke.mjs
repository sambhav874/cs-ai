#!/usr/bin/env node
/**
 * draft-artifact-smoke.mjs — verify the user's specific concern:
 * "I thought artifacts would be created and show on the right pane."
 *
 * Steps:
 *   1. Login as Maya (acme org — has NDA template)
 *   2. Open /agent
 *   3. Type "Draft a mutual NDA for Apple. 2-year term, California governing law."
 *   4. Click send
 *   5. Wait for the stream to finish + the contract_create_from_template tool
 *      to fire and emit a Doc artifact
 *   6. Verify the artifact pane on the right is populated and clickable
 *   7. Screenshot
 *
 * Output: scripts/persona-tests/output/draft-artifact/01-..04-*.png +
 *         draft-artifact-report.md
 */
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'output', 'draft-artifact')
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'
const wait = (ms) => new Promise(r => setTimeout(r, ms))

const br = await chromium.launch({ headless: true })
const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message.slice(0, 200)))

let pass = 0, fail = 0
const record = (msg, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${msg}`) }
  else    { fail++; console.log(`  ✗ ${msg}${detail ? ` · ${detail}` : ''}`) }
}

console.log('▶ Login as Maya (acme org)')
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 'maya@demo.com')
await page.fill('input[type="password"]', 'password123')
await page.click('button[type="submit"]')
await wait(2000)
await page.screenshot({ path: path.join(OUT, '01-dashboard.png') })

console.log('▶ Open /agent')
await page.goto(`${BASE}/agent`, { waitUntil: 'networkidle' })
await wait(2000)
await page.screenshot({ path: path.join(OUT, '02-agent-empty.png') })

console.log('▶ Type draft request + send')
const composer = page.locator('[data-testid="agent-composer"]')
await composer.click()
await composer.type('Draft a mutual NDA for Apple. 2-year term, California governing law.', { delay: 8 })
await wait(300)
await page.locator('[data-testid="agent-send"]').click()

console.log('▶ Wait for stream to fully complete (Doc artifact lands LAST after search + memory)')
// The agent runs: contract_search → counterparty_memory → contract_create_from_template.
// The Doc artifact only appears after the third tool call, which can take 25-40s on gpt-4.1-mini.
// Wait for the specific "Save as draft" / "Open in Contracts" action button — that proves
// the Doc artifact (not just the search-results Table artifact) rendered.
const docArtifactRendered = await page.waitForFunction(() => {
  const body = document.body.textContent ?? ''
  return body.includes('Save as draft') || body.includes('Open in Contracts')
}, null, { timeout: 60_000 }).then(() => true).catch(() => false)
record('Doc artifact rendered (Save as draft / Open in Contracts button visible)', docArtifactRendered)
await wait(1500)
await page.screenshot({ path: path.join(OUT, '03-after-draft.png'), fullPage: false })

const finalState = await page.evaluate(() => {
  const body = document.body.textContent ?? ''
  return {
    hasDraftTitle: body.includes('Apple — NDA') || body.includes('Apple - NDA'),
    artifactCount:    document.querySelectorAll('[data-testid*="artifact"]').length,
    saveAsDraftBtn:   body.includes('Save as draft'),
    openInContracts:  body.includes('Open in Contracts'),
    hasContractLink:  !!document.querySelector('a[href*="/contracts/"]'),
    // The artifact-pane chip strip near the composer shows kinds — count them
    artifactChips:    document.querySelectorAll('[data-testid*="artifact-chip"], button:has(svg + span)').length,
  }
})
console.log(`  state: ${JSON.stringify(finalState)}`)
record('draft title rendered on page', finalState.hasDraftTitle)
record('artifact-panel testid present', finalState.artifactCount > 0)
record('Doc artifact action button visible (Save as draft OR Open in Contracts)',
  finalState.saveAsDraftBtn || finalState.openInContracts)
record('no JS pageerrors during draft flow', errors.length === 0,
  errors.slice(0, 2).join(' | '))

await ctx.close()
await br.close()

console.log(`\n${pass}/${pass + fail} checks passed`)

const md = []
md.push(`# Draft Artifact UI Smoke\n`)
md.push(`Run at ${new Date().toISOString()}\n`)
md.push(`User: maya@demo.com → /agent → "Draft a mutual NDA for Apple..."\n`)
md.push(`## Results\n`)
md.push(`Pass: ${pass}/${pass + fail}\n`)
md.push(`Final DOM state:\n\n\`\`\`json\n${JSON.stringify(finalState, null, 2)}\n\`\`\`\n`)
md.push(`Screenshots: 01-dashboard.png, 02-agent-empty.png, 03-after-draft.png`)
fs.writeFileSync(path.join(OUT, 'draft-artifact-report.md'), md.join('\n'))

if (fail > 0) process.exit(1)
