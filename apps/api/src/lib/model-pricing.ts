/**
 * What a call cost, from the tokens the provider reported and the model's
 * list price.
 *
 * Chat turns report real token counts, but they were priced at the one blended
 * rate `estimateCostUsd` uses ($5 per million tokens, roughly Sonnet). On cs2
 * that billed a groq gpt-oss-120b turn (~58k input tokens) at ~$0.30 against
 * the org's daily cap, about 25× its list price, so a busy org would hit a
 * $50 cap after ~170 questions. Prices are list prices in USD per million
 * tokens; a model not listed falls back to the blended rate, which
 * over-counts rather than under-counts.
 */
import { estimateCostUsd } from './costCap.js'

type Price = { input: number; output: number }

// Longest matching prefix wins, so 'gpt-4.1-mini' beats 'gpt-4.1'.
const PRICES: Array<[string, Price]> = [
  // Anthropic
  ['claude-opus', { input: 15, output: 75 }],
  ['claude-sonnet', { input: 3, output: 15 }],
  ['claude-haiku', { input: 1, output: 5 }],
  ['claude-3-5-haiku', { input: 0.8, output: 4 }],
  // OpenAI
  ['gpt-5-nano', { input: 0.05, output: 0.4 }],
  ['gpt-5-mini', { input: 0.25, output: 2 }],
  ['gpt-5', { input: 1.25, output: 10 }],
  ['gpt-4.1-nano', { input: 0.1, output: 0.4 }],
  ['gpt-4.1-mini', { input: 0.4, output: 1.6 }],
  ['gpt-4.1', { input: 2, output: 8 }],
  ['gpt-4o-mini', { input: 0.15, output: 0.6 }],
  ['gpt-4o', { input: 2.5, output: 10 }],
  // Open-weight models (groq)
  ['openai/gpt-oss-120b', { input: 0.15, output: 0.75 }],
  ['openai/gpt-oss-20b', { input: 0.1, output: 0.5 }],
  ['llama-3.3-70b', { input: 0.59, output: 0.79 }],
  ['llama-3.1-8b', { input: 0.05, output: 0.08 }],
  // Google
  ['gemini-2.5-pro', { input: 1.25, output: 10 }],
  ['gemini-2.5-flash-lite', { input: 0.1, output: 0.4 }],
  ['gemini-2.5-flash', { input: 0.3, output: 2.5 }],
]

export function priceFor(model: string | null | undefined): Price | null {
  const id = (model ?? '').toLowerCase().replace(/^(anthropic|openai|google|groq)\/(?=(claude|gpt-[45]|gemini|llama))/, '')
  let best: [string, Price] | null = null
  for (const entry of PRICES) {
    if (id.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry
  }
  return best ? best[1] : null
}

/** USD for one call's tokens. Unknown models use the blended estimate. */
export function costForTokens(model: string | null | undefined, inputTokens: number, outputTokens: number): number {
  const price = priceFor(model)
  if (!price) return estimateCostUsd((inputTokens + outputTokens) * 4, 1)
  const usd = (inputTokens * price.input + outputTokens * price.output) / 1_000_000
  return Math.round(usd * 1_000_000) / 1_000_000
}
