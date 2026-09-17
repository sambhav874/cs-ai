#!/usr/bin/env node
/**
 * Audit Q.1 — Public routes.
 *
 * Walks /login, /register, /accept-invite/:token, /portal/:token, /sign/:token.
 * For each: screenshot + DOM sanity checks (form present, copy sensible,
 * brand consistent, error states render).
 *
 * Outputs to scripts/audit-screenshots/q1-* + prints findings to stdout.
 */
import path from 'node:path'
import { REPO_ROOT } from './lib/repo-root.mjs'
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const OUT = path.join(REPO_ROOT, 'scripts/audit-screenshots')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('  [PAGEERR]', e.message.slice(0, 200)))

  const findings = []
  const log = (s) => { console.log(s) }
  const finding = (code, sev, screen, what) => {
    findings.push({ code, sev, screen, what })
    log(`  ✗ ${code} (${sev}): ${what}`)
  }

  // ── /login ────────────────────────────────────────────────────
  log('\n=== /login ===')
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/q1-login.png`, fullPage: false })
  const hasEmail = await page.locator('input[type="email"]').count()
  const hasPwd   = await page.locator('input[type="password"]').count()
  const hasSubmit = await page.locator('button[type="submit"]').count()
  log(`  email-field=${hasEmail} pwd-field=${hasPwd} submit=${hasSubmit}`)
  if (!hasEmail || !hasPwd || !hasSubmit) finding('F-PUB-01', 'P0', '/login', 'Missing one of email/password/submit form elements')

  // Try invalid credentials → error state
  await page.fill('input[type="email"]', 'bogus@nowhere.com')
  await page.fill('input[type="password"]', 'wrong-password')
  await page.click('button[type="submit"]')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/q1-login-error.png`, fullPage: false })
  const errorText = await page.locator('body').innerText()
  const hasError = /invalid|incorrect|wrong|unauthor|fail/i.test(errorText)
  log(`  invalid-creds error rendered: ${hasError}`)
  if (!hasError) finding('F-PUB-02', 'P1', '/login', 'No clear error message on bad credentials')

  // ── /register ─────────────────────────────────────────────────
  log('\n=== /register ===')
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/q1-register.png`, fullPage: false })
  const regInputs = await page.locator('input').count()
  const regSubmit = await page.locator('button[type="submit"]').count()
  log(`  inputs=${regInputs} submit=${regSubmit}`)
  if (regInputs < 3) finding('F-PUB-03', 'P1', '/register', `Register form has only ${regInputs} inputs — expected name + email + password + maybe org name`)

  // ── /accept-invite/:token (with bogus token to test error UX) ──
  log('\n=== /accept-invite/:bogus-token ===')
  await page.goto(`${BASE}/accept-invite/this-is-an-invalid-token`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/q1-accept-invite-invalid.png`, fullPage: false })
  const inviteText = await page.locator('body').innerText()
  const hasInviteError = /invalid|expir|not found|unable/i.test(inviteText)
  log(`  invalid-invite error rendered: ${hasInviteError}`)
  if (!hasInviteError) finding('F-PUB-04', 'P1', '/accept-invite/:t', 'Invalid invite token does not show clear error state')

  // ── /portal/:token (bogus token) ──────────────────────────────
  log('\n=== /portal/:bogus-token ===')
  await page.goto(`${BASE}/portal/this-is-an-invalid-token`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/q1-portal-invalid.png`, fullPage: false })
  const portalText = await page.locator('body').innerText()
  const hasPortalError = /invalid|expir|not found|unable|404/i.test(portalText)
  log(`  invalid-portal error rendered: ${hasPortalError}`)
  if (!hasPortalError) finding('F-PUB-05', 'P1', '/portal/:t', 'Invalid portal token does not show clear error state')

  // ── /sign/:token (bogus token) ────────────────────────────────
  log('\n=== /sign/:bogus-token ===')
  await page.goto(`${BASE}/sign/this-is-an-invalid-token`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/q1-sign-invalid.png`, fullPage: false })
  const signText = await page.locator('body').innerText()
  const hasSignError = /invalid|expir|not found|unable|404/i.test(signText)
  log(`  invalid-sign error rendered: ${hasSignError}`)
  if (!hasSignError) finding('F-PUB-06', 'P1', '/sign/:t', 'Invalid sign token does not show clear error state')

  await browser.close()

  // ── Summary ────────────────────────────────────────────────────
  log('\n=== Q.1 SUMMARY ===')
  log(`Findings: ${findings.length}`)
  findings.forEach(f => log(`  ${f.code} [${f.sev}] ${f.screen}: ${f.what}`))
})().catch(e => { console.error(e); process.exit(1) })
