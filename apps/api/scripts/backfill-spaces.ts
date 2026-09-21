/**
 * backfill-spaces.ts — give every ContractSense project a Space (Spaces step 6).
 *
 * A Space is one thing to a user: the lifecycle API owns it, and the
 * intelligence tier keeps a project keyed to it by `spaceId`. Projects that
 * existed before that link have no Space, so this creates one for each and
 * writes the id back.
 *
 * Nothing is deleted and nothing is re-keyed: a project keeps its own id, so
 * its memory, KPIs and tables are untouched.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx --env-file=../../.env scripts/backfill-spaces.ts            # dry run
 *   npx tsx --env-file=../../.env scripts/backfill-spaces.ts --write    # apply
 *
 * Reads the intelligence database from INTEL_MONGODB_URI (defaults to
 * DATABASE_URL's host) and INTEL_DB_NAME (default contract_core_db).
 */
import { PrismaClient } from '@prisma/client'
import { MongoClient, ObjectId } from 'mongodb'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')

export interface ProjectRow {
  _id: ObjectId
  name?: string
  description?: string | null
  ownerType?: 'user' | 'team'
  ownerId?: ObjectId
  spaceId?: string | null
  isDefault?: boolean
}

export interface TeamRow {
  _id: ObjectId
  platformOrgId?: string
  creatorId?: ObjectId
}

export interface ShadowUser {
  _id: ObjectId
  platformUserId?: string
  platformOrgId?: string
}

export type Plan =
  | { action: 'skip'; project: ProjectRow; why: string }
  | { action: 'report'; project: ProjectRow; why: string }
  | { action: 'create'; project: ProjectRow; orgId: string; ownerId: string | null }

/**
 * What to do with each project, decided without touching a database so it can
 * be tested. Order matters: already linked and Unfiled buckets drop out first,
 * then anything whose organisation cannot be established is reported rather
 * than guessed at.
 */
export function planBackfill(
  projects: ProjectRow[],
  teams: Map<string, TeamRow>,
  shadowUsers: Map<string, ShadowUser>,
): Plan[] {
  return projects.map((project): Plan => {
    if (project.spaceId) return { action: 'skip', project, why: 'already has a Space' }
    if (project.isDefault || project.name === 'Default Project') {
      return { action: 'skip', project, why: 'Unfiled bucket — stays unfiled' }
    }
    if (!project.ownerId) return { action: 'report', project, why: 'no owner' }

    if (project.ownerType === 'team') {
      const team = teams.get(project.ownerId.toString())
      if (!team?.platformOrgId) {
        return { action: 'report', project, why: 'its team is not a platform organisation yet' }
      }
      const creator = team.creatorId ? shadowUsers.get(team.creatorId.toString()) : undefined
      return { action: 'create', project, orgId: team.platformOrgId, ownerId: creator?.platformUserId ?? null }
    }

    // ContractSense's personal space. The platform has no such thing, so this
    // is only safe once its owner has a platform account — the organisation is
    // read from that account, never assumed.
    const owner = shadowUsers.get(project.ownerId.toString())
    if (!owner?.platformOrgId) {
      return { action: 'report', project, why: 'personal project whose owner has no platform account' }
    }
    return { action: 'create', project, orgId: owner.platformOrgId, ownerId: owner.platformUserId ?? null }
  })
}

async function main() {
  const intelUrl = process.env.INTEL_MONGODB_URI ?? process.env.DATABASE_URL
  if (!intelUrl) throw new Error('Set INTEL_MONGODB_URI (or DATABASE_URL) to the intelligence database.')
  const mongo = await new MongoClient(intelUrl).connect()
  const intel = mongo.db(process.env.INTEL_DB_NAME ?? 'contract_core_db')

  const projects = await intel.collection<ProjectRow>('projects').find({}).toArray()
  const teams = new Map((await intel.collection<TeamRow>('teams').find({}).toArray()).map(t => [t._id.toString(), t]))
  const users = new Map((await intel.collection<ShadowUser>('users').find({}).toArray()).map(u => [u._id.toString(), u]))

  const plans = planBackfill(projects, teams, users)
  const creates = plans.filter(p => p.action === 'create') as Extract<Plan, { action: 'create' }>[]
  const reports = plans.filter(p => p.action === 'report') as Extract<Plan, { action: 'report' }>[]
  const skips = plans.filter(p => p.action === 'skip')

  console.log(`${projects.length} projects: ${creates.length} to link, ${skips.length} already fine, ${reports.length} needing a decision`)

  // An organisation may have no obvious owner for a Space; fall back to its
  // first admin so the Space is never ownerless.
  const adminByOrg = new Map<string, string>()
  for (const orgId of new Set(creates.map(c => c.orgId))) {
    const admin = await prisma.user.findFirst({
      where: { orgId, deletedAt: null, userRoles: { some: { role: { is: { name: 'ADMIN' } } } } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (admin) adminByOrg.set(orgId, admin.id)
  }

  let linked = 0
  for (const plan of creates) {
    const ownerId = plan.ownerId ?? adminByOrg.get(plan.orgId)
    if (!ownerId) {
      console.log(`  ! ${plan.project.name ?? plan.project._id}: organisation ${plan.orgId} has no admin to own the Space`)
      continue
    }
    const name = plan.project.name?.trim() || 'Untitled'
    if (!WRITE) {
      console.log(`  + would create Space "${name}" in ${plan.orgId}, owned by ${ownerId}`)
      continue
    }
    const space = await prisma.space.create({
      data: {
        orgId: plan.orgId,
        name,
        description: plan.project.description ?? null,
        ownerId,
        createdById: ownerId,
      },
      select: { id: true },
    })
    await intel.collection('projects').updateOne(
      // Guarded: if a resolver linked this project while the backfill ran, the
      // winner keeps it and this Space is dropped rather than overwriting it.
      { _id: plan.project._id, spaceId: { $in: [null, undefined] } },
      { $set: { spaceId: space.id } },
    )
    const stored = await intel.collection('projects').findOne({ _id: plan.project._id }, { projection: { spaceId: 1 } })
    if (stored?.spaceId !== space.id) {
      await prisma.space.delete({ where: { id: space.id } })
      console.log(`  = ${name}: linked by someone else while running; left as is`)
      continue
    }
    linked++
    console.log(`  + ${name} -> ${space.id}`)
  }

  for (const r of reports) {
    console.log(`  ? ${r.project.name ?? r.project._id}: ${r.why}`)
  }

  console.log(WRITE ? `Linked ${linked} projects.` : 'Dry run — nothing was written. Re-run with --write.')
  await mongo.close()
  await prisma.$disconnect()
}

// Importable for tests; only runs when invoked directly.
if (process.argv[1]?.endsWith('backfill-spaces.ts')) {
  main().catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
}
