#!/usr/bin/env node
/**
 * Contract AI extraction audit — grounds the docs/28 plan against reality.
 *
 * Renders 12 realistic contract fixtures → uploads each through the REAL
 * POST /api/v1/contracts/upload endpoint → lets the actual pipeline run
 * (parse → detect-binder → classify → 3-step LangGraph extract) → measures
 * what made it into the DB vs what docs/28 promises.
 *
 * No assertions that fail — this is a diagnostic. It prints a scorecard:
 *
 *   per fixture:
 *     ✓ / ✗  analysisStatus reached DONE
 *     ✓ / ✗  expected contract type matched
 *     ✓ / ✗  counterparty extracted
 *     ✓ / ✗  governing law extracted
 *     ✓ / ✗  summary non-empty
 *     ✓ / ✗  riskScore set
 *     ✓ / ✗  overallConfidence set
 *     ✓ / ✗  fieldConfidence populated
 *     ✓ / ✗  ContractClause rows > 0
 *     ✓ / ✗  expected-fact-1 present (per-fixture)
 *     ...
 *
 *   aggregate:
 *     DONE / PENDING / FAILED counts
 *     mean time to DONE
 *     mean clause count per contract
 *     mean overallConfidence
 *     category-level hit rate (type matching, counterparty, governingLaw, …)
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(__dirname, '../apps/api/scripts/fixtures/ai-demo')

const API = 'http://localhost:3001'
const GOTENBERG = process.env.GOTENBERG_URL ?? 'http://localhost:3002'

// ─── Fixture catalog with expected extractions ────────────────────────────

/** `type` can be either a single string (strict match) or an array of
 *  acceptable values (any-match). Arrays cover ambiguous cases where
 *  multiple labels are defensible — e.g. an Amendment to an MSA could
 *  be classified as "MSA" (accurate: it's an MSA-class doc) or "OTHER"
 *  (defensible: no AMENDMENT enum). */

/** @type {Array<{file:string,title:string,type:string|string[],counterparty:string,
 *               expectGoverningLaw:string|null,expectValue:number|null,
 *               expectedFacts:Array<{label:string,patterns:RegExp[]}>}>} */
