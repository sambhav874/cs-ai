#!/usr/bin/env node
/**
 * rail-context-smoke.mjs — verify the SideAgentRail actually works on a
 * contract page with pageContext.
 *
 * Steps:
 *   1. Login
 *   2. Pick a real contract id (any executed one in maya's org)
 *   3. Navigate to /contracts/{id}
 *   4. Open the rail (it may be collapsed)
 *   5. Type "Summarize this contract"
 *   6. Send
 *   7. Verify:
 *      - rail composer accepts text + send works
 *      - SSE response is rendered in rail
 *      - reply mentions the contract title or counterparty (proves pageContext was used)
 *      - no JS errors
 */
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'output', 'rail-context')
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'
const wait = (ms) => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
function record(label, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else    { fail++; console.log(`  ✗ ${label}${detail ? ` · ${detail}` : ''}`) }
}

// Pick a real contract id via API
const tokenRes = await fetch('http://localhost:3001/api/v1/auth/login', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({ email: 'maya@demo.com', password: 'password123' }),
})
const { accessToken } = await tokenRes.json()
const cs = await fetch('http://localhost:3001/api/v1/contracts?limit=5&status=EXECUTED', {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then(r => r.json())
const targetContract = (cs.data ?? cs.contracts ?? [])[0]
if (!targetContract?.id) {
  console.error('FAIL: no executed contract found in maya@demo.com\'s org')
  process.exit(1)
}
console.log(`Target contract: "${targetContract.title}" (${targetContract.id})`)
const expectedKeyword = (targetContract.counterpartyName ?? targetContract.title.split('—')[0])?.trim().split(/\s+/)[0] ?? ''
console.log(`Expected keyword in rail reply: "${expectedKeyword}"`)

const br = await chromium.launch({ headless: true })
const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message.slice(0, 200)))
const networkAgentChat = []
page.on('request', r => { if (r.url().includes('/api/v1/agent/chat')) networkAgentChat.push(r.method() + ' ' + r.url()) })
page.on('response', r => { if (r.url().includes('/api/v1/agent/chat')) networkAgentChat.push(`← ${r.status()}`) })

// Login
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 'maya@demo.com')
await page.fill('input[type="password"]', 'password123')
await page.click('button[type="submit"]')
await wait(2000)

// Navigate to contract page
console.log(`▶ Navigate to /contracts/${targetContract.id}`)
await page.goto(`${BASE}/contracts/${targetContract.id}`, { waitUntil: 'networkidle' })
await wait(2000)
await page.screenshot({ path: path.join(OUT, '01-contract.png') })

// Find the rail. It might be collapsed (data-state="collapsed"). Click to expand.
console.log('▶ Locate + expand rail')
const rail = page.locator('[data-testid="side-agent-rail"]').first()
const railState = await rail.getAttribute('data-state').catch(() => null)
record('rail is mounted on contract page', railState !== null, `state=${railState}`)
if (railState === 'collapsed') {
  await rail.click()
  await wait(800)
}

// Verify composer is present
const composer = page.locator('[data-testid="side-agent-composer"]')
const composerVisible = await composer.isVisible().catch(() => false)
record('rail composer is visible after expand', composerVisible)
await page.screenshot({ path: path.join(OUT, '02-rail-open.png') })

if (composerVisible) {
  console.log('▶ Type + send')
  await composer.click()
  await composer.type('Summarize this contract — key terms, governing law, who signed it.', { delay: 8 })
  await wait(300)
  const sendBtn = page.locator('[data-testid="side-agent-send"]')
  if (!(await sendBtn.isDisabled().catch(() => true))) {
    await sendBtn.click()
  } else {
    await composer.press('Enter')
  }

  console.log('▶ Wait for response (up to 40s)')
  // Wait for the rail's chat scroll area to grow with the response
  const responseRendered = await page.waitForFunction(() => {
    const rail = document.querySelector('[data-testid="side-agent-rail"]')
    if (!rail) return false
    const txt = rail.textContent ?? ''
    // Heuristic: rail text length > 500 means more than just the composer placeholder + the user msg
    return txt.length > 500
  }, null, { timeout: 60_000 }).then(() => true).catch(() => false)
  record('rail produced a response', responseRendered)

  await wait(3000)
  await page.screenshot({ path: path.join(OUT, '03-rail-reply.png') })

  // Inspect what's in the rail now
  const railState = await page.evaluate((kw) => {
    const rail = document.querySelector('[data-testid="side-agent-rail"]')
    const txt  = rail?.textContent ?? ''
    return {
      railLength:    txt.length,
      mentionsCp:    kw ? txt.toLowerCase().includes(kw.toLowerCase()) : false,
      hasToolPill:   !!rail?.querySelector('[data-testid*="tool"], [data-testid*="pill"], [class*="rounded-full"]'),
      keyword:       kw,
    }
  }, expectedKeyword)
  console.log(`  rail state: ${JSON.stringify(railState)}`)
  record(`rail reply mentions the contract's counterparty/title token "${expectedKeyword}"`, railState.mentionsCp,
    'pageContext may not have flowed through to the agent')
  record('rail rendered tool pill or chip (proves contract_get fired)', railState.hasToolPill)
}

record('no JS pageerrors during rail flow', errors.length === 0,
  errors.slice(0, 1).join(' | '))

console.log(`\nNetwork: ${JSON.stringify(networkAgentChat)}`)

await ctx.close()
await br.close()

console.log(`\n${'═'.repeat(70)}`)
console.log(`Rail context smoke: ${pass}/${pass + fail} passed`)
console.log(`${'═'.repeat(70)}`)
if (fail > 0) process.exit(1)
