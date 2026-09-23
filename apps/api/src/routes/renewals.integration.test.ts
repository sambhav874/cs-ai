/**
 * Renewals on MongoDB run on the date that binds: the notice deadline of a
 * contract that may renew itself, from its key terms or, failing those, its
 * extracted renewal obligation — not the expiry date.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const notifications = vi.hoisted(() => [] as Array<{ title: string; body: string; resourceId?: string; userId: string }>)
vi.mock('../lib/queue.js', async orig => ({
  ...(await orig<typeof import('../lib/queue.js')>()),
  queueNotification: (job: (typeof notifications)[number]) => { notifications.push(job) },
}))

import { prisma } from '../lib/prisma.js'
import { scanObligations, scanRenewals } from '../lib/obligation-scanner.js'
import { getApp, closeApp, makeOrg, makeUser, makeContract, auth, cleanupAll, type TestApp } from '../test-support/helpers.js'

let app: TestApp
let org: string, owner: string
const ids: Record<string, string> = {}

const DAY = 24 * 60 * 60 * 1000
const inDays = (n: number) => new Date(Date.now() + n * DAY)

async function contract(name: string, expiryIn: number, keyTerms: Record<string, unknown>, metadata: Record<string, unknown> = {}) {
  const id = await makeContract(org, owner, { title: name, status: 'EXECUTED' })
  await prisma.contract.update({ where: { id }, data: { expiryDate: inDays(expiryIn), keyTerms: keyTerms as never, metadata: metadata as never } })
  ids[name] = id
  return id
}

beforeAll(async () => {
  app = await getApp()
  org = await makeOrg('Renewals Org')
  owner = await makeUser(org)

  // Expires in 102d, 90 days' notice: notice due in ~12d.
  await contract('A auto 90', 102, { autoRenew: true, noticePeriodDays: 90 })
  // Does not renew: expiry is the date.
  await contract('B fixed term', 20, { autoRenew: false, noticePeriodDays: 90 })
  // Expires beyond the year, but its notice (from the obligation) falls inside it.
  const c = await contract('C obligation notice', 400, { autoRenew: true })
  await prisma.obligation.create({
    data: {
      orgId: org, contractId: c, type: 'renewal', description: 'Notice of non-renewal',
      source: 'contractsense', status: 'OPEN', quote: 'Either party may give sixty (60) days notice of non-renewal.',
      terms: { operator: 'no_later_than', value: 60, unit: 'days', tiers: [], exceptions: [] } as never,
    },
  })
  // Notice falls due after the window: not listed.
  await contract('D far', 500, { autoRenew: true, noticePeriodDays: 30 })
  // Notice deadline passed 50 days ago; expires in 40.
  await contract('E missed', 40, { autoRenew: true, noticePeriod: '90 days' })
  // Due soon but already decided.
  await contract('F decided', 10, {}, { renewalDecision: 'renew' })
})

afterAll(async () => {
  await prisma.userRole.deleteMany({ where: { user: { orgId: org } } }).catch(() => {})
  await prisma.role.deleteMany({ where: { orgId: org } }).catch(() => {})
  await cleanupAll()
  await closeApp()
})

const list = (q = '') => app.inject({ method: 'GET', url: `/api/v1/renewals${q}`, headers: auth(org, ['ADMIN'], owner) })

describe('renewals list', () => {
  it('keeps contracts by the date that binds, soonest first', async () => {
    const res = await list()
    expect(res.statusCode).toBe(200)
    const titles = res.json().data.map((r: { title: string }) => r.title)
    expect(titles).toEqual(['E missed', 'F decided', 'A auto 90', 'B fixed term', 'C obligation notice'])
  })

  it('returns the resolved terms', async () => {
    const rows = (await list()).json().data as Array<{ title: string; renewal: Record<string, unknown>; expiryDate: string }>
    const a = rows.find(r => r.title === 'A auto 90')!
    expect(a.renewal).toMatchObject({ autoRenew: true, noticeDays: 90, noticeSource: 'key_terms' })
    expect(a.renewal.actBy).toBe(a.renewal.noticeDeadline)
    const b = rows.find(r => r.title === 'B fixed term')!
    expect(b.renewal).toMatchObject({ autoRenew: false, noticeDeadline: null, actBy: b.expiryDate })
    const c = rows.find(r => r.title === 'C obligation notice')!
    expect(c.renewal).toMatchObject({ noticeDays: 60, noticeSource: 'obligation' })
  })

  it('buckets by the notice deadline, not expiry', async () => {
    const next30 = (await list('?bucket=next_30')).json().data.map((r: { title: string }) => r.title)
    expect(next30).toEqual(['F decided', 'A auto 90', 'B fixed term'])
    const overdue = (await list('?bucket=overdue')).json().data.map((r: { title: string }) => r.title)
    expect(overdue).toEqual(['E missed'])
  })

  it('stats count the same way', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/renewals/stats', headers: auth(org, ['ADMIN'], owner) })
    expect(res.json()).toMatchObject({ overdue: 1, next30: 3, next90: 3, undecided: 2, noticeNext30: 1 })
  })

  it('the CSV carries the notice columns', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/renewals/export', headers: auth(org, ['ADMIN'], owner) })
    expect(res.statusCode).toBe(200)
    const [header, ...lines] = res.body.trim().split('\n')
    expect(header).toContain('Notice Deadline')
    expect(header).toContain('Act By')
    expect(lines.find(l => l.includes('A auto 90'))).toContain(',yes,90,')
  })
})

describe('renewal scanner', () => {
  it('reminds inside the notice window and skips decided contracts', async () => {
    notifications.length = 0
    const res = await scanRenewals({ orgId: org, leadDays: 30 })
    expect(res).toMatchObject({ candidates: 4, notified: 3, skippedDecided: 1, errors: [] })
    const byId = Object.fromEntries(notifications.map(n => [n.resourceId, n]))
    expect(byId[ids['A auto 90']].title).toMatch(/^Notice due in \d+d · A auto 90$/)
    expect(byId[ids['A auto 90']].userId).toBe(owner)
    expect(byId[ids['E missed']].title).toMatch(/^Notice deadline passed \d+d ago · E missed$/)
    expect(byId[ids['B fixed term']].title).toMatch(/^Expires in \d+d · B fixed term$/)
    expect(byId[ids['C obligation notice']]).toBeUndefined()
  })

  it('does not repeat inside the cooldown', async () => {
    notifications.length = 0
    const res = await scanRenewals({ orgId: org, leadDays: 30 })
    expect(res).toMatchObject({ notified: 0, skippedCooldown: 3 })
    expect(notifications).toHaveLength(0)
  })

  it('a deactivated owner does not swallow the reminder', async () => {
    await prisma.user.update({ where: { id: owner }, data: { status: 'DEACTIVATED' } })
    const admin = await makeUser(org)
    const role = await prisma.role.create({ data: { orgId: org, name: 'ADMIN' } })
    await prisma.userRole.create({ data: { userId: admin, roleId: role.id } })
    notifications.length = 0
    const res = await scanRenewals({ orgId: org, leadDays: 30, force: true })
    expect(res.notified).toBe(3)
    expect(notifications.every(n => n.userId === admin)).toBe(true)
    await prisma.user.update({ where: { id: owner }, data: { status: 'ACTIVE' } })
  })
})

describe('obligation scanner', () => {
  it('writes the overdue audit event once per obligation', async () => {
    const ob = await prisma.obligation.create({
      data: {
        orgId: org, contractId: ids['A auto 90'], type: 'report', description: 'Monthly KPI report',
        status: 'OPEN', quote: 'Supplier shall deliver a monthly KPI report.', dueDate: inDays(-2),
      },
    })
    const first = await scanObligations({ orgId: org })
    expect(first.errors).toEqual([])
    await scanObligations({ orgId: org, force: true })
    const events = await prisma.auditEvent.findMany({ where: { orgId: org, action: 'OBLIGATION_OVERDUE' } })
    expect(events.filter(e => (e.metadata as { obligationId?: string }).obligationId === ob.id)).toHaveLength(1)
  })
})
