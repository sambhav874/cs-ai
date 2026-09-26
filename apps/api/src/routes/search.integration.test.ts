/**
 * Contract search and filter facets run on MongoDB, with no search index.
 *
 * Before this, the Contracts page sent every typed search, clause-flag and
 * jurisdiction filter to Elasticsearch; without ES (the merged stack does not
 * run it) those answered 500 "Search unavailable" and the facets were empty.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '../lib/prisma.js'
import { getApp, closeApp, makeOrg, makeUser, makeContract, auth, cleanupAll, type TestApp } from '../test-support/helpers.js'

let app: TestApp
let org: string, other: string
let acme: string, globex: string, initech: string, foreign: string

async function withVersion(contractId: string, plainText: string, clauseFlags: Record<string, boolean> = {}) {
  const v = await prisma.contractVersion.create({
    data: { contractId, versionNumber: 1, plainText, clauseFlags, createdById: 'it' } as never,
    select: { id: true },
  })
  await prisma.contract.update({ where: { id: contractId }, data: { currentVersionId: v.id } })
}

const advanced = (payload: Record<string, unknown>, orgId = org) => app.inject({
  method: 'POST', url: '/api/v1/search/advanced', headers: auth(orgId), payload: { mode: 'keyword', ...payload },
})

beforeAll(async () => {
  app = await getApp()
  org = await makeOrg('Search Route Org')
  other = await makeOrg('Search Route Other Org')
  const owner = await makeUser(org)
  acme = await makeContract(org, owner, { title: 'Acme Corp — Master Services Agreement', type: 'MSA', status: 'EXECUTED' })
  globex = await makeContract(org, owner, { title: 'Globex Mutual NDA', type: 'NDA' })
  initech = await makeContract(org, owner, { title: 'Initech Logistics Agreement', type: 'MSA' })
  foreign = await makeContract(other, await makeUser(other), { title: 'Acme Corp — Master Services Agreement', type: 'MSA' })

  await prisma.contract.update({ where: { id: acme }, data: { counterpartyName: 'Acme Corporation', jurisdiction: 'England and Wales', riskScore: 80 } })
  await prisma.contract.update({ where: { id: globex }, data: { counterpartyName: 'Globex Inc', jurisdiction: 'Delaware', riskScore: 20 } })
  await prisma.contract.update({ where: { id: initech }, data: { counterpartyName: 'Initech', riskScore: 50, expiryDate: new Date(Date.now() + 20 * 86_400_000) } })

  await withVersion(acme, 'The Supplier shall provide the Services. Force majeure relieves either party.', { forceMajeure: true })
  await withVersion(globex, 'Each party keeps the other party\'s information confidential.')
  await withVersion(initech, 'The Carrier shall deliver the goods. Liability is capped at the annual fees.', { limitationOfLiability: true, forceMajeure: true })
})

afterAll(async () => { await cleanupAll(); await closeApp() })

describe('POST /search/advanced (keyword)', () => {
  it('ranks a title match first and never returns another org\'s contract', async () => {
    const res = await advanced({ q: 'Acme' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.map((c: { id: string }) => c.id)).toEqual([acme])
    expect(body.source).toBe('mongo')
    expect(body.data.map((c: { id: string }) => c.id)).not.toContain(foreign)
  })

  it('finds a phrase in the document text and says where it matched', async () => {
    const body = (await advanced({ q: 'capped at the annual fees' })).json()
    expect(body.data.map((c: { id: string }) => c.id)).toEqual([initech])
    expect(body.highlights[initech].plainText[0]).toMatch(/<em>capped at the annual fees<\/em>/)
  })

  it('matches every word of a name spread across title and counterparty', async () => {
    const body = (await advanced({ q: 'Acme Corporation Master Services' })).json()
    expect(body.data.map((c: { id: string }) => c.id)).toEqual([acme])
  })

  it('filters by clause flag, jurisdiction and risk without a query', async () => {
    const flags = (await advanced({ clauseFlags: { forceMajeure: true } })).json()
    expect(flags.data.map((c: { id: string }) => c.id).sort()).toEqual([acme, initech].sort())
    expect(flags.total).toBe(2)

    const both = (await advanced({ clauseFlags: { forceMajeure: true, limitationOfLiability: true } })).json()
    expect(both.data.map((c: { id: string }) => c.id)).toEqual([initech])

    const jur = (await advanced({ jurisdiction: 'delaware' })).json()
    expect(jur.data.map((c: { id: string }) => c.id)).toEqual([globex])

    const unknown = (await advanced({ jurisdiction: 'Unknown' })).json()
    expect(unknown.data.map((c: { id: string }) => c.id)).toEqual([initech])

    const high = (await advanced({ riskScoreMin: 67 })).json()
    expect(high.data.map((c: { id: string }) => c.id)).toEqual([acme])
  })

  it('combines a query with filters', async () => {
    const body = (await advanced({ q: 'shall', clauseFlags: { limitationOfLiability: true } })).json()
    expect(body.data.map((c: { id: string }) => c.id)).toEqual([initech])
  })
})

describe('GET /search/facets', () => {
  it('counts the org\'s live contracts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/search/facets', headers: auth(org) })
    expect(res.statusCode).toBe(200)
    const f = res.json()
    expect(f.total).toBe(3)
    expect(f.types).toEqual([{ key: 'MSA', doc_count: 2 }, { key: 'NDA', doc_count: 1 }])
    expect(f.jurisdictions).toContainEqual({ key: 'Unknown', doc_count: 1 })
    expect(f.riskRanges).toEqual([
      { key: 'low', doc_count: 1 }, { key: 'medium', doc_count: 1 }, { key: 'high', doc_count: 1 },
    ])
    expect(f.expiringSoon[0]).toEqual({ key: '30d', doc_count: 1 })
    expect(f.clauseFlags.forceMajeure).toBe(2)
    expect(f.clauseFlags.limitationOfLiability).toBe(1)
  })
})
