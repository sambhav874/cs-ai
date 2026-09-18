/**
 * Audit hash chain under concurrency.
 *
 * Guards the fork the MongoDB migration exposed: MongoDB offers only snapshot
 * isolation, so two appends that read the same previous row and then insert two
 * DIFFERENT documents produce no write conflict — both commit, and the chain
 * forks silently. Postgres prevented this with Serializable isolation, which
 * the MongoDB connector rejects outright.
 *
 * The fix is a per-org chain-head document updated inside the same transaction,
 * so concurrent appends collide on ONE row and the loser retries. These tests
 * fail against the pre-fix implementation on MongoDB.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { makeOrg, makeUser, cleanupAll, prisma } from '../test-support/helpers.js'
import { createAuditEvent, verifyAuditChain } from './audit.js'

let org: string
let user: string

beforeAll(async () => {
  org = await makeOrg('Audit Chain Org')
  user = await makeUser(org)
})

afterAll(async () => {
  await prisma.auditChainHead.deleteMany({ where: { orgId: org } })
  await prisma.auditEvent.deleteMany({ where: { orgId: org } })
  await cleanupAll()
})

const append = (i: number) =>
  createAuditEvent({
    orgId: org,
    userId: user,
    action: 'CONTRACT_UPDATED' as never,
    resourceType: 'contract',
    resourceId: `c-${i}`,
    metadata: { i },
  })

describe('audit hash chain under concurrency', () => {
  it('20 concurrent appends produce one unbroken chain', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => append(i)))

    const result = await verifyAuditChain(org)
    expect(result.firstBreak).toBeNull()
    expect(result.ok).toBe(true)
    expect(result.total).toBe(20)
  })

  it('no two events share a prevHash — the chain never forks', async () => {
    const events = await prisma.auditEvent.findMany({
      where: { orgId: org },
      select: { id: true, hash: true, prevHash: true },
    })
    expect(events).toHaveLength(20)

    // Exactly one genesis event, and every other prevHash is unique.
    const genesis = events.filter(e => e.prevHash === null)
    expect(genesis).toHaveLength(1)

    const prevHashes = events.filter(e => e.prevHash !== null).map(e => e.prevHash)
    expect(new Set(prevHashes).size).toBe(prevHashes.length)

    // Every hash is present and unique.
    const hashes = events.map(e => e.hash)
    expect(hashes.every(h => typeof h === 'string' && h.length === 64)).toBe(true)
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it('the chain head matches the tail of the chain', async () => {
    const head = await prisma.auditChainHead.findUnique({ where: { orgId: org } })
    expect(head).not.toBeNull()

    const events = await prisma.auditEvent.findMany({
      where: { orgId: org },
      select: { hash: true, prevHash: true },
    })
    // The head's lastHash is the one hash nothing else points back to.
    const pointedAt = new Set(events.map(e => e.prevHash).filter(Boolean))
    const tails = events.map(e => e.hash).filter(h => !pointedAt.has(h))
    expect(tails).toHaveLength(1)
    expect(head!.lastHash).toBe(tails[0])
  })
})
