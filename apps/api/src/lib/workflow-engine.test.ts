/**
 * Tests for the workflow engine's pure decision helpers (Wave 3.8).
 *
 * evaluateApprovalBatch encodes the parallel N-of-M approval semantics that
 * were previously impossible (only one ApprovalStep was ever created). Covered
 * here without a DB. The DB-driven advanceWorkflow transitions are integration-
 * tested separately (they need Postgres + BullMQ).
 *
 * queue.js opens BullMQ/Redis connections at import time, and workflow-engine
 * imports it, so we mock queue.js + audit.js to keep this a pure unit test.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('./queue.js', () => ({
  notificationQueue: { remove: vi.fn() },
  queueEscalation:   vi.fn(),
  queueNotification: vi.fn(),
}))
vi.mock('./audit.js', () => ({ createAuditEvent: vi.fn() }))

const { evaluateApprovalBatch, checkAutoApprove } = await import('./workflow-engine.js')

type S = { id: string; status: string; decision: string | null }
const step = (id: string, status: string, decision: string | null = null): S => ({ id, status, decision })

describe('evaluateApprovalBatch — sequential', () => {
  it('resolves when the single approver approved and none pending', () => {
    const r = evaluateApprovalBatch([step('a', 'APPROVED', 'APPROVED')], 'sequential', 1)
    expect(r.anyRejected).toBe(false)
    expect(r.batchResolved).toBe(true)
    expect(r.leftoverPendingIds).toEqual([])
  })

  it('does not resolve while the approver is still pending', () => {
    const r = evaluateApprovalBatch([step('a', 'PENDING')], 'sequential', 1)
    expect(r.batchResolved).toBe(false)
  })

  it('flags rejection', () => {
    const r = evaluateApprovalBatch([step('a', 'REJECTED', 'REJECTED')], 'sequential', 1)
    expect(r.anyRejected).toBe(true)
  })
})

describe('evaluateApprovalBatch — parallel N-of-M', () => {
  it('2-of-3: one approval is not enough', () => {
    const steps = [step('a', 'APPROVED', 'APPROVED'), step('b', 'PENDING'), step('c', 'PENDING')]
    const r = evaluateApprovalBatch(steps, 'parallel', 2)
    expect(r.batchResolved).toBe(false)
    expect(r.leftoverPendingIds).toEqual([])
  })

  it('2-of-3: the second approval resolves and closes the remaining pending sibling', () => {
    const steps = [step('a', 'APPROVED', 'APPROVED'), step('b', 'APPROVED', 'APPROVED'), step('c', 'PENDING')]
    const r = evaluateApprovalBatch(steps, 'parallel', 2)
    expect(r.batchResolved).toBe(true)
    expect(r.leftoverPendingIds).toEqual(['c'])
  })

  it('1-of-3 (any-one): a single approval resolves and skips the other two', () => {
    const steps = [step('a', 'APPROVED', 'APPROVED'), step('b', 'PENDING'), step('c', 'PENDING')]
    const r = evaluateApprovalBatch(steps, 'parallel', 1)
    expect(r.batchResolved).toBe(true)
    expect(r.leftoverPendingIds.sort()).toEqual(['b', 'c'])
  })

  it('all-of-3: needs every approver, no leftovers', () => {
    const two = [step('a', 'APPROVED', 'APPROVED'), step('b', 'APPROVED', 'APPROVED'), step('c', 'PENDING')]
    expect(evaluateApprovalBatch(two, 'parallel', 3).batchResolved).toBe(false)
    const three = [step('a', 'APPROVED', 'APPROVED'), step('b', 'APPROVED', 'APPROVED'), step('c', 'APPROVED', 'APPROVED')]
    const r = evaluateApprovalBatch(three, 'parallel', 3)
    expect(r.batchResolved).toBe(true)
    expect(r.leftoverPendingIds).toEqual([])
  })

  it('any REJECTED fails the batch regardless of approvals', () => {
    const steps = [step('a', 'APPROVED', 'APPROVED'), step('b', 'REJECTED', 'REJECTED'), step('c', 'APPROVED', 'APPROVED')]
    const r = evaluateApprovalBatch(steps, 'parallel', 2)
    expect(r.anyRejected).toBe(true)
    // On rejection we never produce a "skip these" list — Case 1 handles cleanup.
    expect(r.leftoverPendingIds).toEqual([])
  })

  it('clamps an unsatisfiable requiredApprovals (5-of-3) down to the step count', () => {
    const three = [step('a', 'APPROVED', 'APPROVED'), step('b', 'APPROVED', 'APPROVED'), step('c', 'APPROVED', 'APPROVED')]
    // Without the clamp, 3 >= 5 is false and the workflow would deadlock.
    expect(evaluateApprovalBatch(three, 'parallel', 5).batchResolved).toBe(true)
  })

  it('does NOT deadlock when delegation inflates the row count (regression)', () => {
    // Over-configured parallel: requiredApprovals=3 but only 2 real approvers
    // (e.g. a role resolving to 2 users). One delegates, adding a DELEGATED row.
    // Rows: [a APPROVED, b DELEGATED, d APPROVED] — 3 rows but only 2 approvable
    // slots. Clamping against steps.length (3) would require 3 approvals and
    // strand the batch forever; clamping against approvable (2) resolves it.
    const steps = [
      step('a', 'APPROVED', 'APPROVED'),
      step('b', 'DELEGATED', 'DELEGATED'),
      step('d', 'APPROVED', 'APPROVED'),
    ]
    const r = evaluateApprovalBatch(steps, 'parallel', 3)
    expect(r.batchResolved).toBe(true)
    expect(r.leftoverPendingIds).toEqual([])
  })

  it('does NOT deadlock when an escalation replacement inflates the row count (regression)', () => {
    // requiredApprovals=3, approvers A,B. A times out → A ESCALATED + A2 PENDING.
    // Rows: [A ESCALATED, A2 APPROVED, B APPROVED]. Only 2 approvable slots.
    const steps = [
      step('A', 'ESCALATED', null),
      step('A2', 'APPROVED', 'APPROVED'),
      step('B', 'APPROVED', 'APPROVED'),
    ]
    const r = evaluateApprovalBatch(steps, 'parallel', 3)
    expect(r.batchResolved).toBe(true)
  })

  it('treats a DELEGATED step as neither approved nor pending', () => {
    // b delegated → a replacement PENDING step 'b2' exists. 2-of-3 with a+b2
    // approved should resolve; the original delegated row is inert.
    const steps = [
      step('a', 'APPROVED', 'APPROVED'),
      step('b', 'DELEGATED', 'DELEGATED'),
      step('b2', 'APPROVED', 'APPROVED'),
    ]
    const r = evaluateApprovalBatch(steps, 'parallel', 2)
    expect(r.batchResolved).toBe(true)
    expect(r.leftoverPendingIds).toEqual([])
  })
})

describe('checkAutoApprove — fail-closed on null value (Wave 1.6 regression guard)', () => {
  const rules = { autoApproveRules: [{ contractType: 'ANY', maxValue: 10_000 }] }
  it('auto-approves a known value under the threshold', () => {
    expect(checkAutoApprove('NDA', 5_000, rules)).toBe(true)
  })
  it('does NOT auto-approve an unknown (null) value', () => {
    expect(checkAutoApprove('NDA', null, rules)).toBe(false)
    expect(checkAutoApprove('NDA', undefined, rules)).toBe(false)
  })
  it('does not auto-approve a value over the threshold', () => {
    expect(checkAutoApprove('NDA', 50_000, rules)).toBe(false)
  })
})
