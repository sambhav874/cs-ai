/**
 * The backfill's decision, without a database: which projects get a Space,
 * which are left alone, and which need a person to decide.
 */
import { describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { planBackfill, type ProjectRow, type ShadowUser, type TeamRow } from './backfill-spaces.js'

const ORG = 'cmorg00000000000000000001'
const teamId = new ObjectId()
const creatorId = new ObjectId()
const personId = new ObjectId()

const teams = new Map<string, TeamRow>([
  [teamId.toString(), { _id: teamId, platformOrgId: ORG, creatorId }],
])
const users = new Map<string, ShadowUser>([
  [creatorId.toString(), { _id: creatorId, platformUserId: 'cmuser0001', platformOrgId: ORG }],
  [personId.toString(), { _id: personId, platformUserId: 'cmuser0002', platformOrgId: ORG }],
])

const project = (over: Partial<ProjectRow> = {}): ProjectRow => ({
  _id: new ObjectId(), name: 'Heathrow GHA', ownerType: 'team', ownerId: teamId, ...over,
})

function plan(p: ProjectRow) {
  return planBackfill([p], teams, users)[0]
}

describe('planBackfill', () => {
  it('creates a Space for a team project, owned by the team creator', () => {
    expect(plan(project())).toMatchObject({ action: 'create', orgId: ORG, ownerId: 'cmuser0001' })
  })

  it('leaves a project that already has a Space alone', () => {
    expect(plan(project({ spaceId: 'cmspace0001' }))).toMatchObject({ action: 'skip' })
  })

  it('leaves the Unfiled bucket unfiled, by flag or by its old name', () => {
    expect(plan(project({ isDefault: true }))).toMatchObject({ action: 'skip' })
    expect(plan(project({ name: 'Default Project' }))).toMatchObject({ action: 'skip' })
  })

  it('reports a team that is not a platform organisation yet', () => {
    expect(plan(project({ ownerId: new ObjectId() }))).toMatchObject({ action: 'report' })
  })

  it('files a personal project into its owner’s organisation', () => {
    expect(plan(project({ ownerType: 'user', ownerId: personId }))).toMatchObject({
      action: 'create', orgId: ORG, ownerId: 'cmuser0002',
    })
  })

  it('reports a personal project whose owner has no platform account', () => {
    const stray = new ObjectId()
    expect(plan(project({ ownerType: 'user', ownerId: stray }))).toMatchObject({
      action: 'report',
      why: 'personal project whose owner has no platform account',
    })
  })

  it('creates a Space with no owner when the team creator has no account', () => {
    const orphanTeam = new ObjectId()
    teams.set(orphanTeam.toString(), { _id: orphanTeam, platformOrgId: ORG })
    // The caller falls back to the organisation's first admin.
    expect(plan(project({ ownerId: orphanTeam }))).toMatchObject({ action: 'create', ownerId: null })
  })

  it('running twice changes nothing the second time', () => {
    const p = project()
    const first = planBackfill([p], teams, users)[0]
    expect(first.action).toBe('create')
    const after: ProjectRow = { ...p, spaceId: 'cmspace0002' }
    expect(planBackfill([after], teams, users)[0]).toMatchObject({ action: 'skip' })
  })
})
