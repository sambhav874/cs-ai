#!/usr/bin/env node
// F5 review shots: 3 contracts at 3 viewports.
import { chromium } from 'playwright';
import path from 'node:path'; import { fileURLToPath } from 'node:url'; import fs from 'node:fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'screenshots', 'desktop');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5173';
(async () => {
  const b = await chromium.launch({ headless: true });
  for (const [vw, vh, tag] of [[1440, 900, 'desktop'], [1280, 800, 'laptop'], [1024, 768, 'tablet']]) {
    const c = await b.newContext({ viewport: { width: vw, height: vh } });
    const p = await c.newPage();
    await p.goto(BASE + '/', { waitUntil: 'networkidle' });
    await p.fill('input[type="email"]', 'admin@demo.com');
    await p.fill('input[type="password"]', 'password123');
    await p.click('button[type="submit"]');
    await p.waitForTimeout(1500);
    await p.goto(BASE + '/contracts', { waitUntil: 'networkidle' });
    await p.waitForTimeout(500);
    await p.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.cursor-pointer')).find(r => r.textContent?.includes('iPass Inc.'));
      if (row) row.click();
    });
    await p.waitForTimeout(2500);
    const shot = path.join(OUT, `34-f5-${tag}-${vw}.png`);
    await p.screenshot({ path: shot });
    console.log('✓', path.relative(path.join(__dirname, '..'), shot));
    await c.close();
  }
  await b.close();
})();
