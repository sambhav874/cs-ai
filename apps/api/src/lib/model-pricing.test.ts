import { describe, expect, it } from 'vitest'
import { costForTokens, priceFor } from './model-pricing.js'
import { estimateCostUsd } from './costCap.js'

describe('costForTokens', () => {
  it('prices a turn at the model list price, not one blended rate', () => {
    // The cs2 turn: 58,505 in / 1,393 out on groq gpt-oss-120b.
    expect(costForTokens('openai/gpt-oss-120b', 58_505, 1_393)).toBe(0.009821)
    expect(estimateCostUsd((58_505 + 1_393) * 4, 1)).toBeGreaterThan(0.3)   // what it was billed
  })

  it('matches the most specific model name', () => {
    expect(priceFor('gpt-4.1-mini-2025-04-14')).toEqual({ input: 0.4, output: 1.6 })
    expect(priceFor('gpt-4.1')).toEqual({ input: 2, output: 8 })
    expect(priceFor('anthropic/claude-sonnet-4-5')).toEqual({ input: 3, output: 15 })
    expect(priceFor('gemini-2.5-flash-lite')).toEqual({ input: 0.1, output: 0.4 })
  })

  it('falls back to the conservative blended estimate for an unknown model', () => {
    expect(costForTokens('some-new-model', 1000, 100)).toBe(estimateCostUsd(1100 * 4, 1))
    expect(costForTokens(undefined, 1000, 100)).toBe(estimateCostUsd(1100 * 4, 1))
  })
})
