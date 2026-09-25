/**
 * portfolio_search carries the text, section and page of the passages
 * ContractSense's retrieval returns. Their ids are passage ids, not
 * contract_clauses rows, and every dense hit used to come back empty.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const passages = vi.hoisted(() => ({ hits: [] as unknown[] }))
vi.mock('../lib/embeddings.js', async orig => ({
  ...(await orig<typeof import('../lib/embeddings.js')>()),
  searchClauses: async () => passages.hits,
}))

import { getApp, closeApp, makeOrg, makeUser, makeContract, cleanupAll, type TestApp } from '../test-support/helpers.js'

let app: TestApp
let org: string, contractId: string
const SECRET = { 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET ?? '' }

beforeAll(async () => {
  app = await getApp()
  org = await makeOrg('Portfolio Org')
  const owner = await makeUser(org)
  contractId = await makeContract(org, owner, { title: 'FastFreight MSA' })
  passages.hits = [{
    contractId, versionId: '', clauseId: 'passage_abc', clauseType: 'Liability',
    content: 'Supplier shall have unlimited liability for any loss or damage.', similarity: 0.9, page: 3,
  }]
})

afterAll(async () => { await cleanupAll(); await closeApp() })

describe('portfolio_search', () => {
  it('returns the passage text, section and page for a ContractSense hit', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/internal/ai/tools/portfolio_search', headers: SECRET,
      payload: { orgId: org, query: 'unlimited liability', topK: 5 },
    })
    expect(res.statusCode).toBe(200)
    const hit = res.json().hits.find((h: { clauseId: string }) => h.clauseId === 'passage_abc')
    expect(hit).toMatchObject({
      contractId, contractTitle: 'FastFreight MSA', sectionRef: 'Liability', clauseType: 'Liability', page: 3,
    })
    expect(hit.excerpt).toContain('unlimited liability')
  })
})