const FIXTURES_LIST = [
  {
    file: 'nda-globex.txt',
    title: 'AUDIT: Globex — Mutual NDA',
    type: 'NDA',
    counterparty: 'Globex Industries',
    expectGoverningLaw: 'California',
    expectValue: null,
    expectedFacts: [
      { label: '2-year term',              patterns: [/\b(2|two)\s*(year|yr)/i] },
      { label: '$50,000 liquidated dmg',   patterns: [/50[,.]?000/, /fifty thousand/i] },
    ],
  },
  {
    file: 'msa-acme.txt',
    title: 'AUDIT: Acme Corp — MSA',
    type: 'MSA',
    counterparty: 'Acme Corporation',
    expectGoverningLaw: 'Delaware',
    expectValue: null,
    expectedFacts: [
      { label: '$500,000 liability cap',   patterns: [/500[,.]?000/, /five hundred thousand/i] },
      { label: 'JAMS arbitration',         patterns: [/jams/i, /arbitration/i] },
      { label: 'Net 30',                   patterns: [/net\s*30|thirty\s*\(30\)\s*days/i] },
    ],
  },
  {
    file: 'sla-umbrella.txt',
    title: 'AUDIT: Umbrella Corp — SLA',
    type: 'SLA',
    counterparty: 'Umbrella Corporation',
    expectGoverningLaw: null, // SLA fixture doesn't have a governing law clause
    expectValue: null,
    expectedFacts: [
      { label: '99.9% uptime',             patterns: [/99\.9/] },
      { label: '15-min Sev 1 response',    patterns: [/15\s*minutes|15m/i] },
      { label: 'SOC 2 Type II',            patterns: [/soc\s*2\s*type\s*ii/i] },
    ],
  },
  {
    file: 'sow-stark.txt',
    title: 'AUDIT: Stark Industries — SOW #12',
    type: 'SOW',
    counterparty: 'Stark Industries',
    expectGoverningLaw: null,
    expectValue: 85_000,
    expectedFacts: [
      { label: '5 milestones',             patterns: [/five\s*\(5\)?\s*milestones|5\s*milestones/i] },
      { label: '$85,000 total fee',        patterns: [/85[,.]?000|eighty-?five thousand/i] },
      { label: '90-day warranty',          patterns: [/90[-\s]?day|ninety\s*\(90\)?\s*days/i] },
    ],
  },
  {
    file: 'employment-riley.txt',
    title: 'AUDIT: Riley Chen — Employment Agreement',
    type: 'EMPLOYMENT',
    counterparty: 'Riley Chen',
    expectGoverningLaw: 'Texas',
    expectValue: 180_000,
    expectedFacts: [
      { label: '$180,000 base',            patterns: [/180[,.]?000|one hundred eighty thousand/i] },
      { label: '12-month non-compete',     patterns: [/twelve\s*\(12\)?\s*months|12[-\s]?month/i] },
      { label: 'at-will',                  patterns: [/at[-\s]?will/i] },
    ],
  },
  {
    file: 'partnership-wayne.txt',
    title: 'AUDIT: Wayne Enterprises — Partnership',
    type: 'PARTNERSHIP',
    counterparty: 'Wayne Enterprises',
    expectGoverningLaw: 'New York',
    expectValue: null,
    expectedFacts: [
      { label: '60/40 revenue split',      patterns: [/60\s*%|sixty\s*percent/i] },
      { label: '$250k liability cap',      patterns: [/250[,.]?000|two hundred fifty thousand/i] },
      { label: '2-year initial term',      patterns: [/\b(2|two)\s*\(?\s*(2)?\s*\)?\s*year/i] },
    ],
  },
  {
    file: 'license-initech.txt',
    title: 'AUDIT: Initech — Software License',
    type: 'LICENSE',
    counterparty: 'Initech Solutions',
    expectGoverningLaw: 'Texas',
    expectValue: 48_000,
    expectedFacts: [
      { label: '50 Named Users',           patterns: [/50\s*(named\s*)?users|fifty\s*\(50\)?\s*named/i] },
      { label: '$48,000 annual',           patterns: [/48[,.]?000|forty[- ]eight thousand/i] },
      { label: '12-month initial term',    patterns: [/twelve\s*\(12\)?\s*months|12[-\s]?month/i] },
    ],
  },
  {
    file: 'dpa-tyrell.txt',
    title: 'AUDIT: Tyrell Corp — DPA',
    type: 'DATA_PROCESSING',
    counterparty: 'Tyrell Corporation',
    expectGoverningLaw: null,
    expectValue: null,
    expectedFacts: [
      { label: '72-hour breach notice',    patterns: [/72[-\s]?hour|seventy[- ]two\s*\(72\)?\s*hours/i] },
      { label: 'GDPR',                     patterns: [/gdpr/i] },
      { label: 'TLS 1.3 / AES-256',        patterns: [/tls\s*1\.3|aes[-\s]?256/i] },
    ],
  },
  {
    file: 'order-form-cyberdyne.txt',
    title: 'AUDIT: Cyberdyne — Order Form',
    type: 'ORDER_FORM',
    counterparty: 'Cyberdyne Systems',
    expectGoverningLaw: null,
    expectValue: 1_418_625,
    expectedFacts: [
      { label: '36-month term',            patterns: [/36\s*months|thirty[- ]six\s*months/i] },
      { label: '250 seats',                patterns: [/250\s*(named\s*)?users|250\s*seats/i] },
      { label: '99.95% uptime',            patterns: [/99\.95/] },
    ],
  },
  {
    file: 'vendor-pied-piper.txt',
    title: 'AUDIT: Pied Piper — Vendor Agreement',
    type: 'VENDOR_AGREEMENT',
    counterparty: 'Pied Piper',
    expectGoverningLaw: 'California',
    expectValue: null,
    expectedFacts: [
      { label: '$18k monthly',             patterns: [/18[,.]?000|eighteen thousand/i] },
      { label: '18-month initial term',    patterns: [/eighteen\s*\(18\)?\s*months|18[-\s]?month/i] },
      { label: 'Net 45',                   patterns: [/net\s*45/i] },
    ],
  },
  {
    file: 'amendment-acme.txt',
    title: 'AUDIT: Amendment #1 to Acme MSA',
    // An Amendment to an MSA is legitimately either — accept both.
    type: ['OTHER', 'MSA'],
    counterparty: 'Acme Corporation',
    expectGoverningLaw: null, // amends the MSA
    expectValue: null,
    expectedFacts: [
      { label: '$1.5M increased cap',      patterns: [/1[,.]?500[,.]?000|1\.5\s*m/i] },
      { label: '4-year extended term',     patterns: [/four\s*\(4\)?\s*years|4[-\s]?year/i] },
      { label: 'Net 45 (new)',             patterns: [/net\s*45/i] },
    ],
  },
  {
    file: 'consulting-oscorp.txt',
    title: 'AUDIT: OsCorp — Consulting',
    // Consulting engagements with milestones + deliverables are
    // defensibly SOW-shaped; also OK as OTHER.
    type: ['OTHER', 'SOW'],
    counterparty: 'OsCorp Industries',
    expectGoverningLaw: 'New York',
    expectValue: 75_000,
    expectedFacts: [
      { label: '$400/hr principal',        patterns: [/\$\s*400|four hundred/i] },
      { label: '$75,000 NTE cap',          patterns: [/75[,.]?000|seventy[- ]five thousand/i] },
      { label: '6-month initial term',     patterns: [/six\s*\(6\)?\s*months|6[-\s]?month/i] },
    ],
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────

function esc(s) { return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])) }
function plainToHtml(text, title) {
  const paragraphs = text.split(/\n\s*\n/)
  return `<h1>${esc(title)}</h1>\n` + paragraphs.map(p =>
    `<p>${esc(p).replace(/\n/g, '<br />')}</p>`).join('\n')
}

