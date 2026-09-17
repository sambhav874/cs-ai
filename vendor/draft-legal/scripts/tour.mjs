#!/usr/bin/env node
// Capture a desktop screenshot tour of the running app.
// Usage: node scripts/tour.mjs [--out <dir>] [--base http://localhost:5173]

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? acc.concat([[v.slice(2), a[i + 1]]]) : acc), [])
);
const OUT = args.out || path.join(__dirname, 'screenshots', 'desktop');
const AUDIT = path.join(__dirname, 'screenshots', 'contracts-audit');
const BASE = args.base || 'http://localhost:5173';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(AUDIT, { recursive: true });

const errors = [];
let page;

const wait = (ms) => page.waitForTimeout(ms);
const shot = async (dir, name, ms = 700) => {
  await wait(ms);
  const f = path.join(dir, `${name}.png`);
  await page.screenshot({ path: f });
  console.log('✓', path.relative(path.join(__dirname, '..'), f));
};
const shotFull = async (dir, name, ms = 700) => {
  await wait(ms);
  const f = path.join(dir, `${name}.png`);
  await page.screenshot({ path: f, fullPage: true });
  console.log('✓', path.relative(path.join(__dirname, '..'), f), '(full)');
};
const click = async (sel) => { try { await page.click(sel, { timeout: 3000 }); return true; } catch { return false; } };
const clickText = async (text, tag = 'button') => {
  try { await page.getByRole('button', { name: text, exact: false }).first().click({ timeout: 3000 }); return true; }
  catch { return click(`${tag}:has-text("${text}")`); }
};
const goto = async (p) => { try { await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 10000 }); } catch {} };
const closeModal = async () => {
  // Try in order: close button with × / X, Cancel button, Escape, click overlay.
  for (const sel of [
    '.fixed.inset-0 button[aria-label*="lose" i]',
    '.fixed.inset-0 button:has(svg.lucide-x)',
    '.fixed.inset-0 button:has-text("Cancel")',
    '.fixed.inset-0 button:has-text("Close")',
  ]) {
    try { await page.click(sel, { timeout: 500 }); await wait(300); } catch {}
  }
  await page.keyboard.press('Escape').catch(() => {});
  await wait(200);
  // Final: force-remove any stuck overlay so the rest of the tour can proceed.
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0.bg-black\\/50').forEach((el) => el.remove());
  }).catch(() => {});
  await wait(150);
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url() + ' - ' + r.failure()?.errorText));

  // ─── Auth ────────────────────────────────────────────────
  await goto('/');
  await shot(OUT, '01-login');

  // Register page (if direct link exists, else skip)
  const regLink = await page.$('a:has-text("Create one"), a[href*="register"]');
  if (regLink) {
    await regLink.click();
    await wait(800);
    await shot(OUT, '02-register');
    await page.goBack();
    await wait(500);
  }

  // Accept invite (fake token)
  await goto('/accept-invite?token=sample');
  await shot(OUT, '03-accept-invite');

  // ─── Login ───────────────────────────────────────────────
  await goto('/');
  await page.fill('input[type="email"]', 'admin@demo.com');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard)?$/, { timeout: 5000 }).catch(() => {});
  await wait(2000);

  // ─── Dashboard ───────────────────────────────────────────
  await shot(OUT, '04-dashboard');

  // ─── Contracts ───────────────────────────────────────────
  await goto('/contracts');
  await shot(OUT, '05-contracts');
  await shot(AUDIT, '01a-contracts-list-default');

  // Filters
  if (await clickText('Filters')) {
    await shot(AUDIT, '01b-contracts-list-filters-open', 400);
    await page.mouse.click(5, 5); await wait(300);
  }

  // Search
  const searchInput = await page.$('input[placeholder*="Search"]');
  if (searchInput) {
    await searchInput.fill('NDA');
    await shot(AUDIT, '01c-contracts-list-search-nda', 600);
    await searchInput.fill('');
    await wait(300);
  }

  // Upload modal
  if (await clickText('Upload')) {
    await shot(AUDIT, '01e-upload-modal', 800);
    await closeModal();
  }

  // New Contract flow
  if (await clickText('New Contract')) {
    await shot(AUDIT, '01f-new-contract-flow', 800);
    await closeModal();
  }

  // Click first contract row → detail
  const firstRow = await page.$('div.cursor-pointer:has(p)');
  if (firstRow) {
    await firstRow.click();
    await wait(1500);
  }

  // ─── Contract detail — all tabs ─────────────────────────
  await shot(OUT, '06-contract-detail');
  await shot(AUDIT, '02a-detail-overview');
  await page.evaluate(() => window.scrollTo(0, 400));
  await shot(AUDIT, '02b-detail-overview-scrolled', 400);
  await page.evaluate(() => window.scrollTo(0, 0));

  for (const [tab, suffix] of [
    ['Clauses', '02c-detail-clauses'],
    ['Document', '02d-detail-document'],
    ['Versions', '02e-detail-versions'],
    ['Comments', '02f-detail-comments'],
    ['Approval', '02g-detail-approval'],
    ['Activity', '02h-detail-activity'],
  ]) {
    if (await clickText(tab)) {
      await shot(AUDIT, suffix, 1200);
    }
  }

  // Ask AI
  if (await clickText('Ask AI')) {
    await shot(AUDIT, '02i-detail-ask-ai-empty', 1000);
  }

  // Share
  if (await clickText('Share')) {
    await shot(AUDIT, '03a-share-dialog', 800);
    await closeModal();
  }

  // Editor
  if (await clickText('Open in Editor')) {
    await wait(2000);
    await shot(AUDIT, '03b-editor-full');
  }
  await page.goBack();
  await wait(800);

  // Notifications
  const bell = await page.$('header button[aria-label*="otification"], header button:has(svg.lucide-bell)');
  if (bell) {
    await bell.click();
    await shot(AUDIT, '03e-notification-dropdown', 600);
    await page.mouse.click(5, 5); await wait(300);
  }

  // AI Assistant (header)
  const aiBtn = await page.$('header button:has-text("AI Assistant")');
  if (aiBtn) {
    await aiBtn.click();
    await shot(AUDIT, '03d-ai-assistant-panel', 1000);
    await page.keyboard.press('Escape'); await wait(400);
  }

  // ─── Requests ────────────────────────────────────────────
  await goto('/requests');
  await shot(OUT, '07-requests');
  if (await clickText('New Request')) {
    await shot(OUT, '07b-new-request', 800);
    await closeModal();
  }

  // ─── Counterparties ─────────────────────────────────────
  await goto('/counterparties');
  await shot(OUT, '08-counterparties');

  // ─── Templates ───────────────────────────────────────────
  await goto('/templates');
  await shot(OUT, '09-templates');

  // Try opening a template
  const tplRow = await page.$('a[href*="/templates/"], [role="button"][data-template], .cursor-pointer');
  if (tplRow) {
    await tplRow.click(); await wait(1500);
    await shot(OUT, '09b-template-detail');
  }

  // ─── Clause Library ─────────────────────────────────────
  for (const p of ['/clause-library', '/clauses']) {
    await goto(p);
    if (page.url().includes(p)) { await shot(OUT, '10-clauses'); break; }
  }

  // ─── Playbook ────────────────────────────────────────────
  await goto('/playbook');
  await shot(OUT, '11-playbook');

  // ─── Approvals ───────────────────────────────────────────
  await goto('/approvals');
  await shot(OUT, '12-approvals');

  if (await clickText('Manage Workflows') || await clickText('Workflows')) {
    await shot(OUT, '12b-approvals-workflows', 800);
    // Try opening workflow builder
    const builderBtn = await page.$('button:has-text("New Workflow"), button:has-text("Create Workflow"), button:has-text("+ New"), button:has-text("New")');
    if (builderBtn) {
      await builderBtn.click(); await wait(1000);
      await shot(OUT, '12c-workflow-builder');
    }
  }

  // ─── Signatures (Phase 07 — likely not built) ───────────
  await goto('/signatures');
  await shot(OUT, '13-signatures');

  // ─── Analytics (Phase 09 — likely not built) ────────────
  await goto('/analytics');
  await shot(OUT, '14-analytics');

  // ─── Settings ────────────────────────────────────────────
  await goto('/settings');
  await shot(OUT, '15-settings');

  // ─── Team ────────────────────────────────────────────────
  await goto('/team');
  await shot(OUT, '16-team');

  // ─── Profile ─────────────────────────────────────────────
  await goto('/profile');
  await shot(OUT, '17-profile');

  // ─── Admin ───────────────────────────────────────────────
  await goto('/admin/users');
  await shot(OUT, '18-admin-users');
  // Try invite modal
  if (await clickText('Invite') || await clickText('Invite User') || await clickText('Add User')) {
    await shot(OUT, '18b-admin-invite', 800);
    await closeModal();
  }

  await goto('/admin/roles');
  await shot(OUT, '19-admin-roles');

  await goto('/admin/org');
  await shot(OUT, '20-admin-org');

  // ─── Onboarding wizard ──────────────────────────────────
  await goto('/onboarding');
  await shot(OUT, '21-onboarding');

  // ─── Save error log ─────────────────────────────────────
  fs.writeFileSync(path.join(OUT, '..', 'errors.log'), errors.join('\n') + '\n');
  console.log('\nTotal console errors / request failures:', errors.length);

  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
