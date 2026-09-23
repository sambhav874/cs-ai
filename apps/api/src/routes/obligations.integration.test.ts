/**
 * The obligation register on MongoDB: the intelligence tier's sync, person-
 * owned fields surviving a re-sync, assignment, the default due-date order
 * (which used `nulls: 'last'`, a relational-only Prisma feature), and scope.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '../lib/prisma.js'
import { getApp, closeApp, makeOrg, makeUser, makeContract, auth, cleanupAll, type TestApp } from '../test-support/helpers.js'

let app: TestApp
let org: string, otherOrg: string, owner: string, assignee: string, rep: string, contract: string, repContract: string

const SECRET = { 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET ?? '' }

const record = (externalId: string, over: Record<string, unknown> = {}) => ({
  externalId, name: 'On-time delivery', description: `Obligation ${externalId}`, kpiType: 'sla',
  partyRole: 'supplier', frequency: 'monthly', quote: 'Critical Lane On-Time Delivery below 95.0% in any month.',
  page: 3, section: 'Section 9.01', needsReview: false, packId: 'logistics', packVersion: '1.0.0', ...over,
})

const sync = (records: unknown[] | null, over: Record<string, unknown> = {}) => app.inject({
  method: 'POST', url: '/api/internal/obligations/sync', headers: SECRET,
  payload: {
    platformContractId: contract, status: 'success', runId: 'run-1',
    ledger: { total: 4, extracted: 3, rejected: 0, lost: 1, quarantined: 0 },
    records, ...over,
  },
})

beforeAll(async () => {
  app = await getApp()
  org = await makeOrg('Obligations Org')
  otherOrg = await makeOrg('Other Org')
  owner = await makeUser(org)
  assignee = await makeUser(org)
  rep = await makeUser(org)
  contract = await makeContract(org, owner, { title: 'Logistics MSA', status: 'EXECUTED' })
  repContract = await makeContract(org, rep, { title: 'Rep NDA', status: 'EXECUTED' })
})

afterAll(async () => {
  await cleanupAll()
  await closeApp()
})

describe('internal obligation sync', () => {
  it('refuses a caller without the internal secret', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/internal/obligations/sync', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('creates rows and records the run on the contract', async () => {
    const res = await sync([record('k1'), record('k2'), record('k3', { page: null })])
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ created: 3, updated: 0, deleted: 0, flagged: 0 })

    const rows = await prisma.obligation.findMany({ where: { contractId: contract } })
    expect(rows).toHaveLength(3)
    expect(rows.every(r => r.source === 'contractsense' && r.owner === 'provider' && r.orgId === org)).toBe(true)

    const c = await prisma.contract.findUnique({ where: { id: contract }, select: { metadata: true } })
    const run = (c!.metadata as Record<string, any>).obligationExtraction
    expect(run.status).toBe('success')
    expect(run.ledger.lost).toBe(1)
  })

  it('a re-sync keeps what a person set and drops only untouched vanished rows', async () => {
    const k1 = await prisma.obligation.findFirstOrThrow({ where: { contractId: contract, externalId: 'k1' } })
    const k2 = await prisma.obligation.findFirstOrThrow({ where: { contractId: contract, externalId: 'k2' } })
    const due = '2027-01-15T00:00:00.000Z'
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/obligations/${k1.id}`, headers: auth(org, ['ADMIN'], owner),
      payload: { assigneeId: assignee, dueDate: due },
    })
    expect(patch.statusCode).toBe(200)
    await app.inject({
      method: 'PATCH', url: `/api/v1/obligations/${k2.id}`, headers: auth(org, ['ADMIN'], owner),
      payload: { assigneeId: assignee },
    })

    // k1 re-extracted with new wording; k2 and k3 gone; k4 new.
    const res = await sync([record('k1', { description: 'Reworded' }), record('k4')])
    expect(res.json()).toMatchObject({ created: 1, updated: 1, deleted: 1, flagged: 1 })

    const after = await prisma.obligation.findUniqueOrThrow({ where: { id: k1.id } })
    expect(after.description).toBe('Reworded')
    expect(after.assigneeId).toBe(assignee)
    expect(after.dueDate?.toISOString()).toBe(due)
    const k2After = await prisma.obligation.findUniqueOrThrow({ where: { id: k2.id } })
    expect(k2After.needsReview).toBe(true)
  })

  it('an error run keeps the register and the last ledger', async () => {
    const before = await prisma.obligation.count({ where: { contractId: contract } })
    const res = await sync(null, { status: 'error', error: 'No provider configured', ledger: null })
    expect(res.statusCode).toBe(200)
    expect(await prisma.obligation.count({ where: { contractId: contract } })).toBe(before)
    const c = await prisma.contract.findUnique({ where: { id: contract }, select: { metadata: true } })
    const run = (c!.metadata as Record<string, any>).obligationExtraction
    expect(run).toMatchObject({ status: 'error', error: 'No provider configured' })
    expect(run.ledger.lost).toBe(1)
  })

  it('404s for an unknown contract rather than writing an orphan', async () => {
    const res = await sync([record('x')], { platformContractId: 'no-such-contract' })
    expect(res.statusCode).toBe(404)
  })
})

describe('obligations list and assignment', () => {
  it('lists with the default due-date sort on MongoDB, dated rows first', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/obligations?contractId=${contract}`, headers: auth(org, ['ADMIN'], owner) })
    expect(res.statusCode).toBe(200)
    const rows = res.json().data as Array<{ dueDate: string | null }>
    expect(rows.length).toBeGreaterThan(1)
    expect(rows[0].dueDate).not.toBeNull()
    expect(rows[rows.length - 1].dueDate).toBeNull()
  })

  it('bulk-assigns within the org only and rejects a foreign assignee', async () => {
    const ids = (await prisma.obligation.findMany({ where: { contractId: contract }, select: { id: true } })).map(r => r.id)
    const foreignUser = await makeUser(otherOrg)
    const bad = await app.inject({
      method: 'POST', url: '/api/v1/obligations/bulk-assign', headers: auth(org, ['ADMIN'], owner),
      payload: { ids, assigneeId: foreignUser },
    })
    expect(bad.statusCode).toBe(422)

    // Rows already assigned to this person are not changed (and get no
    // history entry), so `updated` counts only the ones that move.
    // Counted in code: on MongoDB, NOT { assigneeId: x } skips rows where the
    // field was never set, which is exactly the unassigned ones.
    const moving = (await prisma.obligation.findMany({ where: { id: { in: ids } }, select: { assigneeId: true } }))
      .filter(r => r.assigneeId !== assignee).length
    const ok = await app.inject({
      method: 'POST', url: '/api/v1/obligations/bulk-assign', headers: auth(org, ['ADMIN'], owner),
      payload: { ids, assigneeId: assignee },
    })
    expect(ok.json().updated).toBe(moving)
    expect(await prisma.obligation.count({ where: { id: { in: ids }, assigneeId: assignee } })).toBe(ids.length)

    const otherOrgTry = await app.inject({
      method: 'POST', url: '/api/v1/obligations/bulk-assign', headers: auth(otherOrg, ['ADMIN']),
      payload: { ids, assigneeId: null },
    })
    expect(otherOrgTry.json().updated).toBe(0)
  })

  it('filters by assignee', async () => {
    const mine = await app.inject({ method: 'GET', url: '/api/v1/obligations?assignee=me', headers: auth(org, ['ADMIN'], assignee) })
    expect(mine.json().total).toBeGreaterThan(0)
    const unassigned = await app.inject({ method: 'GET', url: `/api/v1/obligations?assignee=unassigned&contractId=${contract}`, headers: auth(org, ['ADMIN'], owner) })
    expect(unassigned.json().total).toBe(0)
  })

  it('an own-scoped role sees only obligations on contracts it owns', async () => {
    await prisma.obligation.create({
      data: { orgId: org, contractId: repContract, type: 'other', description: 'Rep obligation', quote: 'q' },
    })
    const res = await app.inject({ method: 'GET', url: '/api/v1/obligations?limit=100', headers: auth(org, ['SALES_REP'], rep) })
    expect(res.statusCode).toBe(200)
    const contractIds = new Set((res.json().data as Array<{ contractId: string }>).map(r => r.contractId))
    expect([...contractIds]).toEqual([repContract])

    const theirs = await prisma.obligation.findFirstOrThrow({ where: { contractId: contract } })
    const direct = await app.inject({ method: 'GET', url: `/api/v1/obligations/${theirs.id}`, headers: auth(org, ['SALES_REP'], rep) })
    expect(direct.statusCode).toBe(404)
  })

  it('an own-scoped role cannot read another owner\'s contract by id', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/contracts/${contract}`, headers: auth(org, ['SALES_REP'], rep) })
    expect(res.statusCode).toBe(404)
    const own = await app.inject({ method: 'GET', url: `/api/v1/contracts/${repContract}`, headers: auth(org, ['SALES_REP'], rep) })
    expect(own.statusCode).toBe(200)
  })
})

describe('tracking', () => {
  let tracked: string

  it('terms arrive with the sync and read back on the row', async () => {
    const res = await sync([record('t1', {
      terms: {
        ruleType: 'threshold', operator: '>=', value: 95, unit: '%', aggregation: 'monthly_average',
        consequence: { value: 12000, unit: 'per 0.1 percentage point', currency: 'USD', mechanism: 'service_credit' },
        tiers: [], exceptions: [],
      },
    })], { runId: 'run-terms' })
    expect(res.statusCode).toBe(200)
    const row = await prisma.obligation.findFirstOrThrow({ where: { contractId: contract, externalId: 't1' } })
    tracked = row.id
    expect(row.ruleType).toBe('threshold')
    expect((row.terms as any).consequence.currency).toBe('USD')

    const csv = await app.inject({ method: 'GET', url: `/api/v1/obligations/export?contractId=${contract}`, headers: auth(org, ['ADMIN'], owner) })
    expect(csv.body).toContain('at least 95% · monthly average')
    expect(csv.body).toContain('USD 12,000 per 0.1 percentage point · service credit')
  })

  it('completing a recurring obligation rolls it to the next period and records the one discharged', async () => {
    const h = auth(org, ['ADMIN'], owner)
    await app.inject({ method: 'PATCH', url: `/api/v1/obligations/${tracked}`, headers: h, payload: { dueDate: '2027-01-31T09:00:00.000Z', recurrence: 'monthly' } })

    const first = await app.inject({ method: 'POST', url: `/api/v1/obligations/${tracked}/complete`, headers: h, payload: { note: 'January report sent' } })
    expect(first.statusCode).toBe(200)
    expect(first.json().status).toBe('OPEN')
    expect(first.json().rolledTo).toBe('2027-02-28T09:00:00.000Z')

    const second = await app.inject({ method: 'POST', url: `/api/v1/obligations/${tracked}/complete`, headers: h, payload: {} })
    expect(second.json().rolledTo).toBe('2027-03-31T09:00:00.000Z')

    const events = await app.inject({ method: 'GET', url: `/api/v1/obligations/${tracked}/events`, headers: h })
    const completions = (events.json().data as any[]).filter(e => e.kind === 'completed')
    expect(completions.map(e => e.periodDue)).toEqual(['2027-02-28T09:00:00.000Z', '2027-01-31T09:00:00.000Z'])
    expect(completions[1].note).toBe('January report sent')
    expect((events.json().data as any[]).some(e => e.kind === 'due_changed')).toBe(true)
  })

  it('a one-off obligation completes, cannot complete twice, and reopens', async () => {
    const h = auth(org, ['ADMIN'], owner)
    await app.inject({ method: 'PATCH', url: `/api/v1/obligations/${tracked}`, headers: h, payload: { recurrence: 'one-time' } })
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/v1/obligations/${tracked}/complete`, headers: h, payload: {} }),
      app.inject({ method: 'POST', url: `/api/v1/obligations/${tracked}/complete`, headers: h, payload: {} }),
    ])
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
    expect((await prisma.obligation.findUniqueOrThrow({ where: { id: tracked } })).status).toBe('COMPLETED')

    const reopen = await app.inject({ method: 'POST', url: `/api/v1/obligations/${tracked}/reopen`, headers: h })
    expect(reopen.json().status).toBe('OPEN')
  })

  it('waiving needs a reason, and is recorded', async () => {
    const h = auth(org, ['ADMIN'], owner)
    const noReason = await app.inject({ method: 'POST', url: `/api/v1/obligations/${tracked}/waive`, headers: h, payload: {} })
    expect(noReason.statusCode).toBe(400)
    const ok = await app.inject({ method: 'POST', url: `/api/v1/obligations/${tracked}/waive`, headers: h, payload: { reason: 'Released by amendment 2' } })
    expect(ok.json().status).toBe('WAIVED')
    const again = await app.inject({ method: 'POST', url: `/api/v1/obligations/${tracked}/complete`, headers: h, payload: {} })
    expect(again.statusCode).toBe(409)
  })

  it('notes land on the timeline, and another org cannot read it', async () => {
    const note = await app.inject({ method: 'POST', url: `/api/v1/obligations/${tracked}/notes`, headers: auth(org, ['ADMIN'], owner), payload: { note: 'Called the carrier' } })
    expect(note.statusCode).toBe(201)
    const events = await app.inject({ method: 'GET', url: `/api/v1/obligations/${tracked}/events`, headers: auth(org, ['ADMIN'], owner) })
    const kinds = (events.json().data as any[]).map(e => e.kind)
    expect(kinds[0]).toBe('note')
    expect(kinds).toEqual(expect.arrayContaining(['waived', 'reopened', 'completed']))
    const foreign = await app.inject({ method: 'GET', url: `/api/v1/obligations/${tracked}/events`, headers: auth(otherOrg, ['ADMIN']) })
    expect(foreign.statusCode).toBe(404)
  })
})
