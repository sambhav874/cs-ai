import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ capped: false, usage: [] as unknown[][] }))
vi.mock('./costCap.js', async orig => {
  const real = await orig<typeof import('./costCap.js')>()
  return {
    ...real,
    assertCostCapNotExceeded: async () => { if (state.capped) throw new real.CostCapExceededError('o1', 12, 10, 'block') },
    recordUsage: async (...args: unknown[]) => { state.usage.push(args) },
  }
})

import { meteredJson } from './metered-agent.js'

afterEach(() => { vi.unstubAllGlobals(); state.capped = false; state.usage.length = 0 })

describe('meteredJson', () => {
  it('refuses before calling the model when the cap is reached', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    state.capped = true
    expect(await meteredJson('/assist', { a: 1 }, { orgId: 'o1', toolName: 'assist' }))
      .toEqual({ status: 'capped', usedUsd: 12, capUsd: 10 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('meters a call, including one that failed upstream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"completion":"hello"}', { status: 200 })))
    expect(await meteredJson('/complete', { x: 'y' }, { orgId: 'o1', toolName: 'autocomplete' }))
      .toEqual({ status: 'ok', data: { completion: 'hello' } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    expect((await meteredJson('/assist', {}, { orgId: 'o1', toolName: 'assist' })).status).toBe('failed')
    expect(state.usage.map(u => (u[2] as { toolName: string }).toolName)).toEqual(['autocomplete', 'assist'])
  })
})
