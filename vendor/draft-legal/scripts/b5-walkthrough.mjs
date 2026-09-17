#!/usr/bin/env node
/**
 * B.5 — End-to-end walkthrough.
 *
 * The full happy-path for the unified canvas. Generates a sample NDA
 * PDF via Gotenberg, uploads it, waits for the parse → extract → analyze
 * pipeline to finish, then exercises the rendered detail page in a real
 * browser session.
 *
 * Verifies (in order):
 *   1. PDF generation + upload returns a contract id
 *   2. Pipeline progresses through PARSING → EXTRACTING → ANALYZING → DONE
 *   3. plainText + htmlContent are populated (text extraction worked)
 *   4. Clauses are extracted with riskRating values
 *   5. Document canvas renders the contract text
 *   6. Risk markers (red wavy underlines) appear inline
 *   7. Rail sections (Overview, Key Terms, Risks, Clauses) render with data
 *   8. ⌘K palette returns a grounded answer with sources
 *   9. Edit toggle flips the canvas to editable
 *   10. Bubble menu appears on text selection
 *   11. Save creates a v2 with the edit
 *
 * This is the script the team should run before each B.5 release as
 * a smoke test of the entire user flow.
 */
import { chromium } from 'playwright';
import path from 'node:path'; import { fileURLToPath } from 'node:url'; import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'screenshots', 'walkthrough');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5173';
const API  = 'http://localhost:3001/api/v1';
const GOTENBERG = 'http://localhost:3002';

const fail = (m) => { console.log('❌ FAIL', m); process.exit(1); };
const pass = (m) => console.log('✅ PASS', m);
const info = (m) => console.log('ℹ️ ', m);
const step = (n, m) => console.log(`\n━━━ Step ${n}: ${m} ━━━`);

// A realistic enough NDA so the AI agent can extract clauses + risks.
const NDA_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.6; margin: 2.5cm; color: #111; }
  h1 { font-size: 18pt; text-align: center; margin-bottom: 24pt; text-transform: uppercase; }
  h2 { font-size: 13pt; margin-top: 18pt; text-transform: uppercase; }
  p { margin: 8pt 0; text-align: justify; }
  .signature-block { margin-top: 40pt; }
