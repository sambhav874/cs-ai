#!/usr/bin/env node
/**
 * full-review.mjs — whole-app, route-by-route render review.
 *
 * Visits EVERY authenticated route in the sidebar/admin nav plus the
 * queue pages, and for each asserts:
 *   1. the page mounts (its key heading/testid is present)
 *   2. it shows real data OR a designed empty state — never a crash,
 *      error toast, or blank shell
 *   3. no uncaught console errors accumulate
 *
 * Complements smoke-ui.mjs (deep core flows) by being broad instead of
 * deep — the "is every feature wired" sweep.
 *
 * Usage:
 *   APP_URL=http://localhost:5173 node scripts/full-review.mjs
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(__dirname, 'screenshots', 'full-review')
fs.rmSync(SHOTS, { recursive: true, force: true })
fs.mkdirSync(SHOTS, { recursive: true })

const APP   = process.env.APP_URL        ?? 'http://localhost:5173'
const EMAIL = process.env.ADMIN_EMAIL    ?? 'admin@demo.com'
const PWD   = process.env.ADMIN_PASSWORD ?? 'password123'

let pass = 0, fail = 0
const failures = []
const ok = (n, d = '') => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? '  ·  ' + d : ''}`) }
const ko = (n, d) => { fail++; failures.push(`${n} — ${d}`); console.log(`  \x1b[31m✗\x1b[0m ${n}  ·  ${d}`) }

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') {
    const t = m.text()
    if (!t.includes('sourceMappingURL') && !t.includes('DevTools')) consoleErrors.push(t.slice(0, 200))
  }
})
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`))

// ── login ────────────────────────────────────────────────────────────────
await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' })
await page.locator('input[type="email"]').fill(EMAIL)
await page.locator('input[type="password"]').fill(PWD)
await page.locator('button[type="submit"]').click()
await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15_000 })
console.log(`\nFull-app route review against ${APP} (logged in as ${EMAIL})\n`)

/**
 * Each route: { path, name, expect: [strings — at least one must appear],
 * emptyOk: [strings that count as a designed empty state] }.
 * A page passes if (any expect matched OR any emptyOk matched) AND no
 * crash markers appear.
 */
const ROUTES = [
  { path: '/dashboard',        name: 'Dashboard',          expect: ['Contracts', 'Pending', 'Renewals', 'queue'] },
  { path: '/agent',            name: 'Assistant (agent)',  expect: ['New conversation', 'Ask anything'] },
  { path: '/matters',          name: 'Matters',            expect: ['Matters'], emptyOk: ['No matters'] },
  { path: '/contracts',        name: 'Contracts list',     expect: ['Master Services', 'NDA', 'MSA', 'Filters'] },
  { path: '/requests',         name: 'Requests',           expect: ['Request', 'SUBMITTED', 'New request'], emptyOk: ['No requests'] },
  { path: '/counterparties',   name: 'Counterparties',     expect: ['Acme', 'Counterpart'], emptyOk: ['No counterparties'] },
  { path: '/approvals',        name: 'Approvals',          expect: ['Approval', 'queue', 'Workflows'], emptyOk: ['No approvals', 'queue is clear'] },
  { path: '/signatures',       name: 'Signatures',         expect: ['Signature', 'envelope'], emptyOk: ['No signature requests'] },
  { path: '/obligations',      name: 'Obligations',        expect: ['Obligation'], emptyOk: ['No obligations'] },
  { path: '/renewals',         name: 'Renewals',           expect: ['Renewal', 'expir'], emptyOk: ['No renewals', 'Nothing expiring'] },
  { path: '/invoices',         name: 'Invoices',           expect: ['Invoice'], emptyOk: ['No invoices'] },
  { path: '/templates',        name: 'Templates',          expect: ['Template'], emptyOk: ['No templates'] },
  { path: '/clauses',          name: 'Clauses',            expect: ['Clause'], emptyOk: ['No clauses'] },
  { path: '/playbook',         name: 'Playbook',           expect: ['Playbook', 'position'], emptyOk: ['No playbook'] },
  { path: '/analytics',        name: 'Analytics',          expect: ['Analytics', 'ACV', 'value', 'distribution'] },
  { path: '/diligence',        name: 'Diligence rooms',    expect: ['Diligence'], emptyOk: ['No rooms', 'No diligence'] },
  { path: '/admin/users',      name: 'Admin · Users',      expect: ['Admin User', 'Users', 'Invite'] },
  { path: '/admin/roles',      name: 'Admin · Roles',      expect: ['Role', 'permission'] },
  { path: '/admin/org',        name: 'Admin · Org',        expect: ['Organization', 'General', 'org'] },
  { path: '/admin/integrations', name: 'Admin · Integrations', expect: ['API Keys', 'Webhooks', 'Slack', 'Health'] },
  { path: '/admin/skills',     name: 'Admin · Skills',     expect: ['Skill'], emptyOk: ['No skills'] },
  { path: '/team',             name: 'Team workload',      expect: ['Team', 'workload', 'capacity'] },
  { path: '/settings',         name: 'Settings',           expect: ['Settings', 'Profile', 'Notification'] },
  { path: '/profile',          name: 'Profile',            expect: ['Profile', 'Admin User', 'email'] },
]

