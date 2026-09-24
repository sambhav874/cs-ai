/**
 * The admin screen names the model each tier actually uses: the first
 * candidate with a key, the org's own or the platform's, or the org's pin.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { prisma } from './prisma.js'
import { effectiveRouting } from './aiRouter.js'
import { getApp, closeApp, makeOrg, cleanupAll } from '../test-support/helpers.js'

let org: string

beforeAll(async () => {
  await getApp()
  org = await makeOrg('Routing Org')
})

afterEach(() => { vi.unstubAllEnvs() })

afterAll(async () => {
  await prisma.orgAiKey.deleteMany({ where: { orgId: org } }).catch(() => {})
  await prisma.orgAiSettings.deleteMany({ where: { orgId: org } }).catch(() => {})
  await cleanupAll()
  await closeApp()
})

const noPlatformKeys = () => {
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY', 'VOYAGE_API_KEY', 'COHERE_API_KEY', 'MISTRAL_API_KEY', 'GROQ_API_KEY']) vi.stubEnv(k, '')
}

describe('effectiveRouting', () => {
  it('with only a platform Groq key, the chat tiers use Groq and the rest have none', async () => {
    noPlatformKeys()
    vi.stubEnv('GROQ_API_KEY', 'gsk_platform')
    const r = await effectiveRouting(org)
    expect(r.tiers.default).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b', source: 'platform' })
    expect(r.tiers.fast).toEqual({ provider: 'groq', model: 'openai/gpt-oss-20b', source: 'platform' })
    expect(r.tiers.embed).toBeNull()
    expect(r.keyedProviders).toEqual(['groq'])
  })

  it("the org's own key wins its place in the order, and a pin is used as is", async () => {
    noPlatformKeys()
    vi.stubEnv('GROQ_API_KEY', 'gsk_platform')
    await prisma.orgAiKey.create({ data: { orgId: org, provider: 'openai', encryptedKey: 'x', keyPrefix: 'sk-', isActive: true, createdById: 'u1' } })
    await prisma.orgAiSettings.create({ data: { orgId: org, fastModel: 'groq/qwen/qwen3.8-27b' } })
    const r = await effectiveRouting(org)
    expect(r.tiers.default).toEqual({ provider: 'openai', model: 'gpt-4.1', source: 'byok' })
    expect(r.tiers.fast).toEqual({ provider: 'groq', model: 'qwen/qwen3.8-27b', source: 'platform' })
    expect(r.keyedProviders.sort()).toEqual(['groq', 'openai'])
  })
})
