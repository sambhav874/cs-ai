/**
 * contract_search finds a contract by its name as a person types it, and does
 * not pass a content match off as the named contract.
 *
 * Found live on cs2: "Acme Corporation Master Services Agreement" matched no
 * title as a phrase, so the content search answered with "Acme Retail Ltd –
 * FastFreight Ltd Master Services Agreement", and the assistant quoted that
 * contract as the Acme Corp MSA.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const passages = vi.hoisted(() => ({ hits: [] as unknown[] }))
vi.mock('../lib/embeddings.js', async orig => ({
  ...(await orig<typeof import('../lib/embeddings.js')>()),
  searchClauses: async () => passages.hits,
}))

import { prisma } from '../lib/prisma.js'
import { getApp, closeApp, makeOrg, makeUser, makeContract, cleanupAll, type TestApp } from '../test-support/helpers.js'
import { nameWords } from './internal-ai.js'

let app: TestApp
let org: string, acmeCorp: string, acmeRetail: string
const SECRET = { 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET ?? '' }

const search = (payload: Record<string, unknown>) => app.inject({
  method: 'POST', url: '/api/internal/ai/tools/contract_search', headers: SECRET, payload: { orgId: org, ...payload },
})

beforeAll(async () => {
  app = await getApp()
  org = await makeOrg('Search Org')
  const owner = await makeUser(org)
  acmeCorp = await makeContract(org, owner, { title: 'Acme Corp — Master Services Agreement', type: 'MSA', status: 'EXECUTED' })
  acmeRetail = await makeContract(org, owner, { title: 'Acme Retail Ltd – FastFreight Ltd Master Services Agreement', type: 'MSA' })
  await prisma.contract.update({ where: { id: acmeCorp }, data: { counterpartyName: 'Acme Corporation' } })
  await prisma.contract.update({ where: { id: acmeRetail }, data: { counterpartyName: 'Acme Retail Ltd' } })
  passages.hits = [{ contractId: acmeRetail, versionId: '', clauseId: 'p1', clauseType: 'passage', content: 'Master services', similarity: 0.8 }]
})

afterAll(async () => { await cleanupAll(); await closeApp() })

describe('contract_search', () => {
  it('finds a contract by the words of its name across title and counterparty', async () => {
    const res = await search({ query: 'Acme Corporation Master Services Agreement', type: 'MSA' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.results.map((c: { id: string }) => c.id)).toEqual([acmeCorp])
    expect(body.searchMode).toBeUndefined()
    expect(body.totalMatching).toBe(1)
  })

  it('says plainly when nothing matched the name and results are content matches', async () => {
    const res = await search({ query: 'Initech Software Licence' })
    const body = res.json()
    expect(body.searchMode).toBe('semantic-fallback')
    expect(body.note).toMatch(/NO contract matched this name/)
    expect(body.totalMatching).toBeNull()
  })

  it('matches on the words that carry the name', () => {
    expect(nameWords('the Acme Corporation Master Services Agreement')).toEqual(['acme', 'corporation', 'master', 'services'])
    expect(nameWords('Globex — NDA')).toEqual(['globex', 'nda'])
  })
})
