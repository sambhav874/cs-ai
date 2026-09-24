import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./prisma.js', () => ({ prisma: {} }))
vi.mock('./costCap.js', () => ({ assertCostCapNotExceeded: async () => {} }))

import { __internal, parseModelRef } from './aiRouter.js'

describe('parseModelRef', () => {
  it('splits on the first slash only', () => {
    expect(parseModelRef('groq/openai/gpt-oss-120b')).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b' })
    expect(parseModelRef('anthropic/claude-sonnet-4-6')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' })
  })

  it('rejects a ref without both parts', () => {
    expect(parseModelRef('groq')).toBeNull()
    expect(parseModelRef('/gpt')).toBeNull()
    expect(parseModelRef('groq/')).toBeNull()
  })
})

describe('Groq', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('reads the platform key from GROQ_API_KEY', () => {
    vi.stubEnv('GROQ_API_KEY', 'gsk_test')
    expect(__internal.platformKey('groq')).toBe('gsk_test')
    vi.stubEnv('GROQ_API_KEY', 'placeholder')
    expect(__internal.platformKey('groq')).toBeUndefined()
  })

  it('is a candidate for every chat tier, after the first-party providers', () => {
    for (const tier of ['reasoning', 'default', 'fast'] as const) {
      const list = __internal.PLATFORM_TIER_DEFAULTS[tier]
      const first = list.findIndex(c => c.provider === 'groq')
      expect(first, tier).toBeGreaterThan(0)
      expect(list.slice(first).every(c => c.provider === 'groq'), tier).toBe(true)
    }
  })
})
