/**
 * Approval state machine (end-to-end) — submit → decide advances the contract's
 * status through the real routes + engine (Wave 3.8). Guards the money-path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  getApp, closeApp, makeOrg, makeUser, makeContract, makeWorkflow, auth, cleanupAll, prisma, type TestApp,
} from '../test-support/helpers.js'

let app: TestApp
let org: string, submitter: string, approver: string, workflowId: string

beforeAll(async () => {
  app = await getApp()
  org = await makeOrg('Approval Org')
  submitter = await makeUser(org)
  approver = await makeUser(org)
  workflowId = await makeWorkflow(org, submitter, approver)
})

afterAll(async () => {
  await cleanupAll()
  await closeApp()
})

async function submit(contractId: string) {
  const res = await app.inject({
    method: 'POST', url: `/api/v1/contracts/${contractId}/submit-approval`,
    headers: auth(org, ['ADMIN'], submitter), payload: { workflowDefinitionId: workflowId },
  })
  return res
}

describe('approval state machine', () => {
  it('APPROVE advances the contract to APPROVED', async () => {
    const contract = await makeContract(org, submitter, { title: 'Awaiting approval', status: 'DRAFT' })

    const submitRes = await submit(contract)
    expect(submitRes.statusCode).toBe(201)
    const { instanceId, steps } = submitRes.json() as { instanceId: string; steps: Array<{ id: string }> }
    expect(steps.length).toBe(1)

    // The contract is now PENDING_APPROVAL.
    expect((await prisma.contract.findUnique({ where: { id: contract } }))?.status).toBe('PENDING_APPROVAL')

    // The assigned approver decides. The decide handler checks the step is
    // assigned to req.user.sub, so the token's sub must be the approver.
    const decideRes = await app.inject({
      method: 'POST', url: `/api/v1/approvals/${instanceId}/decide`,
      headers: auth(org, ['ADMIN'], approver),
      payload: { stepId: steps[0].id, decision: 'APPROVED' },
    })
    expect(decideRes.statusCode).toBe(200)

    expect((await prisma.contract.findUnique({ where: { id: contract } }))?.status).toBe('APPROVED')
    expect((await prisma.approvalInstance.findUnique({ where: { id: instanceId } }))?.status).toBe('APPROVED')
  })

  it('REJECT returns the contract to DRAFT', async () => {
    const contract = await makeContract(org, submitter, { title: 'To be rejected', status: 'DRAFT' })

    const submitRes = await submit(contract)
    expect(submitRes.statusCode).toBe(201)
    const { instanceId, steps } = submitRes.json() as { instanceId: string; steps: Array<{ id: string }> }

    const decideRes = await app.inject({
      method: 'POST', url: `/api/v1/approvals/${instanceId}/decide`,
      headers: auth(org, ['ADMIN'], approver),
      payload: { stepId: steps[0].id, decision: 'REJECTED', comment: 'Not acceptable' },
    })
    expect(decideRes.statusCode).toBe(200)

    expect((await prisma.contract.findUnique({ where: { id: contract } }))?.status).toBe('DRAFT')
    expect((await prisma.approvalInstance.findUnique({ where: { id: instanceId } }))?.status).toBe('REJECTED')
  })

  it('a non-assigned user cannot decide someone else\'s step (403)', async () => {
    const contract = await makeContract(org, submitter, { title: 'Guarded step', status: 'DRAFT' })
    const submitRes = await submit(contract)
    const { instanceId, steps } = submitRes.json() as { instanceId: string; steps: Array<{ id: string }> }

    // submitter has approve:workflow via ADMIN but is NOT the assigned approver.
    const res = await app.inject({
      method: 'POST', url: `/api/v1/approvals/${instanceId}/decide`,
      headers: auth(org, ['ADMIN'], submitter),
      payload: { stepId: steps[0].id, decision: 'APPROVED' },
    })
    expect(res.statusCode).toBe(403)
  })
})
