/**
 * The assistant's chat proxy persists every turn itself and hands the
 * thread's history to the assistant; Apply reaches the intelligence tier's
 * paused workflows; contract_filter and the usage report work on Mongo.
 * The intelligence tier is a stubbed fetch that streams scripted frames.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const metered = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock('../lib/costCap.js', async orig => ({
  ...(await orig<typeof import('../lib/costCap.js')>()),
  recordUsage: async (...args: unknown[]) => { metered.calls.push(args) },
  assertCostCapNotExceeded: async () => {},
}))

import { prisma } from '../lib/prisma.js'
import { getApp, closeApp, makeOrg, makeUser, makeContract, auth, cleanupAll, type TestApp } from '../test-support/helpers.js'

let app: TestApp
let org: string, other: string, user: string, otherUser: string, contractId: string, otherContract: string
const SECRET = { 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET ?? '' }

const upstream = { requests: [] as Array<{ url: string; body: Record<string, unknown> }>, frames: [] as unknown[], decide: 200 }
const realFetch = globalThis.fetch

function sse(frames: unknown[]): Response {
  const body = frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(body)); c.close() },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const TURN = [
  { type: 'tool_call_start', id: 'c1', name: 'contract_search', args: { query: 'Acme' } },
  { type: 'tool_call_result', id: 'c1', name: 'contract_search', result: '{"results":[{"id":"cmabc","title":"Acme MSA"}]}', ok: true },
  { type: 'tool_call_start', id: 'w1', name: 'contract_update', args: {} },
  { type: 'tool_call_awaiting_confirmation', id: 'w1', name: 'contract_update',
    args: { contractId: 'cmabc', action: 'add_tag', payload: { tag: 'urgent' } }, preview: { summary: "Add tag 'urgent'" }, reversible: true },
  { type: 'token', delta: 'Found the Acme MSA. ' },
  { type: 'token', delta: 'Click Apply to tag it.' },
  { type: 'citations', citations: [{ ref: 1, contractId: 'cmabc', quote: 'Acme shall pay.', page: 3, sectionRef: '4', verified: true }] },
  { type: 'done', provider: 'anthropic', model: 'claude-x', tier: 'default', source: 'byok',
    usage: { inputTokens: 1000, outputTokens: 100, modelCalls: 2 } },
]

beforeAll(async () => {
  app = await getApp()
  org = await makeOrg('Chat Org')
  other = await makeOrg('Other Org')
  user = await makeUser(org)
  otherUser = await makeUser(other)
  contractId = await makeContract(org, user, { title: 'Acme MSA' })
  otherContract = await makeContract(other, otherUser, { title: 'Theirs' })
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/agent/chat')) {
      upstream.requests.push({ url, body: JSON.parse(String(init?.body)) })
      return sse(upstream.frames)
    }
    if (url.includes('/internal/agent/workflows/')) {
      upstream.requests.push({ url, body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ workflowId: 'x', status: 'completed', answer: 'Recorded.' }), { status: upstream.decide })
    }
    return realFetch(input as never, init)
  })
})
beforeEach(() => { upstream.requests.length = 0; upstream.frames = TURN; upstream.decide = 200; metered.calls.length = 0 })
afterAll(async () => { vi.unstubAllGlobals(); await cleanupAll(); await closeApp() })

const chat = (payload: Record<string, unknown>, who = user, orgId = org, roles = ['ADMIN']) =>
  app.inject({ method: 'POST', url: '/api/v1/agent/chat', headers: auth(orgId, roles, who), payload: { agentMode: true, ...payload } })

describe('POST /api/v1/agent/chat', () => {
  it('persists the turn itself, proposals included, and forwards the stream', async () => {
    const res = await chat({ message: 'Tag the Acme MSA urgent', pageContext: { type: 'contract', id: contractId, label: 'Acme MSA' } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Click Apply to tag it.')

    const sent = upstream.requests[0].body
    const threadId = String(sent.session_id)
    expect(sent.history).toEqual([])
    expect(sent.page_context).toEqual({ type: 'contract', id: contractId, label: 'Acme MSA' })

    const thread = await prisma.agentThread.findUniqueOrThrow({
      where: { id: threadId }, include: { messages: { orderBy: { createdAt: 'asc' } }, toolCalls: { orderBy: { createdAt: 'asc' } } },
    })
    expect(thread).toMatchObject({ orgId: org, userId: user, scopeType: 'contract', scopeId: contractId, title: 'Tag the Acme MSA urgent' })
    expect(thread.messages.map(m => [m.role, m.content])).toEqual([
      ['user', [{ type: 'text', text: 'Tag the Acme MSA urgent' }]],
      ['assistant', [
        { type: 'text', text: 'Found the Acme MSA. Click Apply to tag it.' },
        { type: 'citations', citations: [{ ref: 1, contractId: 'cmabc', quote: 'Acme shall pay.', page: 3, sectionRef: '4', verified: true }] },
      ]],
    ])
    expect(thread.messages[1]).toMatchObject({ provider: 'anthropic', model: 'claude-x', inputTokens: 1000, isByok: true })
    expect(thread.toolCalls.map(t => [t.toolName, t.status, t.reversible])).toEqual([
      ['contract_search', 'success', false], ['contract_update', 'awaiting_confirmation', true],
    ])

    expect(metered.calls[0]).toEqual([org, expect.any(Number), expect.objectContaining({
      provider: 'anthropic', model: 'claude-x', toolName: 'agent_chat', isByok: true, inputChars: 4000, outputChars: 400,
    })])
  })

  it('hands the next turn its history, tool calls and results included', async () => {
    await chat({ message: 'Find Acme', sessionId: 'thread-history-1' })
    upstream.frames = [{ type: 'token', delta: 'It is the Acme MSA.' }, { type: 'done' }]
    await chat({ message: 'Tell me about it', sessionId: 'thread-history-1' })
    const history = upstream.requests[1].body.history as Array<{ role: string; content: string; toolCalls: Array<Record<string, unknown>> }>
    expect(history.map(h => h.role)).toEqual(['user', 'assistant'])
    expect(history[1].content).toBe('Found the Acme MSA. Click Apply to tag it.')
    expect(history[1].toolCalls.map(t => t.name)).toEqual(['contract_search', 'contract_update'])
    expect(history[1].toolCalls[0].result).toContain('cmabc')
    expect(String(history[1].toolCalls[1].result)).toContain('awaiting_user_confirmation')
  })

  it("never reads or writes someone else's thread", async () => {
    await chat({ message: 'mine', sessionId: 'thread-owned-by-other' }, otherUser, other)
    await chat({ message: 'hijack', sessionId: 'thread-owned-by-other' })
    const sent = upstream.requests[1].body
    expect(sent.session_id).not.toBe('thread-owned-by-other')
    expect(sent.history).toEqual([])
    expect(await prisma.agentMessage.count({ where: { threadId: 'thread-owned-by-other' } })).toBe(2)
  })

  it("drops a page context the caller cannot see", async () => {
    await chat({ message: 'what is this', pageContext: { type: 'contract', id: otherContract } })
    expect(upstream.requests[0].body.page_context).toBeNull()
  })

  it('persists a failed turn with its reason', async () => {
    upstream.frames = [{ type: 'error', error: 'No model provider is configured.' }]
    await chat({ message: 'hello', sessionId: 'thread-failed-1' })
    const msgs = await prisma.agentMessage.findMany({ where: { threadId: 'thread-failed-1' }, orderBy: { createdAt: 'asc' } })
    expect(msgs[1].content).toEqual([{ type: 'text', text: '⚠ No model provider is configured.' }])
  })
})

describe('Apply on an intelligence-tier approval', () => {
  const apply = (threadId: string, payload: Record<string, unknown>, roles = ['ADMIN']) =>
    app.inject({ method: 'POST', url: `/api/v1/agent/threads/${threadId}/actions/apply`, headers: auth(org, roles, user), payload })

  it("carries out the paused workflow as the caller", async () => {
    await chat({ message: 'remember this', sessionId: 'thread-apply-1' })
    const wf = 'workflow-' + 'a'.repeat(32)
    const res = await apply('thread-apply-1', { toolName: 'remember_fact', args: { workflowId: wf } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, result: { answer: 'Recorded.' } })
    const decided = upstream.requests.find(r => r.url.includes('/decide'))!
    expect(decided.url).toContain(`/internal/agent/workflows/${wf}/decide`)
    expect(decided.body).toEqual({ org_id: org, user_id: user, decision: 'approve' })
    expect(await prisma.toolCall.count({ where: { threadId: 'thread-apply-1', toolName: 'remember_fact', status: 'success' } })).toBe(1)
  })

  it('refuses a made-up workflow id and a caller without the permission', async () => {
    await chat({ message: 'x', sessionId: 'thread-apply-2' })
    expect((await apply('thread-apply-2', { toolName: 'remember_fact', args: { workflowId: '../../admin' } })).statusCode).toBe(400)
    expect((await apply('thread-apply-2', { toolName: 'remember_fact', args: { workflowId: 'workflow-' + 'b'.repeat(32) } }, ['VIEWER'])).statusCode).toBe(403)
  })
})

describe('contract_filter', () => {
  it('filters by governing law, clause flag and expiry, and counts every match', async () => {
    const mk = async (title: string, data: Record<string, unknown>, flags: Record<string, boolean>) => {
      const id = await makeContract(org, user, { title, type: 'VENDOR_AGREEMENT' })
      const v = await prisma.contractVersion.create({ data: { contractId: id, versionNumber: 1, plainText: 't', createdById: user, clauseFlags: flags } })
      await prisma.contract.update({ where: { id }, data: { ...data, currentVersionId: v.id } as never })
    }
    await mk('CA MFN soon', { jurisdiction: 'California', expiryDate: new Date('2026-12-01') }, { mfn: true })
    await mk('CA no MFN', { jurisdiction: 'California', expiryDate: new Date('2026-12-01') }, { mfn: false })
    await mk('NY MFN', { jurisdiction: 'New York', expiryDate: new Date('2026-12-01') }, { mfn: true })
    await mk('CA MFN later', { jurisdiction: 'State of California', expiryDate: new Date('2029-01-01') }, { mfn: true })

    const res = await app.inject({
      method: 'POST', url: '/api/internal/ai/tools/contract_filter', headers: SECRET,
      payload: { orgId: org, jurisdiction: 'california', clauseFlags: { mfn: true }, expiryTo: '2027-06-30' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().totalMatching).toBe(1)
    expect(res.json().results.map((c: { title: string }) => c.title)).toEqual(['CA MFN soon'])
  })
})

describe('POST /api/internal/usage', () => {
  it("meters a run against the contract's org", async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/internal/usage', headers: SECRET,
      payload: { platformContractId: contractId, toolName: 'obligation_extraction', provider: 'groq', model: 'gpt-oss',
                 byok: false, calls: 12, inputTokens: 50_000, outputTokens: 9_000 },
    })
    expect(res.json()).toEqual({ ok: true, recorded: true })
    expect(metered.calls[0]).toEqual([org, expect.any(Number), expect.objectContaining({
      toolName: 'obligation_extraction', provider: 'groq', isByok: false, inputChars: 200_000,
    })])
    const bad = await app.inject({ method: 'POST', url: '/api/internal/usage', headers: {}, payload: {} })
    expect(bad.statusCode).toBe(401)
  })
})
