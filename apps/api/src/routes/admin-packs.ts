/**
 * Industry packs for the caller's org (merge step 8; lib/packs.ts).
 *
 *   GET  /api/v1/admin/packs              — catalog, with the org's installed version
 *   GET  /api/v1/admin/packs/:id/diff     — what an install/upgrade would change
 *   POST /api/v1/admin/packs/install      — install a pack
 *   POST /api/v1/admin/packs/:id/upgrade  — move to the pack's current version, keeping the org's edits
 *
 * Permission: 'configure:organization'. The universal library is installed at
 * signup and upgraded through the same routes (id "universal").
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../middleware/permissions.js'
import { packCatalog } from '../lib/org-seed.js'
import { orgSubscriptions, syncPack } from '../lib/packs.js'

const PackIdSchema = z.string().regex(/^[a-z][a-z0-9_]{1,48}$/)

export async function adminPackRoutes(app: FastifyInstance) {
  // 'configure:organization' — same gate as other org-wide config actions.
  const adminGuard = requirePermission('configure', 'organization')

  // GET /api/v1/admin/packs — the catalog, with the version this org is on.
  app.get('/', { preHandler: adminGuard }, async (req) => {
    const subs = new Map((await orgSubscriptions(req.user.orgId)).map(s => [s.packId, s.version]))
    const packs = packCatalog().map(p => ({ ...p, installedVersion: subs.get(p.id) ?? null }))
    return { packs, universal: subs.get('universal') ?? null }
  })

  // GET /api/v1/admin/packs/:id/diff — what an install or upgrade would do:
  // added, updated, the org's overrides it would keep, and entries the pack
  // has dropped. Nothing is written. The admin reviews this, then upgrades.
  app.get('/:id/diff', { preHandler: adminGuard }, async (req, reply) => {
    const parsed = PackIdSchema.safeParse((req.params as { id: string }).id)
    if (!parsed.success || (parsed.data !== 'universal' && !packCatalog().some(p => p.id === parsed.data))) {
      return reply.status(404).send({ detail: 'Unknown pack' })
    }
    return syncPack(req.user.orgId, req.user.sub, parsed.data, { dryRun: true })
  })

  // POST /api/v1/admin/packs/install — install a pack (body: { pack }).
  // POST /api/v1/admin/packs/:id/upgrade — move to the pack's current version.
  // The same operation: rows still carrying pack content are brought up to
  // date, rows the org edited are kept, and the subscription records the version.
  const apply = async (orgId: string, userId: string, packId: string) => syncPack(orgId, userId, packId)

  app.post('/install', { preHandler: adminGuard }, async (req, reply) => {
    const parsed = z.object({ pack: PackIdSchema }).safeParse(req.body)
    if (!parsed.success || !packCatalog().some(p => p.id === parsed.data.pack)) {
      return reply.status(400).send({ detail: 'Invalid request', issues: parsed.success ? 'Unknown pack' : parsed.error.issues })
    }
    const diff = await apply(req.user.orgId, req.user.sub, parsed.data.pack)
    req.log.info({ orgId: req.user.orgId, pack: parsed.data.pack, added: diff.added.length }, '[admin-packs] pack installed')
    return reply.send({ pack: parsed.data.pack, diff })
  })

  app.post('/:id/upgrade', { preHandler: adminGuard }, async (req, reply) => {
    const parsed = PackIdSchema.safeParse((req.params as { id: string }).id)
    if (!parsed.success || (parsed.data !== 'universal' && !packCatalog().some(p => p.id === parsed.data))) {
      return reply.status(404).send({ detail: 'Unknown pack' })
    }
    const diff = await apply(req.user.orgId, req.user.sub, parsed.data)
    req.log.info({ orgId: req.user.orgId, pack: parsed.data, updated: diff.updated.length, kept: diff.overridden.length },
      '[admin-packs] pack upgraded')
    return reply.send({ pack: parsed.data, diff })
  })
}
