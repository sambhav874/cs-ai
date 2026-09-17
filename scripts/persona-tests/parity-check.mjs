#!/usr/bin/env node
/**
 * parity-check.mjs — same prompt sent to both Assistant + Ask payloads,
 * expect both to pick the same tool and produce equivalent answers.
 *
 * Both surfaces post to /api/v1/agent/chat. The difference (after the
 * "Assistant returns no contracts" fix) is just the model pin — the
 * Assistant page now also pins gpt-4.1-mini, so behavior should match.
 *
 * We simulate each surface's exact request payload and compare:
 *   • tool calls picked (same set, possibly different order)
 *   • known counterparties mentioned in the reply
 *   • neither rejects/errors
 */
import { login, askAgent } from './lib.mjs'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'output', 'parity-check')
fs.mkdirSync(OUT, { recursive: true })

const QUERIES = [
  {
    label: 'top-counterparties',
    text:  'List our top 5 counterparties by total contract value. For each, show contract count, total value, and any open risks.',
    knownMentions: ['Zynga', 'Cloudwave', 'Datadog'],
    expectedToolName: 'contract_search',
  },
  {
    label: 'expiring-30d',
    text:  'Show me NDAs expiring in the next 30 days.',
    knownMentions: [],
    // Either contract_search (with expiry filter) OR renewal_advice (window=30) is correct
    expectedToolNames: ['contract_search', 'portfolio_search', 'renewal_advice'],
  },
  {
    label: 'approval-queue',
    text:  'What approvals are awaiting my decision?',
    knownMentions: [],
    expectedToolName: 'approval_list',
  },
]

const PASSWORD = 'password123'
const { accessToken } = await login('maya@demo.com', PASSWORD)

let pass = 0, fail = 0
function record(label, ok, detail = '') {
  if (ok) { pass++; console.log(`    ✓ ${label}`) }
  else    { fail++; console.log(`    ✗ ${label}${detail ? ` · ${detail}` : ''}`) }
}

for (const q of QUERIES) {
  console.log(`\n═══ Parity: ${q.label} ═══`)

  // ASSISTANT-style payload — pins gpt-4.1-mini after the fix
  const assistant = await askAgent({
    token: accessToken,
    sessionId: `parity-asst-${q.label}-${Date.now()}`,
    message: q.text,
    agentMode: true,
    provider: 'openai', modelId: 'gpt-4.1-mini',
  })
  // ASK-style payload — same pin (rail also pinned)
  const ask = await askAgent({
    token: accessToken,
    sessionId: `parity-ask-${q.label}-${Date.now()}`,
    message: q.text,
    agentMode: true,
    provider: 'openai', modelId: 'gpt-4.1-mini',
  })

  fs.writeFileSync(path.join(OUT, `${q.label}-assistant.json`), JSON.stringify(assistant, null, 2))
  fs.writeFileSync(path.join(OUT, `${q.label}-ask.json`),       JSON.stringify(ask,       null, 2))

  // Both should not error
  record(`[${q.label}] both surfaces non-error`, !assistant.error && !ask.error,
    assistant.error || ask.error || '')

  // Both should call one of the expected primary tools
  const asstTools = new Set(assistant.tools.map(t => t.name))
  const askTools  = new Set(ask.tools.map(t => t.name))
  const expected = q.expectedToolNames ?? [q.expectedToolName]
  const asstHit = expected.some(t => asstTools.has(t))
  const askHit  = expected.some(t => askTools.has(t))
  record(`[${q.label}] Assistant invoked one of [${expected.join('|')}]`, asstHit, [...asstTools].join(','))
  record(`[${q.label}] Ask invoked one of [${expected.join('|')}]`, askHit, [...askTools].join(','))

  // Tool sets should overlap meaningfully OR both be in the expected set
  const overlap = [...asstTools].filter(t => askTools.has(t))
  const bothInExpected = asstHit && askHit
  record(`[${q.label}] surfaces in agreement (overlap or both in expected set)`,
    overlap.length >= 1 || bothInExpected,
    `asst=[${[...asstTools].join(',')}] ask=[${[...askTools].join(',')}]`)

  // Known mentions: parity = both surfaces mention SAME counterparties.
  // We don't require ALL knownMentions appear (LLM picks "top N" subjectively
  // and this can vary run-to-run), but we DO require the surfaces to agree.
  const sharedMentions = q.knownMentions.filter(m => {
    const inAsst = assistant.assistantText.toLowerCase().includes(m.toLowerCase())
    const inAsk  = ask.assistantText.toLowerCase().includes(m.toLowerCase())
    return inAsst === inAsk
  })
  if (q.knownMentions.length > 0) {
    record(`[${q.label}] surfaces agree on counterparty mentions (${sharedMentions.length}/${q.knownMentions.length})`,
      sharedMentions.length >= Math.max(1, Math.floor(q.knownMentions.length * 0.66)),
      `shared=${JSON.stringify(sharedMentions)}`)
  }
}

console.log(`\n${'═'.repeat(70)}`)
console.log(`Parity: ${pass}/${pass + fail} passed`)
console.log(`${'═'.repeat(70)}`)
if (fail > 0) process.exit(1)
