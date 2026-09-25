import { describe, expect, it } from 'vitest'
import { TurnCollector } from './agent-turns.js'

const enc = new TextEncoder()
const frame = (f: unknown) => `data: ${JSON.stringify(f)}\n\n`

function collect(stream: string, chunkSize = 7) {
  const c = new TurnCollector()
  // Split at arbitrary byte boundaries, as TCP does, including mid-character.
  const bytes = enc.encode(stream)
  for (let i = 0; i < bytes.length; i += chunkSize) c.feed(bytes.slice(i, i + chunkSize))
  return c.turn()
}

describe('TurnCollector', () => {
  it('assembles text, tool calls, proposals and the done frame from a split stream', () => {
    const turn = collect([
      frame({ type: 'tool_call_start', id: 'c1', name: 'contract_search', args: { query: 'Acme — “MSA”' } }),
      frame({ type: 'tool_call_result', id: 'c1', name: 'contract_search', result: '{"total":1}', ok: true }),
      frame({ type: 'token', delta: 'One contract — ' }),
      frame({ type: 'token', delta: 'the Acme MSA.' }),
      frame({ type: 'tool_call_start', id: 'w1', name: 'contract_update', args: {} }),
      frame({ type: 'tool_call_awaiting_confirmation', id: 'w1', name: 'contract_update',
              args: { contractId: 'cm1', action: 'add_tag' }, preview: { summary: 'Add tag' }, reversible: true }),
      frame({ type: 'done', provider: 'anthropic', model: 'claude-x', tier: 'default', source: 'byok',
              usage: { inputTokens: 900, outputTokens: 80, modelCalls: 2 } }),
      'data: [DONE]\n\n',
    ].join(''))
    expect(turn.text).toBe('One contract — the Acme MSA.')
    expect(turn.toolCalls).toEqual([
      { id: 'c1', name: 'contract_search', args: { query: 'Acme — “MSA”' }, result: '{"total":1}', ok: true },
      { id: 'w1', name: 'contract_update', args: { contractId: 'cm1', action: 'add_tag' },
        proposal: { preview: { summary: 'Add tag' }, reversible: true, source: 'lifecycle' } },
    ])
    expect(turn.done?.usage?.inputTokens).toBe(900)
    expect(turn.error).toBeNull()
  })

  it('prefers the validated answer, and keeps the error of a failed turn', () => {
    const turn = collect(frame({ type: 'token', delta: 'Cap is £1m [2].' }) + frame({ type: 'final', answer: 'Cap is £1m [1].' })
      + frame({ type: 'citations', citations: [{ ref: 1, quote: 'Liability is capped at £1m.', page: 7, verified: true }] }))
    expect(turn.text).toBe('Cap is £1m [1].')
    expect(turn.citations).toEqual([{ ref: 1, quote: 'Liability is capped at £1m.', page: 7, verified: true }])
    expect(collect(frame({ type: 'error', error: 'no provider' })).error).toBe('no provider')
  })

  it('survives a malformed frame and keepalive comments', () => {
    const turn = collect(': keepalive\n\ndata: {not json\n\n' + frame({ type: 'token', delta: 'ok' }))
    expect(turn.text).toBe('ok')
  })
})