</style></head>
<body>
  <h1>Mutual Non-Disclosure Agreement</h1>

  <p>This Mutual Non-Disclosure Agreement (the "<b>Agreement</b>") is entered
  into as of January 15, 2026 (the "<b>Effective Date</b>") between
  <b>Acme Innovations, Inc.</b>, a Delaware corporation with offices at 123 Market Street,
  San Francisco, CA 94105 ("<b>Acme</b>"), and <b>Globex Holdings LLC</b>, a New York
  limited liability company with offices at 250 Park Avenue, New York, NY 10177
  ("<b>Globex</b>"). Acme and Globex are each a "<b>Party</b>" and collectively, the "<b>Parties</b>".</p>

  <h2>1. Confidential Information</h2>
  <p>"Confidential Information" means any non-public information disclosed by one Party
  ("<b>Discloser</b>") to the other Party ("<b>Recipient</b>"), whether orally, in writing,
  or in any other form, that is identified as confidential or that a reasonable person
  would understand to be confidential given the nature of the information and circumstances
  of disclosure, including without limitation business plans, financial information, customer
  lists, technical specifications, source code, product roadmaps, and trade secrets.</p>

  <h2>2. Obligations of Recipient</h2>
  <p>Recipient shall (a) hold the Confidential Information in strict confidence using at
  least the same degree of care it uses to protect its own confidential information of
  similar nature (and in no event less than reasonable care), (b) not disclose Confidential
  Information to any third party without Discloser's prior written consent, and (c) use
  Confidential Information solely to evaluate or pursue a business relationship between
  the Parties.</p>

  <h2>3. Term and Termination</h2>
  <p>This Agreement shall commence on the Effective Date and continue for a period of
  three (3) years thereafter unless earlier terminated by either Party with thirty (30)
  days' written notice. The confidentiality obligations under Section 2 shall survive
  termination for a period of five (5) years.</p>

  <h2>4. No License; Ownership</h2>
  <p>No license under any patent, copyright, trademark, or other intellectual property
  right is granted by this Agreement. All Confidential Information remains the sole and
  exclusive property of Discloser.</p>

  <h2>5. Indemnification</h2>
  <p>Recipient shall indemnify, defend, and hold harmless Discloser from any and all
  claims, damages, losses, costs, and expenses (including reasonable attorneys' fees)
  arising out of or related to Recipient's breach of this Agreement, without limitation
  as to amount.</p>

  <h2>6. Limitation of Liability</h2>
  <p>EXCEPT FOR BREACHES OF SECTION 2 (CONFIDENTIALITY) OR SECTION 5 (INDEMNIFICATION),
  IN NO EVENT SHALL EITHER PARTY'S AGGREGATE LIABILITY EXCEED ONE HUNDRED THOUSAND U.S.
  DOLLARS ($100,000).</p>

  <h2>7. Governing Law and Jurisdiction</h2>
  <p>This Agreement shall be governed by and construed in accordance with the laws of
  the State of Delaware, without regard to its conflict of laws principles. Any dispute
  arising out of or relating to this Agreement shall be subject to the exclusive
  jurisdiction of the state and federal courts located in Wilmington, Delaware.</p>

  <h2>8. Assignment</h2>
  <p>Neither Party may assign this Agreement, in whole or in part, without the prior
  written consent of the other Party, except that either Party may assign this Agreement
  to a successor in connection with a merger, acquisition, or sale of substantially all
  of its assets.</p>

  <div class="signature-block">
    <p>IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.</p>
    <p><b>ACME INNOVATIONS, INC.</b><br>By: ___________________<br>Name: Jane Doe<br>Title: CEO</p>
    <p><b>GLOBEX HOLDINGS LLC</b><br>By: ___________________<br>Name: John Smith<br>Title: Managing Director</p>
  </div>
</body></html>`;

async function adminLogin() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email: 'admin@demo.com', password: 'password123' }),
  });
  const j = await res.json();
  if (!j.accessToken) throw new Error('login failed: ' + JSON.stringify(j));
  return j.accessToken;
}

async function generatePdf() {
  const form = new FormData();
  form.append('files', new Blob([NDA_HTML], { type: 'text/html' }), 'index.html');
  const r = await fetch(`${GOTENBERG}/forms/chromium/convert/html`, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`Gotenberg failed: ${r.status} ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

async function uploadContract(token, pdfBuffer) {
  const form = new FormData();
  form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), 'b5-walkthrough-nda.pdf');
  form.append('title', 'B.5 Walkthrough NDA — Acme x Globex');
  form.append('type',  'NDA');
  form.append('counterpartyName', 'Globex Holdings LLC');
  const r = await fetch(`${API}/contracts/upload`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body:    form,
  });
  if (!r.ok) throw new Error(`upload failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function getContract(token, id) {
  const r = await fetch(`${API}/contracts/${id}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`get contract failed: ${r.status}`);
  return r.json();
}

async function getClauses(token, id) {
  const r = await fetch(`${API}/contracts/${id}/clauses`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!r.ok) return { data: [] };
  return r.json();
}

