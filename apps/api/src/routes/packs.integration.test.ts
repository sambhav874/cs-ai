/**
 * Packs install as a subscription, keep an org's edits across upgrades, and
 * bring pack corrections to rows the org never touched (merge step 8). The old
 * seeder skipped any row already present, so a corrected clause never reached
 * an org that had installed the pack.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma.js'
import { clearPackCache, packsRoot, syncPack } from '../lib/packs.js'
import { getApp, closeApp, makeOrg, makeUser, cleanupAll, auth, type TestApp } from '../test-support/helpers.js'

let app: TestApp
let org: string, admin: string
const realRoot = packsRoot()
let tmpRoot = ''

beforeAll(async () => {
  app = await getApp()
  org = await makeOrg('Pack Org')
  admin = await makeUser(org)
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'packs-'))
  fs.cpSync(realRoot, tmpRoot, { recursive: true })
  process.env.PACKS_ROOT = tmpRoot
  clearPackCache()
})

afterAll(async () => {
  delete process.env.PACKS_ROOT
  clearPackCache()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  await cleanupAll(); await closeApp()
})

const editPack = (file: string, from: string, to: string) => {
  const p = path.join(tmpRoot, 'logistics', file)
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(from, to))
  clearPackCache()
}

describe('industry packs', () => {
  it('installs a pack with provenance and records the subscription', async () => {
    const diff = await syncPack(org, admin, 'logistics')
    expect(diff.added.length).toBeGreaterThan(5)
    const clause = await prisma.clauseLibraryItem.findFirstOrThrow({ where: { orgId: org, packId: 'logistics', packKey: 'fuel_surcharge' } })
    expect(clause).toMatchObject({ packVersion: '1.0.0', packReviewStatus: 'sample', isApproved: false })
    expect(await prisma.orgPackSubscription.findUnique({ where: { orgId_packId: { orgId: org, packId: 'logistics' } } }))
      .toMatchObject({ version: '1.0.0' })
    // Installing again changes nothing.
    const again = await syncPack(org, admin, 'logistics', { dryRun: true })
    expect([again.added, again.updated, again.overridden]).toEqual([[], [], []])
  })

  it('upgrades untouched rows and keeps the org\'s edits', async () => {
    // The org rewrites one clause; the pack then corrects two.
    await prisma.clauseLibraryItem.updateMany({ where: { orgId: org, packKey: 'demurrage_and_detention' }, data: { content: '<p>Our own detention terms.</p>' } })
    editPack('clauses.yaml', 'calculated weekly', 'calculated every Monday')
    editPack('clauses.yaml', 'two (2) hours per stop', 'three (3) hours per stop')
    editPack('pack.yaml', 'version: 1.0.0', 'version: 1.1.0')

    const diff = await syncPack(org, admin, 'logistics', { dryRun: true })
    expect(diff).toMatchObject({ fromVersion: '1.0.0', toVersion: '1.1.0' })
    expect(diff.updated).toEqual(['clause:fuel_surcharge'])
    expect(diff.overridden).toEqual([{ key: 'clause:demurrage_and_detention', packChanged: true }])

    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/packs/logistics/upgrade', headers: auth(org, ['ADMIN'], admin) })
    expect(res.statusCode).toBe(200)
    const fuel = await prisma.clauseLibraryItem.findFirstOrThrow({ where: { orgId: org, packKey: 'fuel_surcharge' } })
    expect(fuel.content).toContain('calculated every Monday')
    expect(fuel.packVersion).toBe('1.1.0')
    const mine = await prisma.clauseLibraryItem.findFirstOrThrow({ where: { orgId: org, packKey: 'demurrage_and_detention' } })
    expect(mine.content).toBe('<p>Our own detention terms.</p>')
  })

  it('lists the catalog with the version the org is on', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/packs', headers: auth(org, ['ADMIN'], admin) })
    const logistics = res.json().packs.find((p: { id: string }) => p.id === 'logistics')
    expect(logistics).toMatchObject({ installedVersion: '1.1.0', extraction: true })
    const unknown = await app.inject({ method: 'GET', url: '/api/v1/admin/packs/nope/diff', headers: auth(org, ['ADMIN'], admin) })
    expect(unknown.statusCode).toBe(404)
  })
})