async function renderPdf(html) {
  // Gotenberg's Chromium pool occasionally 503s on back-to-back requests;
  // retry 2× with short backoff rather than failing the whole audit.
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: Georgia, serif; font-size: 12pt; line-height: 1.6; margin: 2.5cm; color: #1a1a1a; }
    h1 { font-size: 18pt; } p { margin: 0.4em 0; }
  </style></head><body>${html}</body></html>`
  for (let attempt = 1; attempt <= 5; attempt++) {
    const fd = new FormData()
    fd.append('files', new Blob([fullHtml], { type: 'text/html' }), 'index.html')
    try {
      const r = await fetch(`${GOTENBERG}/forms/chromium/convert/html`, { method: 'POST', body: fd })
      if (r.ok) return Buffer.from(await r.arrayBuffer())
      if (attempt === 5) throw new Error(`Gotenberg ${r.status}: ${(await r.text()).slice(0, 200)}`)
    } catch (e) {
      if (attempt === 5) throw e
    }
    // 1s, 2s, 4s, 8s backoff
    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)))
  }
  throw new Error('unreachable')
}

async function login() {
  const r = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.com', password: 'password123' }),
  })
  if (!r.ok) throw new Error(`Login failed: ${r.status}`)
  const j = await r.json()
  return j.accessToken
}

async function uploadContract(token, pdfBuffer, filename, title, type, counterpartyName) {
  const fd = new FormData()
  fd.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), filename)
  fd.append('title', title)
  fd.append('type', type)
  fd.append('counterpartyName', counterpartyName)
  const r = await fetch(`${API}/api/v1/contracts/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: fd,
  })
  if (!r.ok) {
    const errBody = await r.text()
    throw new Error(`Upload failed for ${filename} (${r.status}): ${errBody.slice(0, 300)}`)
  }
  return r.json()
}

