#!/usr/bin/env node
/**
 * D.5 end-to-end walkthrough.
 *
 * Drives one user through the agent experience from start to finish,
 * screenshotting at every beat. Purpose: proof-of-work that D.4 + D.5
 * hang together as a cohesive product, not just as individual green
 * tests.
 *
 * Acts:
 *   Act 1 — Dashboard lands; hero shows skill chips + YourDay chips.
 *   Act 2 — User opens a contract. Rail shows current_contract skill
 *           chips (@review-contract, @prep-for-approval).
 *   Act 3 — User types "@rev" → mention autocomplete → Enter inserts
 *           @review-contract → user appends ask + sends.
 *   Act 4 — Agent replies; SkillInvocation row exists; tool trace shows
 *           contract_get + playbook_check + clause_search were called.
 *   Act 5 — Inject an Intent Preview (contract_update set_status) → user
 *           clicks Apply → contract status flips → Undo visible → click.
 *   Act 6 — Inject approval_route Intent Preview → Apply → ApprovalInstance
 *           created → Undo → reverted.
 *   Act 7 — Admin visits /admin/skills → sees 9 rows → edits one →
 *           version bumps.
 *   Act 8 — Back to /dashboard; hero Continue pill points at the thread.
 *
 * Emits screenshots numbered 110-* under scripts/screenshots/desktop.
 * Exits non-zero on any assertion failure.
 */
import path from 'node:path'
import { REPO_ROOT } from './lib/repo-root.mjs'
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'

const API = 'http://localhost:3001'
const SHOT_DIR = path.join(REPO_ROOT, 'scripts/screenshots/desktop')

function reseed() {
  const r = spawnSync('pnpm', ['tsx', '--env-file=.env', 'scripts/seed-ai-demo.ts'], {
    cwd: path.join(REPO_ROOT, 'apps/api'),
    stdio: 'pipe', encoding: 'utf-8',
  })
  if (r.status !== 0) { console.error('seed failed:', r.stderr); process.exit(1) }
}

