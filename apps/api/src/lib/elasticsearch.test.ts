import { afterEach, describe, expect, it, vi } from 'vitest'
import { es, esEnabled, indexContract, searchContracts } from './elasticsearch.js'

describe('Elasticsearch is optional', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('is off unless ELASTICSEARCH_URL is set', () => {
    vi.stubEnv('ELASTICSEARCH_URL', '')
    expect(esEnabled()).toBe(false)
    vi.stubEnv('ELASTICSEARCH_URL', 'http://es:9200')
    expect(esEnabled()).toBe(true)
  })

  it('writes nothing and reads fail fast when off', async () => {
    vi.stubEnv('ELASTICSEARCH_URL', '')
    const index = vi.spyOn(es, 'index')
    const search = vi.spyOn(es, 'search')
    await indexContract('c1', { orgId: 'o1', title: 't', type: 'NDA', status: 'DRAFT', plainText: '', tags: [], createdAt: new Date().toISOString() })
    await expect(searchContracts('o1', 'payment')).rejects.toThrow(/not configured/)
    expect(index).not.toHaveBeenCalled()
    expect(search).not.toHaveBeenCalled()
  })
})
