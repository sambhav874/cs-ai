/**
 * searchClauses now asks the intelligence tier (ContractSense's retrieval over
 * each contract's linked analysis copy) instead of pgvector, which cannot run
 * on MongoDB. The shape callers depend on must not change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
vi.mock('./prisma.js', () => ({ prisma: { contract: { findMany: (...a: unknown[]) => findMany(...a) } } }))

const { searchClauses } = await import('./embeddings.js')

const hit = (id: string, score: number, extra: Record<string, unknown> = {}) => ({
  platformContractId: id, passageId: `p-${id}`, section: '12. Termination', page: 4,
  quote: `quote ${id}`, context: `context ${id}`, score, ...extra,
})

describe('searchClauses (via the intelligence tier)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    process.env.INTELLIGENCE_URL = 'http://intelligence:8000/'
    process.env.INTERNAL_SERVICE_SECRET = 's3cret'
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    findMany.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('maps hits onto ClauseMatch, pinned to each contract’s current version', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ hits: [hit('c1', 87), hit('c2', 150)] })))
    findMany.mockResolvedValue([{ id: 'c1', currentVersionId: 'v1' }, { id: 'c2', currentVersionId: 'v2' }])

    const out = await searchClauses('notice to terminate', 'org1', 5)
    expect(out).toEqual([
      { contractId: 'c1', versionId: 'v1', clauseId: 'p-c1', clauseType: '12. Termination', content: 'quote c1', similarity: 0.87, page: 4 },
      { contractId: 'c2', versionId: 'v2', clauseId: 'p-c2', clauseType: '12. Termination', content: 'quote c2', similarity: 1, page: 4 },
    ])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://intelligence:8000/internal/retrieval/search')
    expect((init.headers as Record<string, string>)['x-internal-secret']).toBe('s3cret')
    expect(JSON.parse(init.body as string)).toEqual({ org_id: 'org1', query: 'notice to terminate', limit: 5 })
  })

  it('scopes to one contract when asked', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ hits: [] })))
    await searchClauses('q', 'org1', 8, 'c9')
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string).platform_contract_ids).toEqual(['c9'])
  })

  it('drops hits for contracts outside the org or deleted', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ hits: [hit('mine', 80), hit('elsewhere', 95)] })))
    findMany.mockResolvedValue([{ id: 'mine', currentVersionId: 'v1' }])
    const out = await searchClauses('q', 'org1')
    expect(out.map(m => m.contractId)).toEqual(['mine'])
    expect(findMany.mock.calls[0][0].where).toMatchObject({ orgId: 'org1', deletedAt: null })
  })

  it('falls back to the context when there is no quote', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ hits: [hit('c1', 60, { quote: '' })] })))
    findMany.mockResolvedValue([{ id: 'c1', currentVersionId: null }])
    const [m] = await searchClauses('q', 'org1')
    expect(m.content).toBe('context c1')
    expect(m.versionId).toBe('')
  })

  it('returns nothing without touching the database when there are no hits', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ hits: [] })))
    expect(await searchClauses('q', 'org1')).toEqual([])
    expect(findMany).not.toHaveBeenCalled()
  })

  it('throws when the tier is down, so callers fall back to keyword search', async () => {
    fetchMock.mockResolvedValue(new Response('down', { status: 503 }))
    await expect(searchClauses('q', 'org1')).rejects.toThrow(/503/)
  })
})