async function poll(token, contractId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await fetch(`${API}/api/v1/contracts/${contractId}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (r.ok) {
      const j = await r.json()
      if (j.analysisStatus === 'DONE' || j.analysisStatus === 'FAILED') return await enrich(token, j)
    }
    await new Promise(r => setTimeout(r, 3_000))
  }
  // Timeout — return last known state
  const r = await fetch(`${API}/api/v1/contracts/${contractId}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  return r.ok ? enrich(token, await r.json()) : null
}

// Decorate a contract response with its clause count via GET /:id/clauses —
// otherwise we'd read .versions[].clauses and always see undefined, because
// the contract-detail endpoint doesn't include that nested relation. This
// was the false positive from the original audit (0/12 "no clauses" — they
// WERE in the DB, the endpoint just doesn't expose them).
async function enrich(token, contract) {
  try {
    const r = await fetch(`${API}/api/v1/contracts/${contract.id}/clauses`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (r.ok) {
      const j = await r.json()
      const rows = j.clauses ?? j.data ?? j ?? []
      contract._clauseCount = Array.isArray(rows) ? rows.length : 0
    } else {
      contract._clauseCount = 0
    }
  } catch { contract._clauseCount = 0 }
  return contract
}

async function cleanupPriorAudit(token) {
  // List contracts, soft-delete any with title starting "AUDIT:"
  let total = 0
  for (let page = 1; page < 10; page++) {
    const r = await fetch(`${API}/api/v1/contracts?page=${page}&pageSize=50`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!r.ok) break
    const j = await r.json()
    const rows = j.contracts ?? j.data ?? []
    if (rows.length === 0) break
    for (const c of rows) {
      if ((c.title ?? '').startsWith('AUDIT:')) {
        await fetch(`${API}/api/v1/contracts/${c.id}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` },
        })
        total++
      }
    }
    if (rows.length < 50) break
  }
  if (total > 0) console.log(`  (cleaned up ${total} prior AUDIT: contract(s))`)
}

// ─── Main ─────────────────────────────────────────────────────────────────

