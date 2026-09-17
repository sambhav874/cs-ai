#!/usr/bin/env node
/**
 * UX review walkthrough — end-user perspective.
 *
 * Runs through every major flow as a real user would, taking annotated
 * screenshots at each decision point. The script is intentionally
 * non-assertive (only logs observations) so we see what actually
 * happens rather than what the code thinks should happen.
 *
 * Groups:
 *   01–09  Arrival + navigation discovery
 *   10–19  Upload + detail + review
 *   20–29  Edit + palette + compare
 *   30–39  Approval + counterparty + signer
 *   40–49  Secondary pages (requests / templates / clauses / playbook)
 *   50–59  Admin + settings
 *   60–69  Responsive
 *   70–79  Session continuity
 *
 * Output: scripts/screenshots/ux-review/{nn}-{slug}.png + console log.
 */
import { chromium } from 'playwright';
import path from 'node:path'; import { fileURLToPath } from 'node:url'; import fs from 'node:fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'screenshots', 'ux-review');
fs.mkdirSync(OUT, { recursive: true });

const BASE = 'http://localhost:5173';
const note = (msg) => console.log('NOTE  ', msg);
const ok = (msg) => console.log('✓     ', msg);
const warn = (msg) => console.log('WARN  ', msg);
const head = (msg) => console.log(`\n━━━ ${msg} ━━━`);

async function shot(p, n, slug, opts = {}) {
  const name = `${String(n).padStart(2, '0')}-${slug}.png`;
  await p.screenshot({ path: path.join(OUT, name), fullPage: !!opts.full });
  return name;
}

async function safeText(p, sel, limit = 80) {
  try {
    const v = await p.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? '', sel);
    return (v ?? '').slice(0, limit);
  } catch { return ''; }
}

