/**
 * The playbook on MongoDB: phrases stored as rules, seed markers kept out of
 * the notes, required clause types, and a contract's merged playbook review.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const queued = vi.hoisted(() => [] as Array<{ contractId: string; versionId: string; runKey?: string }>)
vi.mock('../lib/queue.js', async orig => ({
  ...(await orig<typeof import('../lib/queue.js')>()),
  queuePlaybookReview: (job: (typeof queued)[number]) => { queued.push(job) },
}))

import { prisma } from '../lib/prisma.js'
import { getApp, closeApp, makeOrg, makeUser, makeContract, auth, cleanupAll, type TestApp } from '../test-support/helpers.js'

let app: TestApp
let org: string, user: string, contract: string
const cat: Record<string, string> = {}
const clause: Record<string, string> = {}

const H = () => auth(org, ['ADMIN'], user)

beforeAll(async () => {
  app = await getApp()
  org = await makeOrg('Playbook Org')
  user = await makeUser(org)
  for (const name of ['Limitation of Liability', 'Fees & Payment', 'Confidentiality']) {
    cat[name] = (await prisma.clauseCategory.create({ data: { orgId: org, name } })).id
  }

  contract = await makeContract(org, user, { title: 'Logistics MSA', type: 'MSA', status: 'IN_REVIEW' })
  const v = await prisma.contractVersion.create({
    data: { contractId: contract, versionNumber: 1, htmlContent: '<p>x</p>', plainText: 'x', createdById: user } as never,
  })
  const rows: Array<[string, string, string]> = [
    ['cap', 'limitation_of_liability', 'Supplier has unlimited liability for data breach.'],
    ['pay', 'payment', 'Invoices are payable within 30 days.'],
    ['nc', 'non_compete', 'No competing providers during the Term.'],
  ]
  for (const [i, [key, type, content]] of rows.entries()) {
    clause[key] = (await prisma.contractClause.create({ data: { versionId: v.id, clauseType: type, content, sortOrder: i } })).id
  }
  await prisma.contract.update({
    where: { id: contract },
    data: {
      currentVersionId: v.id,
      metadata: {
        _playbookReviewStatus: 'DONE',
        _playbookReview: {
          versionId: v.id, reviewedAt: new Date().toISOString(), summary: '1 deviation',
          findings: [{ clauseId: clause.pay, clauseType: 'payment', playbookAlignment: 'acceptable', severity: 'medium', recommendation: 'negotiate', reasoning: 'Net 30, we prefer Net 60.' }],
        },
      } as never,
    },
  })
})

afterAll(async () => {
  await prisma.contractClause.deleteMany({ where: { id: { in: Object.values(clause) } } }).catch(() => {})
  await prisma.playbookPosition.deleteMany({ where: { orgId: org } }).catch(() => {})
  await prisma.clauseCategory.deleteMany({ where: { orgId: org } }).catch(() => {})
  await cleanupAll()
  await closeApp()
})

describe('playbook positions', () => {
  it('stores phrase lists as rules and reads them back as lists', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/playbook/positions', headers: H(),
      payload: { clauseCategoryId: cat['Limitation of Liability'], positionType: 'walkaway', content: '<p>No cap</p>', mustNotInclude: ['unlimited liability', ' Unlimited  liability '] },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ mustInclude: [], mustNotInclude: ['unlimited liability'] })
    const row = await prisma.playbookPosition.findUniqueOrThrow({ where: { id: res.json().id } })
    expect((row.rules as { must_not: Array<{ severity: string }> }).must_not[0].severity).toBe('walkaway')

    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/playbook/positions/${row.id}`, headers: H(),
      payload: { mustNotInclude: ['unlimited liability', 'no cap'] },
    })
    expect(patch.json().mustNotInclude).toEqual(['unlimited liability', 'no cap'])
  })

  it('moves a legacy seed marker out of the notes on first read', async () => {
    const p = await prisma.playbookPosition.create({
      data: { orgId: org, clauseCategoryId: cat['Fees & Payment'], positionType: 'preferred', content: 'Net 60', notes: '[seed-key:pb-pay] Push for Net 60.', createdById: user },
    })
    const list = await app.inject({ method: 'GET', url: '/api/v1/playbook/positions', headers: H() })
    const shown = list.json().data.find((x: { id: string }) => x.id === p.id)
    expect(shown.notes).toBe('Push for Net 60.')
    expect(shown).not.toHaveProperty('seedKey')
    const stored = await prisma.playbookPosition.findUniqueOrThrow({ where: { id: p.id } })
    expect(stored).toMatchObject({ seedKey: 'pb-pay', notes: 'Push for Net 60.' })
  })

  it('marks a clause type required', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/playbook/categories/${cat.Confidentiality}`, headers: H(), payload: { isRequired: true } })
    expect(res.json()).toMatchObject({ isRequired: true })
    const bad = await app.inject({ method: 'PATCH', url: `/api/v1/playbook/categories/${cat.Confidentiality}`, headers: H(), payload: {} })
    expect(bad.statusCode).toBe(400)
  })

  it('another org cannot mark our clause type', async () => {
    const other = await makeOrg('Other Playbook Org')
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/playbook/categories/${cat.Confidentiality}`, headers: auth(other, ['ADMIN']), payload: { isRequired: false } })
    expect(res.statusCode).toBe(404)
  })

  it('the test box answers from the phrases with AI unavailable', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/playbook/test', headers: H(),
      payload: { clauseCategoryId: cat['Limitation of Liability'], clauseText: 'There is no cap on liability.' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().rules).toMatchObject({ alignment: 'walkaway', issues: [{ description: 'Red flag: says "no cap"' }] })
  })
})

describe('contract playbook review', () => {
  it('merges the AI review, phrase checks and missing required clauses', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/contracts/${contract}/playbook-review`, headers: H() })
    expect(res.statusCode).toBe(200)
    const view = res.json()
    expect(view.ai).toMatchObject({ status: 'done', stale: false })
    const byClause = Object.fromEntries(view.findings.map((f: { clauseId: string }) => [f.clauseId, f]))
    expect(byClause[clause.cap]).toMatchObject({ alignment: 'walkaway', category: { name: 'Limitation of Liability' } })
    // `payment` reaches "Fees & Payment" through the extractor alias.
    expect(byClause[clause.pay]).toMatchObject({ alignment: 'acceptable', reasoning: 'Net 30, we prefer Net 60.', category: { name: 'Fees & Payment' } })
    expect(view.findings[0].clauseId).toBe(clause.cap)
    expect(view.missing).toEqual([{ categoryId: cat.Confidentiality, name: 'Confidentiality' }])
    expect(view.unchecked).toEqual([{ clauseType: 'non_compete', count: 1, reason: 'no_category' }])
    expect(view.counts).toMatchObject({ clauses: 3, findings: 2, walkaway: 1, missing: 1, unchecked: 1 })
  })

  it('re-runs the AI review once at a time', async () => {
    queued.length = 0
    const first = await app.inject({ method: 'POST', url: `/api/v1/contracts/${contract}/playbook-review`, headers: H() })
    expect(first.statusCode).toBe(202)
    expect(queued).toHaveLength(1)
    expect(queued[0].runKey).toBeTruthy()
    const again = await app.inject({ method: 'POST', url: `/api/v1/contracts/${contract}/playbook-review`, headers: H() })
    expect(again.statusCode).toBe(409)
    const view = await app.inject({ method: 'GET', url: `/api/v1/contracts/${contract}/playbook-review`, headers: H() })
    expect(view.json().ai.status).toBe('queued')
  })

  it('404s for another org', async () => {
    const other = await makeOrg('Other Review Org')
    const res = await app.inject({ method: 'GET', url: `/api/v1/contracts/${contract}/playbook-review`, headers: auth(other, ['ADMIN']) })
    expect(res.statusCode).toBe(404)
  })
})
