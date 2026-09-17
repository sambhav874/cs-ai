#!/usr/bin/env node
/**
 * Wave E user-journey screenshot — shows the contract detail page for a
 * seeded fixture contract after the full extraction pipeline ran. This
 * is the proof that the Wave E fixes landed visibly, not just in DB.
 *
 * Pre-req: audit-contract-ai.mjs has been run (so AUDIT: contracts exist
 * with populated summary / key terms / risk / clauses).
 */
import path from 'node:path'
import { REPO_ROOT } from './lib/repo-root.mjs'
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const SHOTS = path.join(REPO_ROOT, 'scripts/screenshots/desktop')
const FIXTURES = path.join(REPO_ROOT, 'apps/api/scripts/fixtures/ai-demo')

function esc(s) { return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])) }
function plainToHtml(text, title) {
  return `<h1>${esc(title)}</h1>\n` + text.split(/\n\s*\n/).map(p =>
    `<p>${esc(p).replace(/\n/g, '<br />')}</p>`).join('\n')
}
async function renderPdf(html) {
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: Georgia, serif; font-size: 12pt; line-height: 1.6; margin: 2.5cm; }
  </style></head><body>${html}</body></html>`
  for (let i = 1; i <= 5; i++) {
    const fd = new FormData()
    fd.append('files', new Blob([fullHtml], { type: 'text/html' }), 'index.html')
    try {
      const r = await fetch('http://localhost:3002/forms/chromium/convert/html', { method: 'POST', body: fd })
      if (r.ok) return Buffer.from(await r.arrayBuffer())
    } catch {}
    await new Promise(ok => setTimeout(ok, 1000 * i))
  }
  throw new Error('gotenberg failed')
}
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('dialog', d => d.accept().catch(() => {}))

  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', 'admin@demo.com')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 15_000 })

  const token = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('clm-auth') ?? '{}').state?.accessToken ?? null }
    catch { return null }
  })

  // Find the Acme MSA from the audit uploads — it's the richest fixture
  const list = await fetch('http://localhost:3001/api/v1/contracts?page=1&pageSize=50', {
    headers: { authorization: `Bearer ${token}` },
  }).then(r => r.json())
  const contracts = list?.contracts ?? list?.data ?? []
  // Try an existing AUDIT upload first; if none, upload one fresh via the
  // real /upload endpoint so the extraction pipeline runs end-to-end.
  let msa = contracts.find(c => /^AUDIT:.*Acme.*MSA/i.test(c.title ?? ''))
  if (!msa) {
    console.log('No AUDIT Acme MSA; uploading one fresh…')
    const text = readFileSync(`${FIXTURES}/msa-acme.txt`, 'utf-8')
    const pdf = await renderPdf(plainToHtml(text, 'AUDIT: Acme Corp — MSA'))
    const fd = new FormData()
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'msa-acme.pdf')
    fd.append('title', 'AUDIT: Acme Corp — MSA (demo)')
    fd.append('type', 'MSA')
    fd.append('counterpartyName', 'Acme Corporation')
    const uploadRes = await fetch('http://localhost:3001/api/v1/contracts/upload', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: fd,
    })
    if (!uploadRes.ok) { console.error('upload failed', uploadRes.status, await uploadRes.text()); process.exit(1) }
    const created = await uploadRes.json()
    msa = created
    // Poll until DONE
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      const r = await fetch(`http://localhost:3001/api/v1/contracts/${msa.id}`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (r.ok) {
        const j = await r.json()
        if (j.analysisStatus === 'DONE' || j.analysisStatus === 'FAILED') break
      }
      await new Promise(ok => setTimeout(ok, 3000))
    }
    console.log(`extraction pipeline finished for ${msa.id}`)
  }
  console.log(`using contract: ${msa.title} (${msa.id})`)

  await page.goto(`http://localhost:5173/contracts/${msa.id}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  // Dismiss any coach-mark
  const coach = page.locator('button:has-text("Got it"), button[aria-label*="close" i], button:has-text("Dismiss")').first()
  if (await coach.isVisible().catch(() => false)) await coach.click().catch(() => {})

  await page.screenshot({ path: `${SHOTS}/77-wave-e-populated-contract.png`, fullPage: false })
  console.log(`✓ saved ${SHOTS}/77-wave-e-populated-contract.png`)

  // Also grab the clauses drawer if the rail side can be expanded
  // The rail sections toggle on click, but various elements may intercept.
  // force:true bypasses the visibility checks.
  for (const [label, outfile] of [
    ['Risks',   '78-wave-e-risks-expanded.png'],
    ['Clauses', '79-wave-e-clauses-expanded.png'],
  ]) {
    try {
      await page.locator(`button:has-text("${label}")`).first().click({ force: true, timeout: 3000 })
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${SHOTS}/${outfile}`, fullPage: false })
      console.log(`✓ saved ${SHOTS}/${outfile}`)
    } catch { console.log(`skip ${label} (not clickable or section not present)`) }
  }

  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
