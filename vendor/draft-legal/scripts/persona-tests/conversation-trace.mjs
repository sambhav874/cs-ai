#!/usr/bin/env node
/**
 * conversation-trace.mjs — does "send a message" actually work in the
 * browser, end-to-end? Captures console + network so we can see exactly
 * where the flow breaks.
 *
 * Steps for one persona (Vertex / Maya):
 *   1. Login
 *   2. Open /agent
 *   3. Type a message
 *   4. Click Send
 *   5. Capture: did POST /api/v1/agent/chat fire, what status, did SSE
 *      stream events arrive, did the user msg + assistant msg render
 *      in the DOM, were there any JS errors
 */
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'output', 'conv-trace')
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:5173'
const wait = (ms) => new Promise(r => setTimeout(r, ms))

const br = await chromium.launch({ headless: true })
const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const consoleErrs = []
const consoleLogs = []
const networkEvents = []

page.on('console', msg => {
  const entry = `[${msg.type()}] ${msg.text().slice(0, 200)}`
  if (msg.type() === 'error') consoleErrs.push(entry)
  consoleLogs.push(entry)
})
page.on('pageerror', e => consoleErrs.push(`[pageerror] ${e.message.slice(0, 300)}`))
page.on('request', r => {
  if (r.url().includes('/api/v1/agent')) {
    networkEvents.push(`→ ${r.method()} ${r.url()}`)
  }
})
page.on('response', async r => {
  if (r.url().includes('/api/v1/agent')) {
    networkEvents.push(`← ${r.status()} ${r.url()}`)
  }
})

console.log('▶ 1. Login as Maya')
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 'maya.chen@vertex.cloud')
await page.fill('input[type="password"]', 'password123')
await page.click('button[type="submit"]')
await wait(2000)

console.log('▶ 2. Navigate to /agent')
await page.goto(`${BASE}/agent`, { waitUntil: 'networkidle' })
await wait(2000)

console.log('▶ 3. Type message')
const composer = page.locator('[data-testid="agent-composer"]')
await composer.click()
await composer.type('How many contracts do I have expiring in the next 30 days?', { delay: 10 })
await wait(500)
await page.screenshot({ path: path.join(OUT, '01-typed.png') })

console.log('▶ 4. Click send')
await page.locator('[data-testid="agent-send"]').click()

console.log('▶ 5. Wait for stream (15s)…')
await wait(15_000)
await page.screenshot({ path: path.join(OUT, '02-after-send.png') })

console.log('\n━━━ Network ━━━')
networkEvents.forEach(e => console.log(`  ${e}`))

console.log('\n━━━ Console errors ━━━')
if (consoleErrs.length === 0) console.log('  (none)')
else consoleErrs.forEach(e => console.log(`  ${e}`))

console.log('\n━━━ DOM state after send ━━━')
const domState = await page.evaluate(() => {
  const home = document.querySelector('[data-testid="agent-home"]')
  if (!home) return { err: 'no agent-home' }
  // Find the chat scroll area — sibling of composer in DOM
  const composer = document.querySelector('[data-testid="agent-composer"]')
  const composerVal = composer?.value ?? composer?.textContent ?? ''
  // Look for user/assistant message bubbles — common patterns
  const userBubbles = document.querySelectorAll('[data-message-role="user"], [data-role="user"], .user-message, [class*="bg-indigo-600"][class*="text-white"]')
  const assistantBubbles = document.querySelectorAll('[data-message-role="assistant"], [data-role="assistant"], .assistant-message')
  return {
    composerStillFilled: composerVal.length > 0,
    composerText: composerVal.slice(0, 80),
    homeTextLength: home.textContent?.length ?? 0,
    userBubbleCount: userBubbles.length,
    assistantBubbleCount: assistantBubbles.length,
    bodyContainsQuestion: document.body.textContent?.includes('expiring in the next 30 days'),
    bodyContainsContractWord: document.body.textContent?.includes('contract'),
  }
})
console.log(JSON.stringify(domState, null, 2))

await ctx.close()
await br.close()
console.log(`\nScreenshots: ${OUT}/01-typed.png, 02-after-send.png`)
