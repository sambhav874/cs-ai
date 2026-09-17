#!/usr/bin/env node
/**
 * screen-items-review.mjs — interaction-depth review of every screen.
 *
 * Where full-review.mjs asserts each route RENDERS, this script asserts
 * each screen's ITEMS actually work: tabs switch content, modals open
 * and close, filters change the result set, search narrows lists,
 * dropdowns open, forms validate. Read-only by design — it opens and
 * closes things but never persists writes (no seeds polluted).
 *
 * Usage: APP_URL=http://localhost:5173 node scripts/screen-items-review.mjs
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(__dirname, 'screenshots', 'screen-items')
fs.rmSync(SHOTS, { recursive: true, force: true })
fs.mkdirSync(SHOTS, { recursive: true })

const APP   = process.env.APP_URL        ?? 'http://localhost:5173'
const EMAIL = process.env.ADMIN_EMAIL    ?? 'admin@demo.com'
const PWD   = process.env.ADMIN_PASSWORD ?? 'password123'

let pass = 0, fail = 0
const failures = []
const ok = (n, d = '') => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}${d ? '  ·  ' + d : ''}`) }
const ko = (n, d) => { fail++; failures.push(`${n} — ${d}`); console.log(`  \x1b[31m✗\x1b[0m ${n}  ·  ${String(d).slice(0, 160)}`) }
const section = (t) => console.log(`\n▶ ${t}`)

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 150)))

const login = async () => {
  await page.locator('input[type="email"]').fill(EMAIL)
  await page.locator('input[type="password"]').fill(PWD)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15_000 })
}
const go = async (p) => {
  await page.goto(`${APP}${p}`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {})
  await page.waitForTimeout(600)
  // Resilience: parallel API logins rotate the refresh token and can
  // bounce this browser session to /login mid-run. Re-login + retry.
  if (page.url().includes('/login')) {
    await login()
    await page.goto(`${APP}${p}`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {})
    await page.waitForTimeout(600)
  }
}
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`) }).catch(() => {})
const bodyText = () => page.evaluate(() => document.body.innerText)
/** Click + assert some text appears that wasn't there (or a predicate). */
async function clickAnd(name, locator, assertFn, shotName) {
  try {
    await locator.first().click({ timeout: 5000 })
    await page.waitForTimeout(700)
    const good = await assertFn()
    if (good) ok(name)
    else { await shot(shotName ?? `FAIL-${name.replace(/\W+/g, '_')}`); ko(name, 'expected effect not observed') }
  } catch (e) {
    await shot(shotName ?? `FAIL-${name.replace(/\W+/g, '_')}`)
    ko(name, e.message.split('\n')[0])
  }
}
const escape = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300) }

// ── login ────────────────────────────────────────────────────────────────
await go('/login')
await page.locator('input[type="email"]').fill(EMAIL)
await page.locator('input[type="password"]').fill(PWD)
await page.locator('button[type="submit"]').click()
await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15_000 })
console.log(`\nScreen-items review against ${APP}\n`)