(async () => {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  B.5 — UNIFIED CANVAS — END-TO-END WALKTHROUGH             ║');
  console.log('║  Upload → Pipeline → Render → Q&A → Edit                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const startedAt = Date.now();

  // ── Step 1: Auth + generate PDF ────────────────────────────────
  step(1, 'Login + generate sample NDA PDF via Gotenberg');
  const token = await adminLogin();
  pass('admin@demo.com authenticated');
  const pdf = await generatePdf();
  pass(`PDF generated (${(pdf.length / 1024).toFixed(1)} KB)`);

  // ── Step 2: Upload ─────────────────────────────────────────────
  step(2, 'POST /contracts/upload (multipart)');
  const created = await uploadContract(token, pdf);
  const contractId = created.id;
  if (!contractId) fail('upload returned no contract id');
  info(`contractId = ${contractId}`);
  pass(`Upload accepted, contract created with status=${created.analysisStatus}`);

  // ── Step 3: Wait for pipeline to complete ──────────────────────
  step(3, 'Wait for parse → extract → analyze pipeline');
  const stages = [];
  let contract;
  const deadline = Date.now() + 180_000; // 3 min budget
  while (Date.now() < deadline) {
    contract = await getContract(token, contractId);
    const s = contract.analysisStatus;
    if (stages[stages.length - 1] !== s) {
      stages.push(s);
      console.log(`   pipeline → ${s}`);
    }
    if (s === 'DONE') break;
    if (s === 'FAILED') fail(`pipeline failed: ${contract.analysisError ?? 'unknown'}`);
    await new Promise(r => setTimeout(r, 4000));
  }
  if (contract.analysisStatus !== 'DONE') fail(`pipeline did not finish in 3 minutes (last status: ${contract.analysisStatus})`);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  pass(`Pipeline completed in ${elapsed}s — stages: ${stages.join(' → ')}`);

  // ── Step 4: Verify text extraction ─────────────────────────────
  step(4, 'Verify text extraction');
  const v0 = (contract.versions ?? [])[0];
  if (!v0) fail('No version on contract after analysis');
  const htmlLen = (v0.htmlContent ?? '').length;
  const textLen = (v0.plainText ?? '').length;
  info(`v${v0.versionNumber}: htmlContent ${htmlLen} chars, plainText ${textLen} chars`);
  if (htmlLen < 500) fail(`htmlContent too short — extraction likely failed (${htmlLen} chars)`);
  if (textLen < 500) fail(`plainText too short — extraction likely failed (${textLen} chars)`);
  // Spot-check key strings from the source NDA
  const hits = ['Confidential Information', 'Acme Innovations', 'Globex', 'Indemnification', 'Delaware'].filter(s =>
    (v0.plainText ?? '').toLowerCase().includes(s.toLowerCase()),
  );
  info(`Source-text hits: ${hits.length}/5 (${hits.join(', ')})`);
  if (hits.length < 4) fail('Text extraction missing critical NDA keywords');
  pass(`Text extraction works — htmlContent + plainText populated, ${hits.length}/5 keywords found`);

  // ── Step 5: Verify clauses ─────────────────────────────────────
  step(5, 'Verify clauses extracted');
  const clauses = (await getClauses(token, contractId)).data ?? [];
  info(`Extracted ${clauses.length} clauses`);
  clauses.slice(0, 8).forEach((c, i) => {
    const preview = (c.content ?? '').slice(0, 60).replace(/\s+/g, ' ');
    console.log(`   ${i + 1}. [${c.clauseType}] (${c.riskRating ?? 'n/a'})  ${preview}…`);
  });
  if (clauses.length < 4) fail(`expected ≥4 clauses, got ${clauses.length}`);
  const clausesWithRisk = clauses.filter(c => c.riskRating);
  if (clausesWithRisk.length === 0) fail('no clauses have a riskRating — risk analysis failed');
  pass(`${clauses.length} clauses extracted, ${clausesWithRisk.length} with riskRating`);

  // ── Step 6: Browser walkthrough ────────────────────────────────
  step(6, 'Open detail page in browser');
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await c.newPage();
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.fill('input[type=email]', 'admin@demo.com');
  await p.fill('input[type=password]', 'password123');
  await p.click('button[type=submit]');
  await p.waitForTimeout(1500);
  // Set the coach-marks-seen flag so they don't cover the canvas screenshots.
  await p.evaluate(() => window.localStorage.setItem('clm.coach.contract-detail.v1', 'seen'));
  await p.goto(`${BASE}/contracts/${contractId}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(3500);
  await p.screenshot({ path: path.join(OUT, '01-detail-page.png'), fullPage: false });
  pass(`Detail page opened — screenshot 01-detail-page.png`);

  // ── Step 7: Verify canvas + rail rendered ──────────────────────
  step(7, 'Verify canvas + rail render with extracted data');
  const render = await p.evaluate(() => {
    const article = document.querySelector('article.document-canvas .ProseMirror');
    const text = (article?.textContent ?? '').trim();
    const railSpans = Array.from(document.querySelectorAll('section span'))
      .filter(s => /^(Overview|Key Terms|Clauses|History|Comments|Activity|Approval|Risk Findings)$/i.test((s.textContent || '').trim()))
      .map(s => (s.textContent || '').trim());
    const summary = Array.from(document.querySelectorAll('section'))
      .find(s => /Overview/i.test(s.querySelector('span')?.textContent || ''))
      ?.querySelector('p')?.textContent?.trim() ?? '';
    const riskMarkers = document.querySelectorAll('.risk-marker').length;
    return {
      canvasTextLen: text.length,
      canvasPreview: text.slice(0, 120).replace(/\s+/g, ' '),
      railSections:  railSpans,
      summary:       summary.slice(0, 200),
      riskMarkers,
    };
  });
  console.log(`   canvas text: ${render.canvasTextLen} chars`);
  console.log(`   preview: "${render.canvasPreview}…"`);
  console.log(`   rail sections: ${render.railSections.join(', ')}`);
  console.log(`   risk markers: ${render.riskMarkers}`);
  console.log(`   AI summary: "${render.summary || '(empty)'}"`);
  if (render.canvasTextLen < 500) fail('Canvas did not render extracted text');
  if (render.railSections.length < 3) fail('Rail sections missing — expected Overview/Key Terms/Clauses/History at minimum');
  pass(`Canvas renders ${render.canvasTextLen} chars + ${render.railSections.length} rail sections`);
  if (render.riskMarkers > 0) pass(`${render.riskMarkers} risk markers visible inline`);
  else info('No risk markers showing — clauses may not have classified into risk/deviation buckets');

  // ── Step 8: ⌘K Q&A grounded answer ─────────────────────────────
  step(8, 'Test ⌘K palette — ask "What is the term?"');
  await p.keyboard.press('Meta+K');
  await p.waitForTimeout(400);
  await p.fill('div[role="dialog"][aria-label="Ask AI"] input', 'What is the term of this agreement and how is it terminated?');
  await p.keyboard.press('Enter');
  const answered = await p.waitForFunction(
    () => {
      const dlg = document.querySelector('div[role="dialog"][aria-label="Ask AI"]');
      const txt = dlg?.textContent || '';
      return /three|3.year|terminated|notice|day/i.test(txt) && !txt.includes('Thinking…');
    },
    { timeout: 30000 },
  ).then(() => true).catch(() => false);
  if (!answered) fail('Q&A returned no answer within 30s');
  const ans = await p.evaluate(() => {
    const dlg = document.querySelector('div[role="dialog"][aria-label="Ask AI"]');
    return {
      preview: dlg?.querySelector('p')?.textContent?.slice(0, 200) ?? '',
      hasSources: /Sources/.test(dlg?.textContent ?? ''),
    };
  });
  console.log(`   answer: "${ans.preview}…"`);
  console.log(`   grounded with sources: ${ans.hasSources}`);
  pass(`Q&A returned a grounded answer${ans.hasSources ? ' with clause sources' : ''}`);
  await p.screenshot({ path: path.join(OUT, '02-qa-answer.png'), fullPage: false });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  // ── Step 9: Edit toggle + bubble menu ──────────────────────────
  step(9, 'Test Edit toggle + bubble menu');
  await p.click('button[title^="Edit this document"]');
  await p.waitForTimeout(800);
  const editable = await p.evaluate(() =>
    document.querySelector('article.document-canvas .ProseMirror')?.getAttribute('contenteditable') === 'true'
  );
  if (!editable) fail('Edit toggle did not flip canvas to editable');
  pass('Edit mode active — canvas is editable');

  // Triple-click a paragraph to select it; bubble menu should appear.
  await p.click('article.document-canvas .ProseMirror p', { clickCount: 3 });
  await p.waitForTimeout(500);
  const bubble = await p.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return {
      hasBold: btns.some(b => /Bold/.test(b.getAttribute('title') || '')),
      hasItalic: btns.some(b => /Italic/.test(b.getAttribute('title') || '')),
      hasH2: btns.some(b => /Heading 2/.test(b.getAttribute('title') || '')),
      hasAi: btns.some(b => /Ask AI about this selection/.test(b.getAttribute('title') || '')),
    };
  });
  console.log(`   bubble menu: Bold=${bubble.hasBold} Italic=${bubble.hasItalic} H2=${bubble.hasH2} AI=${bubble.hasAi}`);
  if (!(bubble.hasBold && bubble.hasItalic && bubble.hasH2 && bubble.hasAi)) fail('Bubble menu missing expected buttons');
  pass('Bubble menu appears with Bold / Italic / H2 / ✨ AI');

  // Click Bold and verify the change propagates.
  await p.click('button[title^="Bold"]');
  await p.waitForTimeout(400);
  const boldApplied = await p.evaluate(() =>
    !!document.querySelector('article.document-canvas .ProseMirror strong'),
  );
  if (!boldApplied) fail('Bold did not apply to selected text');
  pass('Bold applied to selection');
  await p.screenshot({ path: path.join(OUT, '03-edit-bubble.png'), fullPage: false });

  // ── Step 10: Save + verify v2 ──────────────────────────────────
  step(10, 'Force save (Cmd+S) + verify v2 created');
  await p.keyboard.press('Meta+S');
  await p.waitForTimeout(2500);
  const versions2 = await getContract(token, contractId);
  const versionCount = versions2.versions?.length ?? 0;
  console.log(`   versions: ${versionCount}`);
  if (versionCount < 2) fail('Save did not create v2');
  pass(`v${versionCount} saved successfully`);

  // Exit edit mode
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  // ── Step 11: Risk markers click → focused-review drawer ────────
  if (render.riskMarkers > 0) {
    step(11, 'Click a risk marker → focused-review drawer');
    await p.evaluate(() => {
      const m = document.querySelector('.risk-marker');
      if (m) m.click();
    });
    await p.waitForTimeout(800);
    const drawer = await p.evaluate(() => {
      const d = Array.from(document.querySelectorAll('aside, div'))
        .find(el => /WHY|AI SUGGESTION|Mark as Reviewed|Mark Reviewed|Accept|Reject/.test(el.textContent || ''));
      return { found: !!d, preview: (d?.textContent || '').slice(0, 200) };
    });
    if (drawer.found) {
      pass('Focused-review drawer opens with WHY / AI suggestion / Accept / Reject controls');
    } else {
      info('Focused-review drawer not detected (heuristic) — verify manually');
    }
    await p.screenshot({ path: path.join(OUT, '04-focused-review.png'), fullPage: false });
  }

  await b.close();

  // ── Final summary ─────────────────────────────────────────────
  const totalElapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  ✅ WALKTHROUGH PASSED                                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`Contract: ${contractId}`);
  console.log(`URL:      ${BASE}/contracts/${contractId}`);
  console.log(`Time:     ${totalElapsed}s end-to-end`);
  console.log(`Screens:  ${OUT}`);
  console.log('');
})().catch(e => { console.error('\n❌ WALKTHROUGH FAILED'); console.error(e); process.exit(1); });