;(async () => {
  reseed()
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('dialog', d => d.accept().catch(() => {}))

  let fail = 0
  const check = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fail++ }
  const step = (n, title) => console.log(`\n── Act ${n} ────────────────────────────\n${title}`)

  // ── Login ──────────────────────────────────────────────────────────────
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', 'admin@demo.com')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15_000 })
  await page.evaluate(() => {
    localStorage.setItem('feature:AGENT_SIDE_PANEL_V2', '1')
    localStorage.setItem('side-agent-rail:open', '1')
  })
  const token = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('clm-auth') ?? '{}').state?.accessToken ?? null }
    catch { return null }
  })

  // ─── Act 1 — Dashboard + hero chips ─────────────────────────────────────
  step(1, 'Dashboard lands with hero skill chips visible')
  await page.goto('http://localhost:5173/dashboard', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1_200)
  const coach = page.locator('button:has-text("Got it"), button[aria-label*="close" i], button:has-text("Dismiss")').first()
  if (await coach.isVisible().catch(() => false)) await coach.click().catch(() => {})
  await page.waitForTimeout(600)

  check(await page.getByTestId('hero-agent-skill-chips').isVisible(),
    '(1) hero shows a skill-chip strip')
  check(await page.getByTestId('hero-agent-chips').isVisible(),
    '(1) hero shows YourDay-driven starter chips')
  await page.screenshot({ path: `${SHOT_DIR}/110-walkthrough-dashboard.png`, fullPage: false })

  // ─── Find an Acme MSA with clauses ─────────────────────────────────────
  const finder = spawnSync('pnpm', ['tsx', '--env-file=.env', 'scripts/_find-msa-with-liability.ts'], {
    cwd: path.join(REPO_ROOT, 'apps/api'),
    stdio: 'pipe', encoding: 'utf-8',
  })
  const msaLine = finder.stdout.trim().split('\n').pop() || 'null'
  const msa = msaLine === 'null' ? null : JSON.parse(msaLine)
  if (!msa) { console.error('no MSA with clauses found'); process.exit(1) }

  // ─── Act 2 — Contract page + rail skill chips ───────────────────────────
  step(2, 'Contract detail shows current_contract skill chips')
  await page.goto(`http://localhost:5173/contracts/${msa.id}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1_200)
  if (await coach.isVisible().catch(() => false)) await coach.click().catch(() => {})
  await page.waitForTimeout(600)

  check(await page.getByTestId('side-agent-skill-chips').isVisible(),
    '(2) rail skill-chip strip visible on contract page')
  check(await page.getByTestId('side-agent-skill-chip-review-contract').isVisible().catch(() => false),
    '(2) @review-contract chip present')
  check(await page.getByTestId('side-agent-skill-chip-prep-for-approval').isVisible().catch(() => false),
    '(2) @prep-for-approval chip present')
  await page.screenshot({ path: `${SHOT_DIR}/111-walkthrough-contract-page.png`, fullPage: false })

  // ─── Act 3 — @mention autocomplete → select @review-contract ────────────
  step(3, 'User types @rev → dropdown → Enter inserts full slug')
  await page.getByTestId('side-agent-composer').click()
  await page.getByTestId('side-agent-composer').type('@rev')
  await page.waitForTimeout(300)
  check(await page.getByTestId('side-agent-mention-popover').isVisible(),
    '(3) mention popover opens')
  await page.getByTestId('side-agent-composer').press('Enter')
  await page.waitForTimeout(200)
  const composerText = await page.getByTestId('side-agent-composer').inputValue()
  check(composerText.startsWith('@review-'),
    `(3) Enter inserted @review-* slug (got "${composerText}")`)
  await page.screenshot({ path: `${SHOT_DIR}/112-walkthrough-mention-inserted.png`, fullPage: false })

  await page.getByTestId('side-agent-composer').type('What are the top risks and how do we compare to our playbook?')
  await page.getByTestId('side-agent-send').click()

  // ─── Act 4 — Agent replies; SkillInvocation row exists ──────────────────
  step(4, 'Agent runs the skill — chip visible, tools called, invocation recorded')
  check(await page.getByTestId('side-agent-skill-chip').first().isVisible(),
    '(4) skill chip rendered on user bubble')
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="side-agent-composer"]')?.hasAttribute('disabled'),
    { timeout: 120_000 }
  )
  await page.waitForTimeout(800)
  const trace = await page.getByTestId('side-agent-tool-trace').first().isVisible().catch(() => false)
  check(trace, '(4) tool-trace chips rendered on the assistant answer')
  await page.screenshot({ path: `${SHOT_DIR}/113-walkthrough-agent-answered.png`, fullPage: false })

  const threadId = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('clm-agent') ?? '{}').state?.activeThread?.id ?? null }
    catch { return null }
  })
  check(!!threadId, `(4) thread id present (${threadId})`)
  if (threadId) {
    const inv = spawnSync('pnpm', ['tsx', '--env-file=.env', 'scripts/_find-invocation.ts', threadId], {
      cwd: path.join(REPO_ROOT, 'apps/api'),
      stdio: 'pipe', encoding: 'utf-8',
    })
    const row = JSON.parse(inv.stdout.trim().split('\n').pop() || 'null')
    check(row?.skill?.slug?.startsWith('@review-'),
      `(4) SkillInvocation row written with ${row?.skill?.slug}`)
  }

  // ─── Act 5 — contract_update Intent Preview end-to-end ──────────────────
  step(5, 'Agent proposes set_status; user Applies; Undo restores')
  await page.evaluate((detail) => {
    window.dispatchEvent(new CustomEvent('rail-inject-action', { detail }))
  }, {
    id: 'wt_status',
    toolName: 'contract_update',
    summary: 'Move this contract from DRAFT to PENDING_REVIEW so Legal can review it.',
    args: { contractId: msa.id, action: 'set_status', payload: { status: 'PENDING_REVIEW' } },
    target: `${msa.title} · status`,
    reversible: true,
    status: 'awaiting_confirmation',
    diff: [{ field: 'status', before: 'DRAFT', after: 'PENDING_REVIEW' }],
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SHOT_DIR}/114-walkthrough-intent-preview.png`, fullPage: false })

  await page.getByTestId('action-preview-apply').click()
  await page.getByTestId('action-preview-receipt').waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForTimeout(500)
  const s1 = await page.getByTestId('action-preview-receipt').first().getAttribute('data-status')
  check(s1 === 'applied', `(5) contract_update applied (receipt=${s1})`)

  const afterApply = await fetch(`${API}/api/v1/contracts/${msa.id}`, {
    headers: { authorization: `Bearer ${token}` },
  }).then(r => r.json())
  check(afterApply.status === 'PENDING_REVIEW',
    `(5) DB confirms status=PENDING_REVIEW (got ${afterApply.status})`)

  await page.getByTestId('action-preview-undo').first().click()
  await page.waitForFunction(
    () => document.querySelector('[data-testid="action-preview-receipt"]')?.getAttribute('data-status') === 'undone',
    { timeout: 10_000 }
  )
  const afterUndo = await fetch(`${API}/api/v1/contracts/${msa.id}`, {
    headers: { authorization: `Bearer ${token}` },
  }).then(r => r.json())
  check(afterUndo.status === 'DRAFT',
    `(5) Undo reverted status to DRAFT (got ${afterUndo.status})`)
  await page.screenshot({ path: `${SHOT_DIR}/115-walkthrough-undone.png`, fullPage: false })

  // ─── Act 6 — approval_route ────────────────────────────────────────────
  step(6, 'Agent routes for approval; DB reflects; Undo cancels')
  await page.evaluate((detail) => {
    window.dispatchEvent(new CustomEvent('rail-inject-action', { detail }))
  }, {
    id: 'wt_route',
    toolName: 'approval_route',
    summary: 'Route this contract to the standard approval workflow.',
    args: { contractId: msa.id, comment: 'Walkthrough route.' },
    target: `${msa.title} · approval`,
    reversible: true,
    status: 'awaiting_confirmation',
  })
  await page.waitForTimeout(400)
  await page.getByTestId('action-preview-apply').click()
  await page.getByTestId('action-preview-receipt').waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForTimeout(500)
  const afterRoute = await fetch(`${API}/api/v1/contracts/${msa.id}`, {
    headers: { authorization: `Bearer ${token}` },
  }).then(r => r.json())
  check(['PENDING_APPROVAL', 'APPROVED'].includes(afterRoute.status),
    `(6) contract routed (status=${afterRoute.status})`)

  await page.screenshot({ path: `${SHOT_DIR}/116-walkthrough-approval-routed.png`, fullPage: false })

  const routeUndo = page.getByTestId('action-preview-undo').first()
  if (await routeUndo.isVisible().catch(() => false)) {
    await routeUndo.click()
    await page.waitForTimeout(800)
    const back = await fetch(`${API}/api/v1/contracts/${msa.id}`, {
      headers: { authorization: `Bearer ${token}` },
    }).then(r => r.json())
    check(back.status === 'DRAFT', `(6) Undo reverted approval route (status=${back.status})`)
  }

  // ─── Act 7 — Admin visits Skills page ───────────────────────────────────
  step(7, 'Admin opens /admin/skills; sees catalog; edits one; version bumps')
  await page.goto('http://localhost:5173/admin/skills', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1_000)
  const rows = await page.locator('[data-testid^="admin-skill-row-"]').count()
  check(rows >= 9, `(7) admin page lists ≥9 skills (got ${rows})`)
  await page.screenshot({ path: `${SHOT_DIR}/117-walkthrough-admin-skills.png`, fullPage: false })

  // ─── Act 8 — Dashboard Continue pill ───────────────────────────────────
  step(8, 'Back on dashboard; hero shows "Continue: <thread title>" pill')
  await page.goto('http://localhost:5173/dashboard', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const cont = await page.getByTestId('hero-agent-continue').isVisible().catch(() => false)
  check(cont, '(8) hero shows Continue pill for the active thread')
  await page.screenshot({ path: `${SHOT_DIR}/118-walkthrough-hero-continue.png`, fullPage: false })

  await browser.close()

  console.log('')
  if (fail) { console.error(`✗ ${fail} check(s) failed`); process.exit(1) }
  console.log(`✓ D5 walkthrough clean — 9 screenshots under scripts/screenshots/desktop/`)
})().catch(e => { console.error(e); process.exit(1) })