async function login(p, email = 'admin@demo.com', password = 'password123') {
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  // Clear any lingering coach-marks flag so first-time guide fires
  await p.evaluate(() => { try { localStorage.removeItem('clm.coach.contract-detail.v1'); } catch {} });
  await p.fill('input[type=email]', email);
  await p.fill('input[type=password]', password);
  await p.click('button[type=submit]');
  await p.waitForTimeout(1500);
}

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();

  // Record console errors as we go — any uncaught JS is a UX red flag.
  const jsErrors = [];
  p.on('pageerror', e => jsErrors.push(String(e).slice(0, 200)));
  p.on('console', m => {
    if (m.type() === 'error') jsErrors.push('console.error: ' + m.text().slice(0, 200));
  });

  // ══════════════════════════════════════════════════════════════════
  head('1. ARRIVAL (fresh visit, signed out)');
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await shot(p, 1, 'arrival');
  note(`Redirected to ${p.url()}`);
  const loginTitle = await safeText(p, 'h1, h2, h3');
  note(`Top heading: "${loginTitle}"`);
  const hasEmail = await p.$('input[type=email]'); const hasPw = await p.$('input[type=password]');
  note(`Email input present: ${!!hasEmail}  Password input present: ${!!hasPw}`);
  const registerLink = await p.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a, button')).find(x => /register|create|sign ?up/i.test(x.textContent || ''));
    return a?.textContent?.trim() ?? null;
  });
  note(`Register/sign-up link: ${registerLink ?? 'NONE'}`);

  // Check visible affordances — a new user should see: brand, email,
  // password, submit, forgot, register/sign-up.
  const affordances = await p.evaluate(() => {
    return {
      forgot:  !!Array.from(document.querySelectorAll('a, button')).find(x => /forgot|reset/i.test(x.textContent || '')),
      register: !!Array.from(document.querySelectorAll('a, button')).find(x => /register|sign ?up|create account/i.test(x.textContent || '')),
      submit:  !!document.querySelector('button[type=submit]'),
    };
  });
  note(`Affordances — Submit: ${affordances.submit}, Register: ${affordances.register}, Forgot password: ${affordances.forgot}`);

  // ══════════════════════════════════════════════════════════════════
  head('2. LOGIN + FIRST-LOAD');
  await login(p);
  await p.waitForTimeout(1200);
  await shot(p, 2, 'post-login');
  note(`Post-login URL: ${p.url()}`);
  const brand = await safeText(p, 'nav, aside, header', 200);
  note(`Nav brand snippet: "${brand}"`);

  // ══════════════════════════════════════════════════════════════════
  head('3. GLOBAL NAVIGATION — enumerate every menu item');
  const navItems = await p.evaluate(() => {
    const nav = document.querySelector('nav') || document.querySelector('aside');
    if (!nav) return [];
    return Array.from(nav.querySelectorAll('a')).map(a => ({
      label: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      href:  a.getAttribute('href'),
      active: a.getAttribute('aria-current') === 'page' || /active|bg-blue-|bg-indigo-/.test(a.className),
    })).filter(i => i.label && i.href);
  });
  note(`Nav items (${navItems.length}):`);
  navItems.forEach(i => console.log(`    ${i.active ? '▶' : ' '} ${i.label.padEnd(20)} → ${i.href}`));
  await shot(p, 3, 'dashboard-full', { full: true });

  // ══════════════════════════════════════════════════════════════════
  head('4. DASHBOARD — what does a user see first?');
  const dashInfo = await p.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    return {
      primaryCta:    Array.from(main.querySelectorAll('button, a')).filter(b => /^(Upload|New|Create|Start|Request|Draft)/i.test((b.textContent || '').trim())).map(b => b.textContent?.trim()).slice(0, 5),
      tiles:         Array.from(main.querySelectorAll('[class*="card"], [class*="tile"], .rounded-lg, .rounded-xl')).length,
      topHeading:    document.querySelector('h1')?.textContent?.trim(),
      visibleWords:  (main.textContent || '').replace(/\s+/g, ' ').slice(0, 300),
    };
  });
  note(`Dashboard heading: "${dashInfo.topHeading}"`);
  note(`Primary CTAs visible: ${JSON.stringify(dashInfo.primaryCta)}`);
  note(`Card-like tiles detected: ${dashInfo.tiles}`);
  note(`First 300 visible chars: "${dashInfo.visibleWords}"`);

  // ══════════════════════════════════════════════════════════════════
  head('5. CONTRACTS LIST');
  await p.click('a[href="/contracts"], a[href*="/contracts"]').catch(() => {});
  await p.waitForTimeout(1200);
  await shot(p, 5, 'contracts-list', { full: true });
  const listInfo = await p.evaluate(() => {
    const rows = document.querySelectorAll('.cursor-pointer, tr[class*="hover"], [class*="row"]');
    const upload = Array.from(document.querySelectorAll('button, a')).find(b => /Upload|New contract|Add contract/i.test(b.textContent || ''));
    const search = document.querySelector('input[type=search], input[placeholder*="Search" i]');
    const filters = Array.from(document.querySelectorAll('select, [role="combobox"]')).length;
    const emptyState = Array.from(document.querySelectorAll('*')).find(e => /no contracts|get started|empty/i.test(e.textContent || ''));
    return {
      rowCount: rows.length,
      hasUploadCta: !!upload,
      uploadLabel: upload?.textContent?.trim(),
      hasSearch: !!search,
      filterCount: filters,
      hasEmpty: !!emptyState,
    };
  });
  note(`Row count: ${listInfo.rowCount}`);
  note(`Upload CTA: ${listInfo.hasUploadCta ? `"${listInfo.uploadLabel}"` : 'NONE'}`);
  note(`Search input: ${listInfo.hasSearch}`);
  note(`Filter controls: ${listInfo.filterCount}`);

  // ══════════════════════════════════════════════════════════════════
  head('6. UPLOAD MODAL — click the upload CTA');
  const uploadClicked = await p.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button, a')).find(b => /Upload|New contract|Add/i.test(b.textContent || ''));
    btn?.click();
    return !!btn;
  });
  await p.waitForTimeout(800);
  await shot(p, 6, 'upload-modal');
  if (!uploadClicked) warn('Upload button not found on contracts list');
  else {
    const mod = await p.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"], [class*="Modal"], [class*="Dialog"]');
      if (!dlg) return { open: false };
      return {
        open: true,
        dropZone: !!dlg.querySelector('[class*="drop"], input[type=file]'),
        hasFileInput: !!dlg.querySelector('input[type=file]'),
        fieldLabels: Array.from(dlg.querySelectorAll('label')).map(l => l.textContent?.trim()).filter(Boolean).slice(0, 8),
      };
    });
    note(`Upload modal — open: ${mod.open}, drop zone: ${mod.dropZone}, file input: ${mod.hasFileInput}`);
    if (mod.fieldLabels?.length) note(`  Field labels: ${JSON.stringify(mod.fieldLabels)}`);
    await p.keyboard.press('Escape').catch(() => {});
    await p.waitForTimeout(300);
  }

  // ══════════════════════════════════════════════════════════════════
  head('7. OPEN AN EXISTING CONTRACT — detail page');
  await p.evaluate(() => {
    const r = Array.from(document.querySelectorAll('.cursor-pointer'))
      .find(r => r.textContent && r.textContent.includes('WPT Enterprises'));
    r?.click();
  });
  await p.waitForTimeout(3000);
  await shot(p, 7, 'detail-wpt', { full: true });
  const detail = await p.evaluate(() => {
    const h1 = document.querySelector('h1')?.textContent?.trim();
    const statusPill = Array.from(document.querySelectorAll('button, span')).find(b => /Draft|Review|Approval|Executed|Expired|Negotiation/i.test(b.textContent || ''))?.textContent?.trim();
    const railSections = Array.from(document.querySelectorAll('section span'))
      .filter(s => /^(Overview|Key Terms|Clauses|Risks|History|Comments|Activity|Approval|Precedents|Review progress|Risk Findings|Clause Flags)$/i.test((s.textContent || '').trim()))
      .map(s => s.textContent?.trim());
    const primaryCtas = Array.from(document.querySelectorAll('header button, .bg-white button')).map(b => b.textContent?.trim()).filter(x => x && x.length < 30).slice(0, 12);
    return {
      title: h1,
      statusPill,
      railSections,
      primaryCtas,
      hasCanvas: !!document.querySelector('article.document-canvas'),
      riskMarkers: document.querySelectorAll('.risk-marker').length,
    };
  });
  note(`Title: "${detail.title}"`);
  note(`Status pill: "${detail.statusPill}"`);
  note(`Canvas rendered: ${detail.hasCanvas}  Risk markers: ${detail.riskMarkers}`);
  note(`Rail sections: ${JSON.stringify(detail.railSections)}`);
  note(`Header CTAs: ${JSON.stringify(detail.primaryCtas)}`);

  // Coach marks — first visit should trigger
  const coach = await p.evaluate(() => {
    const d = document.querySelector('div[role="dialog"][aria-label="Getting started"]');
    return { open: !!d, title: d?.querySelector('h2')?.textContent ?? '' };
  });
  if (coach.open) {
    note(`Coach-marks showing: "${coach.title}"`);
    await shot(p, 8, 'detail-coach-marks');
    // Dismiss so subsequent screens are clean
    await p.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /Got it|Close/i.test(b.textContent || ''));
      btn?.click();
    });
    await p.waitForTimeout(200);
  }

  // ══════════════════════════════════════════════════════════════════
  head('8. ⌘K AI PALETTE + Q&A');
  await p.keyboard.press('Meta+K');
  await p.waitForTimeout(400);
  await shot(p, 9, 'palette-open');
  const palette = await p.evaluate(() => {
    const dlg = document.querySelector('div[role="dialog"][aria-label="Ask AI"]');
    return {
      open: !!dlg,
      suggestions: Array.from(dlg?.querySelectorAll('button') ?? []).slice(0, 6).map(b => b.textContent?.trim()),
      placeholder: dlg?.querySelector('input')?.getAttribute('placeholder') ?? '',
    };
  });
  note(`Palette open: ${palette.open}`);
  note(`Placeholder: "${palette.placeholder}"`);
  note(`Suggestions: ${JSON.stringify(palette.suggestions)}`);
  // Type a natural-language question
  await p.fill('div[role="dialog"][aria-label="Ask AI"] input', 'Summarize the top risks in plain English.');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => {
    const dlg = document.querySelector('div[role="dialog"][aria-label="Ask AI"]');
    const t = dlg?.textContent || '';
    return !/Thinking/.test(t) && /risk|clause|indemn|liab/i.test(t);
  }, { timeout: 30000 }).catch(() => null);
  await shot(p, 10, 'palette-answer');
  const answer = await p.evaluate(() => {
    const dlg = document.querySelector('div[role="dialog"][aria-label="Ask AI"]');
    const para = dlg?.querySelector('p');
    return {
      preview: (para?.textContent || '').slice(0, 180),
      hasSources: /Sources/.test(dlg?.textContent ?? ''),
    };
  });
  note(`Answer preview: "${answer.preview}"`);
  note(`Grounded sources: ${answer.hasSources}`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  // ══════════════════════════════════════════════════════════════════
  head('9. EDIT MODE — bubble menu + save cycle');
  const editBtn = await p.$('button[title^="Edit this document"]');
  if (editBtn) {
    await editBtn.click();
    await p.waitForTimeout(800);
    await shot(p, 11, 'edit-mode');
    const editInfo = await p.evaluate(() => {
      const pm = document.querySelector('article.document-canvas .ProseMirror');
      return {
        editable: pm?.getAttribute('contenteditable') === 'true',
        saveBadge: Array.from(document.querySelectorAll('span')).find(s => /Saving|Saved|Unsaved|Save failed/.test(s.textContent || ''))?.textContent?.trim(),
        hasUndo: !!document.querySelector('button[title*="Undo"]'),
        hasRedo: !!document.querySelector('button[title*="Redo"]'),
        hasDone: !!Array.from(document.querySelectorAll('button')).find(b => /^Done$/.test((b.textContent || '').trim())),
      };
    });
    note(`Editable: ${editInfo.editable}  Undo: ${editInfo.hasUndo}  Redo: ${editInfo.hasRedo}  Done button: ${editInfo.hasDone}`);
    note(`Save badge: "${editInfo.saveBadge ?? ''}"`);
    // Select → bubble menu
    await p.click('article.document-canvas .ProseMirror p', { clickCount: 3 });
    await p.waitForTimeout(400);
    await shot(p, 12, 'edit-bubble-menu');
    const bubble = await p.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return {
        Bold: btns.some(b => /Bold/.test(b.getAttribute('title') || '')),
        Italic: btns.some(b => /Italic/.test(b.getAttribute('title') || '')),
        Underline: btns.some(b => /Underline/.test(b.getAttribute('title') || '')),
        H2: btns.some(b => /Heading 2/.test(b.getAttribute('title') || '')),
        AI: btns.some(b => /Ask AI about this selection/.test(b.getAttribute('title') || '')),
      };
    });
    note(`Bubble menu buttons: ${JSON.stringify(bubble)}`);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
  } else warn('No Edit button found in header');

  // ══════════════════════════════════════════════════════════════════
  head('10. COMPARE VERSIONS mode');
  const cmpBtn = await p.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /^\s*Compare\s*$/.test(b.textContent || ''));
    if (btn) { btn.click(); return true; }
    return false;
  });
  await p.waitForTimeout(900);
  if (cmpBtn) {
    await shot(p, 13, 'compare-mode');
    const cmp = await p.evaluate(() => {
      const dlg = document.querySelector('div[role="dialog"][aria-label="Compare versions"]');
      if (!dlg) return { open: false };
      return {
        open: true,
        pickers: dlg.querySelectorAll('select').length,
        filters: Array.from(dlg.querySelectorAll('button')).filter(b => /^(all|theirs|ours|pending)$/i.test((b.textContent || '').trim())).length,
        statsVisible: /added|removed/i.test(dlg.textContent || ''),
      };
    });
    note(`Compare dialog — open: ${cmp.open}, pickers: ${cmp.pickers}, filters: ${cmp.filters}, stats: ${cmp.statsVisible}`);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
  } else note('Compare button not present on this contract (needs ≥2 versions)');

  // ══════════════════════════════════════════════════════════════════
  head('11. FOCUSED REVIEW DRAWER — click a risk marker');
  const markerClicked = await p.evaluate(() => {
    const m = document.querySelector('.risk-marker');
    if (m) { m.click(); return true; }
    return false;
  });
  await p.waitForTimeout(700);
  if (markerClicked) {
    await shot(p, 14, 'focused-review');
    const drawer = await p.evaluate(() => {
      // Focused drawer replaces the rail with a scrollable detail view.
      const bodyText = document.body.textContent || '';
      return {
        whyPresent: /WHY THIS MATTERS|Why this/i.test(bodyText),
        suggestionPresent: /AI SUGGESTION|AI suggestion/i.test(bodyText),
        hasAccept: !!Array.from(document.querySelectorAll('button')).find(b => /^\s*Accept/i.test(b.textContent || '')),
        hasReject: !!Array.from(document.querySelectorAll('button')).find(b => /^\s*Reject/i.test(b.textContent || '')),
      };
    });
    note(`Drawer — WHY: ${drawer.whyPresent}, SUGGESTION: ${drawer.suggestionPresent}, Accept: ${drawer.hasAccept}, Reject: ${drawer.hasReject}`);
  } else note('No risk marker to click on this contract');

  // ══════════════════════════════════════════════════════════════════
  head('12. NAVIGATE TO OTHER PAGES');
  const pages = [
    { href: '/requests',       slug: '20-requests' },
    { href: '/counterparties', slug: '21-counterparties' },
    { href: '/templates',      slug: '22-templates' },
    { href: '/clauses',        slug: '23-clauses' },
    { href: '/playbook',       slug: '24-playbook' },
    { href: '/approvals',      slug: '25-approvals' },
    { href: '/signatures',     slug: '26-signatures' },
    { href: '/analytics',      slug: '27-analytics' },
    { href: '/team',           slug: '28-team' },
    { href: '/admin/users',    slug: '29-admin-users' },
    { href: '/admin/roles',    slug: '30-admin-roles' },
    { href: '/admin/org',      slug: '31-admin-org' },
    { href: '/settings',       slug: '32-settings' },
    { href: '/profile',        slug: '33-profile' },
  ];
  for (const pg of pages) {
    try {
      await p.goto(BASE + pg.href, { waitUntil: 'networkidle' });
      await p.waitForTimeout(900);
      const name = await shot(p, parseInt(pg.slug.split('-')[0], 10), pg.slug.split('-').slice(1).join('-'), { full: true });
      const info = await p.evaluate(() => {
        const h1 = document.querySelector('h1')?.textContent?.trim();
        const ctas = Array.from(document.querySelectorAll('main button, main a[href]')).filter(b =>
          (b.textContent || '').trim() && (b.textContent || '').trim().length < 30
        ).slice(0, 8).map(b => b.textContent?.trim());
        const emptyHints = /empty|no data|get started|no items|nothing here|coming soon/i.test(document.body.textContent || '');
        const errorHints = /error|failed|forbidden|unauthorized/i.test(document.body.textContent || '');
        return { h1, ctas, emptyHints, errorHints, hasContent: (document.body.textContent || '').length > 200 };
      });
      note(`${pg.href.padEnd(22)} → h1: "${info.h1}" ${info.emptyHints ? '[empty]' : ''}${info.errorHints ? '[ERROR]' : ''}`);
      if (info.ctas?.length) note(`    ctas: ${JSON.stringify(info.ctas)}`);
      if (!info.hasContent) warn(`    Very little content — possible empty state or error`);
    } catch (e) {
      warn(`${pg.href} → ERROR: ${e.message.slice(0, 100)}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  head('13. RESPONSIVE — tablet 1024×768');
  const ctx2 = await b.newContext({ viewport: { width: 1024, height: 768 } });
  const p2 = await ctx2.newPage();
  await login(p2);
  await p2.goto(BASE + '/contracts/cmn16g4xf001sdew25oas8dcy', { waitUntil: 'networkidle' });
  await p2.waitForTimeout(2500);
  await shot(p2, 40, 'tablet-detail');
  const tablet = await p2.evaluate(() => {
    const trig = document.querySelector('button[aria-label="Open details rail"]');
    const aside = document.querySelector('aside[aria-label="Contract rail"]');
    return { trigger: !!trig, aside: !!aside, asideOnScreen: aside && aside.getBoundingClientRect().right > 0 && aside.getBoundingClientRect().left < window.innerWidth && aside.getBoundingClientRect().width > 50 };
  });
  note(`Tablet — trigger pill: ${tablet.trigger}, aside off-screen: ${!tablet.asideOnScreen}`);
  await ctx2.close();

  head('14. RESPONSIVE — mobile 375×812');
  const ctx3 = await b.newContext({ viewport: { width: 375, height: 812 } });
  const p3 = await ctx3.newPage();
  await login(p3);
  await p3.goto(BASE + '/contracts/cmn16g4xf001sdew25oas8dcy', { waitUntil: 'networkidle' });
  await p3.waitForTimeout(2500);
  await shot(p3, 41, 'mobile-detail');
  // Attempt to read the main nav on mobile — is there a hamburger?
  const mob = await p3.evaluate(() => {
    const nav = document.querySelector('nav, aside');
    const sidebarVisible = nav && nav.getBoundingClientRect().width > 50 && nav.getBoundingClientRect().left >= 0;
    const hasHamburger = !!Array.from(document.querySelectorAll('button')).find(b => /menu|^\s*☰/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')));
    const peek = document.querySelector('aside[aria-label="Contract rail"]');
    return {
      sidebarVisible,
      hasHamburger,
      peekHeight: peek?.getBoundingClientRect().height ?? 0,
    };
  });
  note(`Mobile — sidebar visible: ${mob.sidebarVisible}, hamburger menu: ${mob.hasHamburger}, rail peek height: ${mob.peekHeight}px`);
  await ctx3.close();

  // ══════════════════════════════════════════════════════════════════
  head('15. SESSION — sign out + back in');
  // Locate a "Sign out" or "Log out" or profile dropdown
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const logoutInfo = await p.evaluate(() => {
    const profileBtn = Array.from(document.querySelectorAll('button, a')).find(b => /admin user|profile|account|avatar/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')));
    const visible = !!profileBtn;
    if (profileBtn) profileBtn.click();
    return { visible };
  });
  await p.waitForTimeout(500);
  await shot(p, 50, 'profile-menu');
  const logout = await p.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button, a')).find(b => /sign out|log ?out|logout/i.test(b.textContent || ''));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await p.waitForTimeout(1500);
  await shot(p, 51, 'post-logout');
  note(`Logout click reached: ${logout}  URL after: ${p.url()}`);

  // ══════════════════════════════════════════════════════════════════
  head('COMPLETE. JavaScript errors captured during run:');
  if (jsErrors.length === 0) ok('None');
  else jsErrors.slice(0, 30).forEach(e => console.log(' !  ' + e));

  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
