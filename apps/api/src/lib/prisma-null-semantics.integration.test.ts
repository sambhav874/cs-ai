/**
 * Postgres NULL semantics on MongoDB.
 *
 * Prisma on MongoDB matches `field: null` only where null was WRITTEN; a field
 * never set is absent and does not match. These cases fail without the
 * withMongoNullSemantics extension in lib/prisma.ts. The first is the one that
 * was found in practice: `diligenceRoomId: null` in the contracts list hid all
 * ten seeded contracts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { makeOrg, makeUser, cleanupAll, prisma } from '../test-support/helpers.js'

let org: string
let owner: string
let unset: string   // created without diligenceRoomId — field absent
let set: string     // diligenceRoomId set — must NEVER match a null filter

beforeAll(async () => {
  org = await makeOrg('Null Semantics Org')
  owner = await makeUser(org)
  unset = (await prisma.contract.create({
    data: { orgId: org, ownerId: owner, createdBy: owner, title: 'unset', type: 'NDA', status: 'DRAFT' },
    select: { id: true },
  })).id
  set = (await prisma.contract.create({
    data: { orgId: org, ownerId: owner, createdBy: owner, title: 'set', type: 'NDA', status: 'DRAFT',
            diligenceRoomId: 'room-that-exists' },
    select: { id: true },
  })).id
})

afterAll(async () => {
  await prisma.contract.deleteMany({ where: { orgId: org } })
  await cleanupAll()
})

const titles = async (where: object) =>
  (await prisma.contract.findMany({ where: { orgId: org, ...where }, select: { title: true } }))
    .map((c) => c.title).sort()

describe('MongoDB null filters behave like Postgres', () => {
  it('field: null matches a document where the field was never set', async () => {
    expect(await titles({ diligenceRoomId: null })).toEqual(['unset'])
  })

  it('{ equals: null } behaves the same', async () => {
    expect(await titles({ diligenceRoomId: { equals: null } })).toEqual(['unset'])
  })

  it('a set value is never matched by a null filter', async () => {
    expect(await titles({ diligenceRoomId: null })).not.toContain('set')
  })

  it('works inside OR / NOT', async () => {
    expect(await titles({ OR: [{ diligenceRoomId: null }, { title: 'nothing' }] })).toEqual(['unset'])
    expect(await titles({ NOT: { diligenceRoomId: null } })).toEqual(['set'])
  })

  it('merges with an existing AND instead of replacing it', async () => {
    expect(await titles({ AND: [{ type: 'NDA' }], diligenceRoomId: null })).toEqual(['unset'])
  })

  it('reaches the where inside a nested include', async () => {
    const o = await prisma.organization.findUnique({
      where: { id: org },
      include: { contracts: { where: { diligenceRoomId: null }, select: { id: true } } },
    })
    expect(o!.contracts.map((c) => c.id)).toEqual([unset])
  })

  it('count agrees with findMany', async () => {
    expect(await prisma.contract.count({ where: { orgId: org, diligenceRoomId: null } })).toBe(1)
    void set
  })
})
