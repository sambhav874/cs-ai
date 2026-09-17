#!/usr/bin/env node
/**
 * Phase A — Agentic flow audit.
 *
 * For each persona, fire 1-3 chat messages at the agent endpoint and
 * verify it (a) responds, (b) cites specific contract data, (c) calls
 * appropriate tools.
 *
 * Tests: HeroAgent + side rail share thread state. We POST to the
 * /api/v1/agent/chat endpoint that the side rail uses.
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const API = 'http://localhost:3001'

const PROBES = [
  {
    persona: 'maya',
    email:   'maya@demo.com',
    asks: [
      'What\'s the status of the Zynga MSA?',
      'List the top risks in the Zynga MSA — which ones are off our playbook?',
      'Compare the Zynga MSA liability cap to our preferred position',
    ],
  },
  {
    persona: 'lisa',
    email:   'lisa@demo.com',
    asks: [
      'Which contracts in my portfolio expire in the next 90 days?',
      'What should I do about the Cloudwave renewal?',
      'Show me the tracked obligations for the Datadog license',
    ],
  },
  {
    persona: 'marcus',
    email:   'marcus@demo.com',
    asks: [
      'What\'s in my approval queue?',
      'Summarise the Salesforce order form I need to approve',
      'What are the renewal cap terms on the Salesforce order?',
    ],
  },
  {
    persona: 'daniel',
    email:   'daniel@demo.com',
    asks: [
      'Draft an SOW for Zynga\'s Year-3 expansion',
      'What past deals do we have with Pacific Distribution?',
    ],
  },
  {
    persona: 'emily',
    email:   'emily@demo.com',
    asks: [
      'Send Priya her offer letter',
    ],
  },
]

async function login(email) {
  const r = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  }).then(x => x.json())
  return { token: r.accessToken, user: r.user }
}

async function chat(token, message, threadId) {
  // Hit the agent SSE endpoint and consume the stream. Returns
  // { tools_called: [], tokens: <total>, completed: bool, last_text: <last 200 chars> }
  const res = await fetch(`${API}/api/v1/agent/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${token}`,
      'accept': 'text/event-stream',
    },
    body: JSON.stringify({ message, sessionId: threadId, agentMode: true, provider: 'openai', modelId: 'gpt-4o-mini' }),
  })
  if (!res.ok || !res.body) {
    return { error: `${res.status} ${res.statusText}`, tools_called: [], tokens: 0, completed: false }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let tokens = 0
  const tools = new Set()
  let lastText = ''
  let completed = false
  let newThreadId = threadId
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop() ?? ''
    for (const ln of lines) {
      if (!ln.trim() || !ln.startsWith('data:')) continue
      try {
        const evt = JSON.parse(ln.slice(5).trim())
        if (evt.type === 'token') { tokens++; lastText = (lastText + (evt.delta || evt.content || '')).slice(-300) }
        if ((evt.type === 'tool_call_start' || evt.type === 'tool_call') && evt.name) tools.add(evt.name)
        if (evt.type === 'done') completed = true
        if (evt.session_id) newThreadId = evt.session_id
        if (evt.type === 'error') console.log('   [STREAM ERROR]', evt.error?.slice?.(0, 200))
      } catch { /* not json */ }
    }
  }
  return { tools_called: [...tools], tokens, completed, last_text: lastText, threadId: newThreadId }
}

;(async () => {
  for (const p of PROBES) {
    console.log(`\n══════ ${p.persona.toUpperCase()} (${p.email}) ══════`)
    const { token } = await login(p.email)
    let threadId = undefined
    for (const ask of p.asks) {
      console.log(`\n→ Q: ${ask}`)
      const t0 = Date.now()
      const r = await chat(token, ask, threadId)
      const dt = ((Date.now() - t0) / 1000).toFixed(1)
      threadId = r.threadId ?? threadId
      if (r.error) {
        console.log(`  ✗ error: ${r.error}`)
        continue
      }
      console.log(`  ✓ ${dt}s · ${r.tokens} tokens · tools: [${r.tools_called.join(', ')}] · done=${r.completed}`)
      console.log(`    last text: …${r.last_text.slice(-160)}`)
    }
  }
})().catch(e => { console.error(e); process.exit(1) })
