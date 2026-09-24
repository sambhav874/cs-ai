/**
 * Filters on nested JSON fields work on MongoDB, where Prisma's JSON path
 * filters fail validation: the contract list's SLA facets and the compliance
 * package's audit events that name a contract in their metadata.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from './prisma.js'
import { auditIdsForContract } from './json-field-filter.js'
import { getApp, closeApp, makeOrg, makeUser, makeContract, auth, cleanupAll, type TestApp } from '../test-support/helpers.js'

let app: TestApp
let org: string, other: string, owner: string, otherOwner: string
const ids: Record<string, string> = {}

async function contract(orgId: string, title: string, metadata: Record<string, unknown>) {
  const id = await makeContract(orgId, orgId === org ? owner : otherOwner, { title })
  await prisma.contract.update({ where: { id }, data: { metadata: metadata as never } })
  ids[title] = id
  return id
}

beforeAll(async () => {
  app = await getApp()
  org = await makeOrg('SLA Org')
  other = await makeOrg('Other Org')
  owner = await makeUser(org)
  otherOwner = await makeUser(other)
  await contract(org, 'OTD 92', { otdSlaPct: 92 })
  await contract(org, 'OTD 97', { otdSlaPct: 97, uptimeSlaPct: 99.5 })
  await contract(org, 'Uptime 99.9', { uptimeSlaPct: 99.9 })
  await contract(org, 'No SLA', {})
  await contract(other, 'Other OTD 90', { otdSlaPct: 90 })
})

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { orgId: { in: [org, other] } } }).catch(() => {})
  await cleanupAll()
  await closeApp()
})

const titles = async (q: string) => {
  const res = await app.inject({ method: 'GET', url: `/api/v1/contracts?${q}`, headers: auth(org, ['ADMIN'], owner) })
  expect(res.statusCode).toBe(200)
  return (res.json().data as Array<{ title: string }>).map(c => c.title).sort()
}

describe('contract list SLA facets', () => {
  it('filters by an upper bound', async () => {
    expect(await titles('otdMax=95')).toEqual(['OTD 92'])
  })

  it('filters by a range and combines fields', async () => {
    expect(await titles('otdMin=90&otdMax=100')).toEqual(['OTD 92', 'OTD 97'])
    expect(await titles('otdMin=95&uptimeSlaMin=99')).toEqual(['OTD 97'])
    expect(await titles('uptimeSlaMin=99.8')).toEqual(['Uptime 99.9'])
  })

  it('without a facet, lists everything', async () => {
    expect(await titles('')).toEqual(['No SLA', 'OTD 92', 'OTD 97', 'Uptime 99.9'])
  })
})

describe('audit events that name a contract', () => {
  it('finds events whose metadata carries the contract id, in this org only', async () => {
    const c = ids['OTD 92']
    const named = await prisma.auditEvent.create({
      data: { orgId: org, action: 'VERSION_CREATED', resourceType: 'version', resourceId: 'v1', metadata: { contractId: c } },
    })
    await prisma.auditEvent.create({
      data: { orgId: org, action: 'VERSION_CREATED', resourceType: 'version', resourceId: 'v2', metadata: { contractId: 'someone-else' } },
    })
    await prisma.auditEvent.create({
      data: { orgId: other, action: 'VERSION_CREATED', resourceType: 'version', resourceId: 'v3', metadata: { contractId: c } },
    })
    await prisma.auditEvent.create({
      data: { orgId: org, action: 'USER_LOGIN', resourceType: 'user', resourceId: owner, metadata: { contractId: c } },
    })
    expect(await auditIdsForContract(org, c, ['VERSION_CREATED'])).toEqual([named.id])
  })
})