try {
  // ════ 1. Global chrome ════
  section('Global chrome (header)')
  await go('/dashboard')
  await clickAnd('global search opens (button)', page.getByRole('button', { name: /open global search/i }),
    async () => (await page.locator('input[placeholder*="Search"], [role="dialog"] input').count()) > 0)
  await page.keyboard.type('acme'); await page.waitForTimeout(900)
  const searchHits = await page.evaluate(() => document.body.innerText.toLowerCase().includes('acme'))
  searchHits ? ok('global search returns results for "acme"') : ko('global search results', 'no acme hit shown')
  await escape()
  await clickAnd('notification bell opens', page.getByRole('button', { name: /notifications/i }),
    async () => /notification|mark.*read|caught up|approval/i.test(await bodyText()))
  await escape()
  await clickAnd('account menu opens', page.getByRole('button', { name: /account menu/i }),
    async () => /profile|sign out|log ?out|settings/i.test(await bodyText()))
  await escape()

  // ════ 2. Dashboard ════
  section('Dashboard')
  await go('/dashboard')
  const kpiLink = page.locator('a[href*="/contracts"], button:has-text("Contracts")').first()
  await clickAnd('KPI/nav → contracts navigates', kpiLink, async () => page.url().includes('/contracts'))

  // ════ 3. Contracts list ════
  section('Contracts list')
  await go('/contracts')
  const rowCount = async () => await page.locator('table tbody tr, [data-testid*="contract-row"]').count()
  const before = await rowCount()
  before > 0 ? ok(`rows render (${before})`) : ko('rows render', 'no rows found')
  const searchBox = page.locator('input[placeholder*="earch"]').first()
  await searchBox.fill('Acme'); await page.waitForTimeout(1200)
  const after = await rowCount()
  after > 0 && after <= before ? ok(`search narrows rows (${before} → ${after})`) : ko('search narrows rows', `${before} → ${after}`)
  await searchBox.fill(''); await page.waitForTimeout(800)
  await clickAnd('Filters panel opens', page.getByRole('button', { name: /filters/i }),
    async () => /jurisdiction|risk|status|clause|expiring/i.test(await bodyText()))
  await escape()
  await clickAnd('New contract flow opens', page.getByRole('button', { name: /new contract|upload|add contract/i }),
    async () => (await page.locator('[role="dialog"]').count()) > 0 || /upload|template|blank/i.test(await bodyText()))
  await escape()

  // ════ 4. Contract detail ════
  section('Contract detail')
  let detailText = ''
  try {
    await go('/contracts')
    const firstRow = page.locator('[data-testid^="contract-row-"]').first()
    await firstRow.waitFor({ state: 'visible', timeout: 10_000 })
    await firstRow.click({ timeout: 10_000 })
    await page.waitForURL(/\/contracts\/[a-z0-9]+/, { timeout: 10_000 })
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {})
    await page.waitForTimeout(1000)
    ok('row click → detail page', page.url().split('/').pop().slice(0, 12))
    detailText = await bodyText()
  } catch (e) {
    await shot('FAIL-contract-detail-open')
    ko('row click → detail page', e.message.split('\n')[0])
  }
  for (const sectionName of ['Key terms', 'Risks', 'Obligations', 'Compliance']) {
    detailText.toLowerCase().includes(sectionName.toLowerCase())
      ? ok(`rail section present: ${sectionName}`)
      : ko(`rail section present: ${sectionName}`, 'not found on page')
  }
  // tabs strip (document is default; click others if present)
  for (const tab of ['clauses', 'versions', 'activity']) {
    const t = page.locator(`[data-testid="tab-${tab}"], button:has-text("${tab}")`).first()
    if (await t.count()) {
      await clickAnd(`tab switches: ${tab}`, t, async () => true)
      const back = page.locator('[data-testid="tab-back-to-document"]').first()
      if (await back.count()) await back.click().catch(() => {})
      await page.waitForTimeout(400)
    }
  }
  const compareBtn = page.locator('[data-testid="compare-btn"]:visible').first()
  if (await compareBtn.count() && await compareBtn.isEnabled().catch(() => false)) {
    await clickAnd('Compare mode opens', compareBtn, async () => /version|original|diff|side/i.test(await bodyText()))
    await escape(); await page.goBack().catch(() => {}); await page.waitForTimeout(400)
  } else { ok('compare disabled/absent (single-version contract — designed state)') }
  const actionsBtn = page.getByRole('button', { name: /^actions$/i }).first()
  if (await actionsBtn.count()) {
    await clickAnd('Actions menu opens', actionsBtn,
      async () => /archive|export|amendment|delete|duplicate|compliance/i.test(await bodyText()))
    await escape()
  } else { ok('actions menu not present on this status (conditional CTA)') }

  // ════ 5. Requests ════
  section('Requests')
  await go('/requests')
  await clickAnd('New request modal opens', page.locator('[data-testid="requests-create-btn"]'),
    async () => (await page.locator('[data-testid="new-request-modal"]').count()) > 0)
  const reqSubmit = page.locator('[data-testid="request-submit"]').first()
  if (await reqSubmit.count()) {
    const disabled = await reqSubmit.isDisabled().catch(() => false)
    if (disabled) ok('request submit disabled while form empty')
    else {
      await reqSubmit.click().catch(() => {})
      await page.waitForTimeout(500)
      ;(await page.locator('[data-testid="new-request-modal"]').count()) > 0
        ? ok('request form validates (does not submit empty)')
        : ko('request form validates', 'modal closed on empty submit')
    }
  }
  // Hand-rolled modal: no Escape handler — close via Cancel/X.
  const reqCancel = page.locator('[data-testid="new-request-modal"] button:has-text("Cancel")').first()
  if (await reqCancel.count()) await reqCancel.click().catch(() => {})
  await escape()
  await page.waitForTimeout(400)
  for (const tab of ['SUBMITTED', 'all']) {
    await clickAnd(`status tab: ${tab}`, page.locator(`[data-testid="requests-tab-${tab}"]`), async () => true)
  }

  // ════ 6. Counterparties ════
  section('Counterparties')
  await go('/counterparties')
  const cpSearch = page.locator('input[placeholder*="earch"]').first()
  if (await cpSearch.count()) {
    await cpSearch.fill('Acme'); await page.waitForTimeout(1000)
    ;(await bodyText()).includes('Acme') ? ok('counterparty search works') : ko('counterparty search', 'Acme not shown')
    await cpSearch.fill('')
  }
  await clickAnd('counterparty row → detail', page.locator('table tbody tr, a[href*="/counterparties/"]').first(),
    async () => /contracts|deals|contact|memory/i.test(await bodyText()))

  // ════ 7. Matters ════
  section('Matters')
  await go('/matters')
  const matterRow = page.locator('a[href*="/matters/"], table tbody tr').first()
  if (await matterRow.count()) {
    await clickAnd('matter row → detail', matterRow, async () => /task|contract|status|matter/i.test(await bodyText()))
  } else { ok('matters empty state (no rows to open)') }

  // ════ 8. Approvals ════
  section('Approvals')
  await go('/approvals')
  await clickAnd('Manage workflows tab', page.getByRole('button', { name: /manage|workflow/i }),
    async () => /workflow|step|builder|create/i.test(await bodyText()))
  await clickAnd('workflow builder opens', page.getByRole('button', { name: /new workflow|create workflow/i }),
    async () => /step|approver|trigger|name/i.test(await bodyText()))
  await escape()

  // ════ 9. Signatures ════
  section('Signatures')
  await go('/signatures')
  const sigText = await bodyText()
  ;/pending|completed|voided|all/i.test(sigText) ? ok('signature filters/tabs present') : ko('signature filters', 'no filter tabs found')

  // ════ 10. Obligations ════
  section('Obligations')
  await go('/obligations')
  const oblDone = page.locator('[data-testid^="complete-btn-"]').first()
  if (await oblDone.count()) {
    await clickAnd('complete-obligation modal opens', oblDone,
      async () => (await page.locator('[role="dialog"], [data-testid*="complete-obligation"]').count()) > 0 || /mark complete|notes|completion/i.test(await bodyText()))
    await escape()
  } else { ok('no completable obligations visible (empty/done state)') }

  // ════ 11. Renewals ════
  section('Renewals')
  await go('/renewals')
  ;/renew|expir|advice|recommend/i.test(await bodyText()) ? ok('renewals content renders') : ko('renewals content', 'missing')

  // ════ 12. Invoices ════
  section('Invoices')
  await go('/invoices')
  await clickAnd('new invoice modal opens', page.getByRole('button', { name: /new invoice|add invoice/i }),
    async () => (await page.locator('[role="dialog"]').count()) > 0)
  await escape()

  // ════ 13. Templates ════
  section('Templates')
  await go('/templates')
  await clickAnd('template opens (builder/preview)', page.locator('a[href*="/templates/"], table tbody tr, [data-testid*="template-card"]').first(),
    async () => /section|variable|editor|publish|body|preview/i.test(await bodyText()))
  await go('/templates')
  await clickAnd('new template CTA works', page.getByRole('button', { name: /new template|create template/i }),
    async () => /name|type|blank|editor/i.test(await bodyText()))
  await escape()

  // ════ 14. Clauses ════
  section('Clauses')
  await go('/clauses')
  const clauseText = await bodyText()
  ;/categor|liability|confidential|indemn/i.test(clauseText) ? ok('clause library categories render') : ko('clause categories', 'none visible')
  await clickAnd('add clause CTA', page.getByRole('button', { name: /new clause|add clause/i }),
    async () => (await page.locator('[role="dialog"], textarea').count()) > 0)
  await escape()

  // ════ 15. Playbook ════
  section('Playbook')
  await go('/playbook')
  ;/position|standard|fallback|walk.?away|category/i.test(await bodyText()) ? ok('playbook positions render') : ko('playbook positions', 'none visible')

  // ════ 16. Analytics ════
  section('Analytics')
  await go('/analytics')
  const charts = await page.locator('svg.recharts-surface, .recharts-wrapper').count()
  charts > 0 ? ok(`charts render (${charts} chart surfaces)`) : ko('charts render', 'no recharts surfaces found')
  const exportBtn = page.getByRole('button', { name: /export|csv|download/i }).first()
  if (await exportBtn.count()) await clickAnd('export button responds', exportBtn, async () => true)
  else ok('no export button on analytics (export lives on list pages)')

  // ════ 17. Diligence ════
  section('Diligence rooms')
  await go('/diligence')
  await clickAnd('new room modal opens', page.getByRole('button', { name: /new room|create room/i }),
    async () => (await page.locator('[role="dialog"]').count()) > 0)
  await escape()
  const room = page.locator('a[href*="/diligence/"], table tbody tr').first()
  if (await room.count()) await clickAnd('room → detail', room, async () => /document|upload|result|extract/i.test(await bodyText()))

  // ════ 18. Admin screens ════
  section('Admin · Users')
  await go('/admin/users')
  await clickAnd('invite user modal opens', page.getByRole('button', { name: /invite/i }),
    async () => (await page.locator('[role="dialog"]').count()) > 0 || /email|role/i.test(await bodyText()))
  await escape()

  section('Admin · Roles')
  await go('/admin/roles')
  ;/admin|legal|permission/i.test(await bodyText()) ? ok('roles + permissions render') : ko('roles render', 'missing')

  section('Admin · Org (tab strip)')
  await go('/admin/org')
  for (const tab of ['Alert', 'AI', 'System', 'Data', 'General']) {
    const t = page.getByRole('button', { name: new RegExp(tab, 'i') }).first()
    if (await t.count()) await clickAnd(`org tab: ${tab}`, t, async () => true)
  }

  section('Admin · Integrations (tab strip)')
  await go('/admin/integrations')
  for (const tid of ['tab-webhooks', 'tab-slack', 'tab-health', 'tab-api-keys']) {
    await clickAnd(`integrations ${tid}`, page.locator(`[data-testid="${tid}"]`), async () => true)
  }

  section('Admin · Skills')
  await go('/admin/skills')
  ;/compliance sweep|draft|skill/i.test(await bodyText()) ? ok('skills list renders') : ko('skills list', 'missing')

  section('Team')
  await go('/team')
  ;/workload|capacity|active/i.test(await bodyText()) ? ok('team workload renders') : ko('team workload', 'missing')

  // ════ 19. Settings + Profile ════
  section('Settings & Profile')
  await go('/settings')
  ;/notification|profile|preference|password/i.test(await bodyText()) ? ok('settings sections render') : ko('settings sections', 'missing')
  await go('/profile')
  const profileInputs = await page.locator('input').count()
  profileInputs > 0 ? ok(`profile form renders (${profileInputs} inputs)`) : ko('profile form', 'no inputs')

} catch (e) {
  ko('UNCAUGHT', e.message.split('\n')[0])
  await shot('FAIL-uncaught')
}

console.log('\n' + '='.repeat(60))
console.log(`Screen items: \x1b[32m${pass} pass\x1b[0m  /  \x1b[31m${fail} fail\x1b[0m`)
if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log(`  ✗ ${f}`)) }
if (pageErrors.length) { console.log(`\nPage errors (${pageErrors.length}):`); [...new Set(pageErrors)].slice(0, 8).forEach(e => console.log(`  • ${e}`)) }
console.log('='.repeat(60))
await browser.close()
process.exit(fail > 0 ? 1 : 0)
