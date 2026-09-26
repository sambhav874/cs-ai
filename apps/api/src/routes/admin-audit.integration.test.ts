/**
 * Admin → Audit log reads the org's own events, filtered and paged, exports
 * them as CSV and verifies the hash chain. The route was an empty stub, so
 * nothing in the product could show the log the release gate relies on.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { AuditAction } from '@clm/types'
import { createAuditEvent } from '../lib/audit.js'
import { getApp, closeApp, makeOrg, makeUser, auth, cleanupAll, type TestApp } from '../test-support/helpers.js'

let app: TestApp
let org: string, other: string, alice: string

const get = (url: string, orgId = org, roles = ['ADMIN']) =>
  app.inject({ method: 'GET', url: `/api/v1/admin/audit${url}`, headers: auth(orgId, roles) })

beforeAll(async () => {
  app = await getApp()
  org = await makeOrg('Audit Org')
  other = await makeOrg('Audit Other Org')
  alice = await makeUser(org)
  for (let i = 0; i < 5; i++) {
    await createAuditEvent({ orgId: org, userId: alice, action: AuditAction.CONTRACT_UPDATED, resourceType: 'contract', resourceId: `c${i}`, metadata: { i } })
  }
  await createAuditEvent({ orgId: org, action: AuditAction.CONTRACT_CREATED, resourceType: 'contract', resourceId: 'c9', metadata: { note: '=HYPERLINK("x")' } })
  await createAuditEvent({ orgId: other, action: AuditAction.CONTRACT_CREATED, resourceType: 'contract', resourceId: 'foreign', metadata: {} })
})

afterAll(async () => { await cleanupAll(); await closeApp() })

describe('GET /admin/audit', () => {
  it('lists only this org\'s events, newest first, with the actor resolved', async () => {
    const res = await get('')
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(data).toHaveLength(6)
    expect(data[0].resourceId).toBe('c9')
    expect(data[0].actor).toBeNull()
    expect(data[1].actor.id).toBe(alice)
    expect(data.map((r: { resourceId: string }) => r.resourceId)).not.toContain('foreign')
  })

  it('pages by cursor without repeating or skipping a row', async () => {
    const first = (await get('?limit=4')).json()
    expect(first.data).toHaveLength(4)
    const second = (await get(`?limit=4&cursor=${first.nextCursor}`)).json()
    expect(second.data).toHaveLength(2)
    expect(second.nextCursor).toBeNull()
    const ids = [...first.data, ...second.data].map((r: { id: string }) => r.id)
    expect(new Set(ids).size).toBe(6)
  })

  it('filters by action and user', async () => {
    expect((await get('?action=CONTRACT_CREATED')).json().data).toHaveLength(1)
    expect((await get(`?userId=${alice}`)).json().data).toHaveLength(5)
  })

  it('is admin-only', async () => {
    expect((await get('', org, ['VIEWER'])).statusCode).toBe(403)
  })
})

describe('GET /admin/audit/export and /verify', () => {
  it('exports CSV with formula cells neutralised', async () => {
    const res = await get('/export')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    const lines = res.body.split('\n')
    expect(lines[0]).toMatch(/^createdAt,action,resourceType/)
    expect(lines).toHaveLength(7)
    expect(res.body).not.toMatch(/,=HYPERLINK/)
  })

  it('verifies the org\'s hash chain', async () => {
    const res = await get('/verify')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, total: 6 })
  })
})