;(async () => {
  console.log(`\n━━━ Contract AI extraction audit ━━━\n`)

  const token = await login()
  await cleanupPriorAudit(token)

  // Step 1 — upload all fixtures
  console.log(`Uploading ${FIXTURES_LIST.length} fixtures through real pipeline…`)
  const uploads = []
  for (const f of FIXTURES_LIST) {
    const plainText = readFileSync(join(FIXTURES, f.file), 'utf-8')
    const html = plainToHtml(plainText, f.title)
    const pdf = await renderPdf(html)
    const started = Date.now()
    try {
      const contract = await uploadContract(token, pdf, f.file.replace('.txt', '.pdf'),
                                           f.title, f.type, f.counterparty)
      uploads.push({ fixture: f, contractId: contract.id, uploadedAt: started, expectedText: plainText })
      console.log(`  ✓ queued  ${f.title.padEnd(50)} (${pdf.length.toString().padStart(6)}B → ${contract.id})`)
    } catch (e) {
      uploads.push({ fixture: f, contractId: null, uploadedAt: started, error: e.message })
      console.log(`  ✗ FAILED  ${f.title.padEnd(50)}  ${e.message}`)
    }
  }

  // Step 2 — poll each to completion
  console.log(`\nPolling extraction completion…`)
  const results = []
  for (const u of uploads) {
    if (!u.contractId) { results.push({ ...u, final: null, elapsedMs: null }); continue }
    const final = await poll(token, u.contractId)
    const elapsedMs = Date.now() - u.uploadedAt
    const status = final?.analysisStatus ?? 'TIMEOUT'
    console.log(`  ${status === 'DONE' ? '✓' : status === 'FAILED' ? '✗' : '…'}  ${status.padEnd(8)}  ${u.fixture.title.padEnd(50)}  ${(elapsedMs / 1000).toFixed(1)}s`)
    results.push({ ...u, final, elapsedMs })
  }

  // Step 3 — scorecard per fixture
  console.log(`\n━━━ Scorecard ━━━\n`)
  const agg = {
    DONE: 0, FAILED: 0, TIMEOUT: 0,
    typeCorrect: 0, counterpartyCorrect: 0, governingLawCorrect: 0, valueCorrect: 0,
    summaryPresent: 0, riskScorePresent: 0, overallConfidencePresent: 0,
    fieldConfidencePresent: 0, clauseCountGT0: 0, factsPresent: 0, factsTotal: 0,
  }

  for (const r of results) {
    const f = r.fixture
    const final = r.final
    const status = final?.analysisStatus ?? 'TIMEOUT'

    console.log(`── ${f.title}`)
    if (!final) { console.log(`   no data returned\n`); continue }

    const kt = final.keyTerms ?? {}
    const fc = final.fieldConfidence ?? {}
    const clauseCount = Array.isArray(final.clauses) ? final.clauses.length
                      : final._clauseCount
                      ?? (final.versions?.flatMap?.(v => v.clauses ?? []).length ?? 0)
    const plainText = (final.versions ?? []).map(v => v.plainText ?? '').join('\n')

    const rows = [
      ['analysisStatus', status === 'DONE',
        status === 'DONE' ? 'DONE' : status],
      ['type matches',
        Array.isArray(f.type) ? f.type.includes(final.type) : final.type === f.type,
        `got ${final.type ?? '—'}, expected ${Array.isArray(f.type) ? f.type.join('|') : f.type}`],
      ['counterparty extracted', !!(final.counterpartyName ?? '').match(new RegExp(f.counterparty.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(' ')[0], 'i')),
        `got ${final.counterpartyName ?? '—'}, expected ${f.counterparty}`],
      ...(f.expectGoverningLaw ? [
        ['governing law', !!(final.jurisdiction ?? kt.governingLaw ?? '').toString().match(new RegExp(f.expectGoverningLaw, 'i')),
          `got ${final.jurisdiction ?? kt.governingLaw ?? '—'}, expected ${f.expectGoverningLaw}`],
      ] : []),
      ...(f.expectValue ? [
        ['value matches', Number(final.value ?? kt.value ?? 0) === f.expectValue,
          `got ${final.value ?? kt.value ?? '—'}, expected ${f.expectValue}`],
      ] : []),
      ['summary present', typeof final.summary === 'string' && final.summary.length > 20,
        final.summary ? `${final.summary.slice(0, 80)}…` : '—'],
      ['riskScore present', typeof final.riskScore === 'number',
        final.riskScore != null ? String(final.riskScore) : '—'],
      ['overallConfidence present', typeof final.overallConfidence === 'number',
        final.overallConfidence != null ? String(final.overallConfidence) : '—'],
      ['fieldConfidence populated', Object.keys(fc).length > 0,
        `${Object.keys(fc).length} field(s)`],
      ['ContractClause rows', clauseCount > 0,
        `${clauseCount} row(s)`],
    ]
    for (const [label, ok, detail] of rows) {
      console.log(`   ${ok ? '✓' : '✗'}  ${label.padEnd(28)}  ${detail}`)
    }

    // Agg counters
    if (status === 'DONE')                                               agg.DONE++
    if (final.type === f.type)                                           agg.typeCorrect++
    if (rows.find(r => r[0] === 'counterparty extracted')?.[1])          agg.counterpartyCorrect++
    if (rows.find(r => r[0] === 'governing law')?.[1])                   agg.governingLawCorrect++
    if (rows.find(r => r[0] === 'value matches')?.[1])                   agg.valueCorrect++
    if (rows.find(r => r[0] === 'summary present')?.[1])                 agg.summaryPresent++
    if (rows.find(r => r[0] === 'riskScore present')?.[1])               agg.riskScorePresent++
    if (rows.find(r => r[0] === 'overallConfidence present')?.[1])       agg.overallConfidencePresent++
    if (rows.find(r => r[0] === 'fieldConfidence populated')?.[1])       agg.fieldConfidencePresent++
    if (rows.find(r => r[0] === 'ContractClause rows')?.[1])             agg.clauseCountGT0++

    // Per-fixture facts: are they present in plainText OR summary OR clauses?
    const haystack = [
      plainText,
      final.summary ?? '',
      JSON.stringify(final.keyTerms ?? {}),
      JSON.stringify(final.riskFactors ?? []),
    ].join('\n')
    for (const fact of f.expectedFacts) {
      agg.factsTotal++
      const ok = fact.patterns.some(p => p.test(haystack))
      if (ok) agg.factsPresent++
      console.log(`   ${ok ? '✓' : '✗'}  fact: ${fact.label}`)
    }
    console.log()
  }

  // Aggregate
  const n = uploads.length
  const nWithLaw = FIXTURES_LIST.filter(f => f.expectGoverningLaw).length
  const nWithValue = FIXTURES_LIST.filter(f => f.expectValue).length
  console.log(`━━━ Aggregate ━━━`)
  console.log(`  uploaded:                ${n}`)
  console.log(`  DONE:                    ${agg.DONE}/${n}`)
  console.log(`  FAILED:                  ${agg.FAILED}/${n}`)
  console.log(`  TIMEOUT:                 ${agg.TIMEOUT}/${n}`)
  console.log(`  type correctly inferred: ${agg.typeCorrect}/${n}`)
  console.log(`  counterparty extracted:  ${agg.counterpartyCorrect}/${n}`)
  console.log(`  governing law extracted: ${agg.governingLawCorrect}/${nWithLaw}`)
  console.log(`  value extracted:         ${agg.valueCorrect}/${nWithValue}`)
  console.log(`  summary present:         ${agg.summaryPresent}/${n}`)
  console.log(`  riskScore present:       ${agg.riskScorePresent}/${n}`)
  console.log(`  overallConfidence:       ${agg.overallConfidencePresent}/${n}`)
  console.log(`  fieldConfidence:         ${agg.fieldConfidencePresent}/${n}`)
  console.log(`  clauses > 0:             ${agg.clauseCountGT0}/${n}`)
  console.log(`  per-fixture facts:       ${agg.factsPresent}/${agg.factsTotal}`)
  const meanS = results.filter(r => r.elapsedMs).reduce((a, r) => a + r.elapsedMs, 0) / (results.filter(r => r.elapsedMs).length || 1) / 1000
  console.log(`  mean time to completion: ${meanS.toFixed(1)}s`)

  // ─── Wave E.5 — regression thresholds ─────────────────────────────────
  // Each metric has a floor below which we consider the run a regression.
  // Passing CLI flag `--regress` exits non-zero on failure so CI can gate.
  // Metrics with looser floors (type, counterparty) have known remaining
  // gaps documented in Wave E.6 — tighten as those fixes land.
  const thresholds = [
    ['DONE reached',            agg.DONE,                       n,      n          ],
    ['no FAILED',               n - agg.FAILED,                 n,      n          ],
    ['clauses > 0',             agg.clauseCountGT0,             n,      n          ],
    ['summary present',         agg.summaryPresent,             n,      n          ],
    ['riskScore present',       agg.riskScorePresent,           n,      n          ],
    ['overallConfidence',       agg.overallConfidencePresent,   n,      n          ],
    ['fieldConfidence',         agg.fieldConfidencePresent,     n,      n          ],
    ['counterparty extracted',  agg.counterpartyCorrect,        n,      n          ],
    ['governing law extracted', agg.governingLawCorrect,        nWithLaw, nWithLaw ],
    ['value extracted',         agg.valueCorrect,               nWithValue, nWithValue ],
    // 94% floor — LLM extraction has some jitter turn-to-turn even with
    // temperature 0; one missed fact per run is below the signal floor.
    ['per-fixture facts',       agg.factsPresent,               Math.floor(agg.factsTotal * 0.94), agg.factsTotal ],
    // Looser floor; E.6 scope. Tighten to n when prompt is hardened.
    ['type correctly inferred', agg.typeCorrect,                Math.max(7, Math.ceil(n * 0.5)), n ],
  ]
  const regressMode = process.argv.includes('--regress')
  console.log(`\n━━━ Regression gates ━━━`)
  let failures = 0
  for (const [label, got, floor, ideal] of thresholds) {
    const ok = got >= floor
    const marker = ok ? '✓' : '✗'
    const idealLabel = floor === ideal ? `` : `  (ideal ${ideal})`
    console.log(`  ${marker} ${label.padEnd(28)} ${got}/${ideal} (floor ${floor})${idealLabel}`)
    if (!ok) failures++
  }
  if (regressMode && failures > 0) {
    console.error(`\n✗ ${failures} regression gate(s) failed`)
    process.exit(1)
  }
  if (failures === 0) console.log(`\n✓ All regression gates pass`)
})().catch(e => { console.error(e); process.exit(1) })
