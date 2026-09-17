#!/usr/bin/env node
/**
 * journeys-api.mjs — multi-turn user journeys via direct SSE.
 *
 * What we're verifying:
 *   J1 Search → narrow → drill         (Maya finds & opens an NDA)
 *   J2 Approval queue → risk → details (GC reviews her queue)
 *   J3 Counterparty drill              (drill Snowflake, types, exposure)
 *
 * Each journey runs 3-5 turns on the SAME sessionId so context retention
 * is exercised. Pass criteria:
 *   • Each turn produces a non-error response
 *   • Late turns reference entities established in early turns
 *   • Tool calls are appropriate per turn (no random matter_list when we
 *     asked about contracts, etc.)
 */
import { login, askAgent } from './lib.mjs'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'output', 'journeys-api')
fs.mkdirSync(OUT, { recursive: true })

const PASSWORD = 'password123'
let pass = 0, fail = 0
const all = []

function record(journey, turn, label, ok, detail = '') {
  if (ok) { pass++; console.log(`    ✓ T${turn} · ${label}`) }
  else    { fail++; console.log(`    ✗ T${turn} · ${label}${detail ? ` — ${detail}` : ''}`) }
  all.push({ journey, turn, label, ok, detail })
}

const { accessToken } = await login('maya@demo.com', PASSWORD)
console.log('logged in maya@demo.com\n')

// ────────────────────────────────────────────────────────────────────
// J1 — Search → narrow → drill
// ────────────────────────────────────────────────────────────────────
{
  console.log('═══ J1 · Search → narrow → drill ═══')
  const sid = 'journey-1-' + Date.now()

  const t1 = await askAgent({ token: accessToken, sessionId: sid, agentMode: true,
    message: 'Show me all our NDAs.' })
  fs.writeFileSync(path.join(OUT, 'j1-t1.json'), JSON.stringify(t1, null, 2))
  record('J1', 1, 'agent searched + listed NDAs',
    t1.tools.some(t => t.name === 'contract_search' || t.name === 'portfolio_search') &&
    /nda|non-disclosure|confidential/i.test(t1.assistantText),
    t1.error)

  const t2 = await askAgent({ token: accessToken, sessionId: sid, agentMode: true,
    message: 'Of those, which are expiring in the next 30 days?' })
  fs.writeFileSync(path.join(OUT, 'j1-t2.json'), JSON.stringify(t2, null, 2))
  // The agent should know "those" refers to NDAs (context retention)
  record('J1', 2, 'narrowed to expiring (context kept "NDAs")',
    /nda|expir/i.test(t2.assistantText) && !t2.error,
    t2.error)

  const t3 = await askAgent({ token: accessToken, sessionId: sid, agentMode: true,
    message: 'Tell me more about the top one — key terms, governing law, who signed it.' })
  fs.writeFileSync(path.join(OUT, 'j1-t3.json'), JSON.stringify(t3, null, 2))
  record('J1', 3, 'drilled into a specific contract',
    !t3.error && t3.assistantText.length > 200 &&
    (t3.tools.some(t => t.name === 'contract_get') || /governing\s+law|signed|term/i.test(t3.assistantText)),
    t3.error)
}

// ────────────────────────────────────────────────────────────────────
// J2 — Approval queue → risk → details
// ────────────────────────────────────────────────────────────────────
{
  console.log('\n═══ J2 · Approval queue → risk → details ═══')
  const sid = 'journey-2-' + Date.now()

  const t1 = await askAgent({ token: accessToken, sessionId: sid, agentMode: true,
    message: 'What approvals are awaiting my decision?' })
  fs.writeFileSync(path.join(OUT, 'j2-t1.json'), JSON.stringify(t1, null, 2))
  record('J2', 1, 'fetched approval queue',
    t1.tools.some(t => t.name === 'approval_list') && !t1.error)

  const t2 = await askAgent({ token: accessToken, sessionId: sid, agentMode: true,
    message: 'Which one has the highest risk? Give me the details + your recommendation.' })
  fs.writeFileSync(path.join(OUT, 'j2-t2.json'), JSON.stringify(t2, null, 2))
  record('J2', 2, 'identified highest-risk approval (context retention)',
    !t2.error && t2.assistantText.length > 150 &&
    /risk|recommend|approve|reject/i.test(t2.assistantText),
    t2.error)

  const t3 = await askAgent({ token: accessToken, sessionId: sid, agentMode: true,
    message: 'Pull the full contract for that one and tell me the liability cap and indemnification.' })
  fs.writeFileSync(path.join(OUT, 'j2-t3.json'), JSON.stringify(t3, null, 2))
  record('J2', 3, 'drilled into contract details (mentions liability or indemnification)',
    !t3.error && /(liabil|indemn|cap)/i.test(t3.assistantText),
    t3.error)
}

// ────────────────────────────────────────────────────────────────────
// J3 — Counterparty drill
// ────────────────────────────────────────────────────────────────────
{
  console.log('\n═══ J3 · Counterparty drill ═══')
  const sid = 'journey-3-' + Date.now()

  const t1 = await askAgent({ token: accessToken, sessionId: sid, agentMode: true,
    message: 'Tell me about our relationship with Zynga.' })
  fs.writeFileSync(path.join(OUT, 'j3-t1.json'), JSON.stringify(t1, null, 2))
  record('J3', 1, 'agent retrieved counterparty memory',
    (t1.tools.some(t => t.name === 'counterparty_memory' || t.name === 'counterparty_get' || t.name === 'contract_search')) &&
    /zynga/i.test(t1.assistantText),
    t1.error)

  const t2 = await askAgent({ token: accessToken, sessionId: sid, agentMode: true,
    message: 'How many MSAs do we have with them, and what are the values?' })
  fs.writeFileSync(path.join(OUT, 'j3-t2.json'), JSON.stringify(t2, null, 2))
  record('J3', 2, 'narrowed to MSAs with Zynga (context retention)',
    !t2.error && /(zynga|msa|master service)/i.test(t2.assistantText),
    t2.error)

  const t3 = await askAgent({ token: accessToken, sessionId: sid, agentMode: true,
    message: 'What is our total exposure with Zynga across all contracts?' })
  fs.writeFileSync(path.join(OUT, 'j3-t3.json'), JSON.stringify(t3, null, 2))
  record('J3', 3, 'aggregated total exposure',
    !t3.error && /(\$|total|exposure|value)/i.test(t3.assistantText),
    t3.error)
}

// ────────────────────────────────────────────────────────────────────
// Report
// ────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(70)}`)
console.log(`API Journey checks: ${pass}/${pass + fail} passed${fail ? ` (${fail} failed)` : ''}`)
console.log(`${'═'.repeat(70)}`)

fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({
  ranAt: new Date().toISOString(), pass, fail, total: pass + fail, results: all,
}, null, 2))

if (fail > 0) process.exit(1)