const CRASH_MARKERS = /something went wrong|unexpected error|error boundary|cannot read propert|undefined is not|minified react error|failed to load|server error/i

for (const r of ROUTES) {
  const errsBefore = consoleErrors.length
  try {
    await page.goto(`${APP}${r.path}`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {})
    await page.waitForTimeout(800)
    const text = await page.evaluate(() => document.body.innerText)
    const slug = r.path.replace(/\//g, '_')

    if (CRASH_MARKERS.test(text)) {
      await page.screenshot({ path: path.join(SHOTS, `FAIL${slug}.png`), fullPage: true }).catch(() => {})
      ko(r.name, `crash marker on page: ${text.match(CRASH_MARKERS)?.[0]}`)
      continue
    }
    if (text.trim().length < 80) {
      await page.screenshot({ path: path.join(SHOTS, `FAIL${slug}.png`), fullPage: true }).catch(() => {})
      ko(r.name, `page nearly blank (${text.trim().length} chars)`)
      continue
    }
    const lower = text.toLowerCase()
    const matched = r.expect.some(e => lower.includes(e.toLowerCase()))
    const emptyMatched = (r.emptyOk ?? []).some(e => lower.includes(e.toLowerCase()))
    if (!matched && !emptyMatched) {
      await page.screenshot({ path: path.join(SHOTS, `FAIL${slug}.png`), fullPage: true }).catch(() => {})
      ko(r.name, `no expected content (looked for: ${r.expect.join(', ')})  ·  saw: ${text.slice(0, 120).replace(/\n/g, ' ')}`)
      continue
    }
    const newErrs = consoleErrors.length - errsBefore
    if (newErrs > 0) {
      ko(r.name, `rendered but ${newErrs} console error(s): ${consoleErrors.slice(-newErrs).join(' | ').slice(0, 200)}`)
      continue
    }
    ok(r.name, matched ? 'data rendered' : 'designed empty state')
  } catch (e) {
    ko(r.name, e.message.slice(0, 150))
  }
}

// ── public routes (logged-out surfaces) ──────────────────────────────────
console.log('')
const pub = await ctx.newPage()
const pubErrs = []
pub.on('pageerror', (e) => pubErrs.push(e.message.slice(0, 150)))
for (const r of [
  { path: '/legal/privacy', name: 'Public · Privacy', expect: ['Privacy'] },
  { path: '/legal/terms',   name: 'Public · Terms',   expect: ['Terms'] },
  { path: '/legal/status',  name: 'Public · Status',  expect: ['Status', 'operational'] },
]) {
  try {
    await pub.goto(`${APP}${r.path}`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await pub.waitForTimeout(500)
    const text = await pub.evaluate(() => document.body.innerText)
    if (r.expect.some(e => text.toLowerCase().includes(e.toLowerCase()))) ok(r.name)
    else ko(r.name, `missing expected content · saw: ${text.slice(0, 100).replace(/\n/g, ' ')}`)
  } catch (e) { ko(r.name, e.message.slice(0, 120)) }
}

console.log('\n' + '='.repeat(60))
console.log(`Full review: \x1b[32m${pass} pass\x1b[0m  /  \x1b[31m${fail} fail\x1b[0m`)
if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log(`  ✗ ${f}`)) }
if (consoleErrors.length) {
  console.log(`\nConsole errors collected (${consoleErrors.length}):`)
  ;[...new Set(consoleErrors)].slice(0, 10).forEach(e => console.log(`  • ${e}`))
}
console.log('='.repeat(60))
await browser.close()
process.exit(fail > 0 ? 1 : 0)
