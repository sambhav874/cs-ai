/**
 * Cross-org isolation — the load-bearing multi-tenant invariant. A principal in
 * one org must never read another org's data, by list OR by direct id.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getApp, closeApp, makeOrg, makeUser, makeContract, auth, cleanupAll, type TestApp } from '../test-support/helpers.js'

let app: TestApp
let orgA: string, orgB: string, ownerA: string, contractA: string

beforeAll(async () => {
  app = await getApp()
  orgA = await makeOrg('Org A')
  orgB = await makeOrg('Org B')
  ownerA = await makeUser(orgA)
  contractA = await makeContract(orgA, ownerA, { title: 'Org A Secret NDA' })
})

afterAll(async () => {
  await cleanupAll()
  await closeApp()
})

describe('cross-org isolation (contracts)', () => {
  it('serves the contract to its owning org', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/v1/contracts/${contractA}`, headers: auth(orgA, ['ADMIN']),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(contractA)
  })

  it('does NOT serve the contract to a different org (404, not 200)', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/v1/contracts/${contractA}`, headers: auth(orgB, ['ADMIN']),
    })
    expect(res.statusCode).toBe(404)
  })

  it('does NOT leak the other org\'s contract in the list', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/contracts', headers: auth(orgB, ['ADMIN']),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as Record<string, unknown>
    const items = (Array.isArray(body) ? body : (body.data ?? body.contracts ?? [])) as Array<{ id: string }>
    expect(items.map(c => c.id)).not.toContain(contractA)
  })

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/contracts/${contractA}` })
    expect(res.statusCode).toBe(401)
  })
})
