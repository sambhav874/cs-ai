/**
 * Industry packs — merge step 8 (packs/README.md, and the build plan's Pack
 * format tab).
 *
 * A pack is versioned DATA in the repository's `packs/` directory, shared with
 * the intelligence tier: one directory per contract family holding both halves
 * of its domain knowledge. This module reads the drafting half — clause
 * language, templates, playbook positions — and installs it into an org.
 *
 * What changed from draftLegal's mechanism (TypeScript seed arrays copied into
 * org rows, re-seeding skipping existing keys): an org SUBSCRIBES to a pack
 * version, and every row installed from a pack carries its packId, packKey,
 * packVersion and a hash of the pack content it was written from. So:
 *
 *   • a row whose content still hashes to packHash is pack content, and an
 *     upgrade updates it — a corrected clause now reaches orgs that already
 *     installed the pack;
 *   • a row whose content no longer matches is the org's own edit — its
 *     override — and an upgrade keeps it and reports it;
 *   • the diff an admin reviews before upgrading is exactly that comparison.
 *
 * Clause language carries a legal review status (sample | reviewed |
 * approved). Only "approved" sets isApproved: draftLegal shipped every clause as
 * approved with no stated review, which is the liability the status exists to
 * stop.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { prisma } from './prisma.js'

// ─── Pack files ─────────────────────────────────────────────────────────────

export interface PackManifest {
  id: string
  version: string | number
  display_name?: string
  halves?: Array<'drafting' | 'extraction'>
  jurisdictions?: string[]
  contract_types?: string[]
  drafting_extends?: string
  description?: string
}

export interface PackCategory { slug: string; name: string; description: string; sort_order: number }

export interface PackClause {
  key: string
  category: string
  title: string
  text: string
  tags?: string[]
  risk_rating?: 'favorable' | 'unfavorable' | 'neutral' | 'standard' | null
  review: { status: 'sample' | 'reviewed' | 'approved'; reviewer: string | null; reviewed_on: string | null; jurisdiction: string | null }
}

export interface PackTemplate {
  key: string
  name: string
  description: string
  contract_type: string | null
  published: boolean
  variables: unknown[]
  sections: Array<{ title: string; sort_order: number; text: string }>
}

export interface PackPosition {
  key: string
  category: string
  position: 'preferred' | 'acceptable' | 'fallback' | 'walkaway'
  text: string
  notes?: string | null
  risk_threshold: number
  contract_types?: string[]
  sort_order: number
  obligation_class?: string
}

export interface Pack {
  manifest: PackManifest
  version: string
  clauses: PackClause[]
  templates: PackTemplate[]
  playbook: PackPosition[]
}

/** The repository's packs/ directory: PACKS_ROOT, else the nearest ancestor holding packs/universal. */
export function packsRoot(): string {
  if (process.env.PACKS_ROOT) return process.env.PACKS_ROOT
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'packs')
    if (fs.existsSync(path.join(candidate, 'universal', 'pack.yaml'))) return candidate
    dir = path.dirname(dir)
  }
  throw new Error('packs/ not found; set PACKS_ROOT')
}

function readYaml<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback
  return (yaml.load(fs.readFileSync(file, 'utf8')) as T) ?? fallback
}

const cache = new Map<string, Pack>()

/** One pack's drafting half. Throws for an unknown pack. */
export function loadPack(id: string, root = packsRoot()): Pack {
  const cacheKey = `${root}:${id}`
  const hit = cache.get(cacheKey)
  if (hit) return hit
  if (!/^[a-z_][a-z0-9_]{1,48}$/.test(id)) throw new Error(`Invalid pack id '${id}'`)
  const dir = path.join(root, id)
  const manifest = readYaml<PackManifest | null>(path.join(dir, 'pack.yaml'), null)
  if (!manifest) throw new Error(`Unknown pack '${id}'`)
  const templatesDir = path.join(dir, 'templates')
  const templates = fs.existsSync(templatesDir)
    ? fs.readdirSync(templatesDir).filter(f => f.endsWith('.yaml')).sort().map(f => ({
        key: f.replace(/\.yaml$/, ''),
        ...readYaml<Omit<PackTemplate, 'key'>>(path.join(templatesDir, f), {} as Omit<PackTemplate, 'key'>),
      }))
    : []
  const pack: Pack = {
    manifest,
    version: String(manifest.version),
    clauses: readYaml<PackClause[]>(path.join(dir, 'clauses.yaml'), []),
    templates,
    playbook: readYaml<PackPosition[]>(path.join(dir, 'playbook.yaml'), []),
  }
  cache.set(cacheKey, pack)
  return pack
}

/** The universal library's clause categories, which every pack's entries name by slug. */
export function loadCategories(root = packsRoot()): PackCategory[] {
  return readYaml<PackCategory[]>(path.join(root, 'universal', 'categories.yaml'), [])
}

/** Every pack with a drafting half that an org can install (not the always-installed universal library). */
export function installablePacks(root = packsRoot()): Pack[] {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'universal' && !d.name.startsWith('_'))
    .map(d => { try { return loadPack(d.name, root) } catch { return null } })
    .filter((p): p is Pack => !!p && (p.manifest.halves ?? []).includes('drafting'))
    .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
}

export function clearPackCache(): void { cache.clear() }

// ─── Content hashes ─────────────────────────────────────────────────────────
// The same shape from the pack entry and from the org's row, so "unchanged
// since install" is one comparison.

const sha = (parts: unknown) => crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex')

export const clauseHash = (c: { category: string; title: string; text: string; tags?: string[]; risk_rating?: string | null }) =>
  sha([c.category, c.title, c.text, [...(c.tags ?? [])].sort(), c.risk_rating ?? null])

export const templateHash = (t: { name: string; description?: string | null; contract_type?: string | null; variables?: unknown; sections: Array<{ title: string; sort_order: number; text: string }> }) =>
  sha([t.name, t.description ?? null, t.contract_type ?? null, t.variables ?? [],
       [...t.sections].sort((a, b) => a.sort_order - b.sort_order).map(s => [s.title, s.sort_order, s.text])])

export const positionHash = (p: { category: string; position: string; text: string; notes?: string | null; risk_threshold: number; contract_types?: string[]; sort_order: number }) =>
  sha([p.category, p.position, p.text, p.notes ?? null, p.risk_threshold, [...(p.contract_types ?? [])].sort(), p.sort_order])

// ─── Install and upgrade ────────────────────────────────────────────────────

export interface PackDiff {
  packId: string
  fromVersion: string | null
  toVersion: string
  /** In the pack, not in the org. */
  added: string[]
  /** Pack content changed and the org had not edited it: will be (or was) updated. */
  updated: string[]
  /** The org edited these; the edit is kept. `packChanged` marks where the pack changed underneath it. */
  overridden: Array<{ key: string; packChanged: boolean }>
  /** Installed from this pack but no longer in it: left as they are. */
  removedFromPack: string[]
}

interface Ctx { orgId: string; adminId: string; pack: Pack; dryRun: boolean; diff: PackDiff; categoryId: Map<string, string>; categorySlug: Map<string, string> }

async function ensureCategories(orgId: string): Promise<{ idBySlug: Map<string, string>; slugById: Map<string, string> }> {
  const cats = loadCategories()
  const existing = await prisma.clauseCategory.findMany({ where: { orgId }, select: { id: true, name: true } })
  const idByName = new Map(existing.map(c => [c.name, c.id]))
  for (const c of cats) {
    if (idByName.has(c.name)) continue
    const row = await prisma.clauseCategory.create({ data: { orgId, name: c.name, description: c.description, sortOrder: c.sort_order } })
    idByName.set(c.name, row.id)
  }
  const idBySlug = new Map<string, string>()
  const slugById = new Map<string, string>()
  for (const c of cats) {
    const id = idByName.get(c.name)
    if (id) { idBySlug.set(c.slug, id); slugById.set(id, c.slug) }
  }
  return { idBySlug, slugById }
}

async function syncClauses(ctx: Ctx) {
  const { orgId, pack, dryRun, diff } = ctx
  const packId = pack.manifest.id
  const rows = await prisma.clauseLibraryItem.findMany({
    where: { orgId, deletedAt: null },
    select: { id: true, title: true, content: true, tags: true, riskRating: true, categoryId: true, packId: true, packKey: true, packHash: true },
  })
  const byKey = new Map(rows.filter(r => r.packId === packId && r.packKey).map(r => [r.packKey!, r]))
  // Orgs seeded before packs were versioned: their rows match by title.
  const legacyByTitle = new Map(rows.filter(r => !r.packId).map(r => [r.title, r]))
  const approved = (c: PackClause) => c.review?.status === 'approved'

  for (const c of pack.clauses) {
    const categoryId = ctx.categoryId.get(c.category)
    if (!categoryId) continue
    const hash = clauseHash(c)
    const provenance = { packId, packKey: c.key, packVersion: pack.version, packHash: hash, packReviewStatus: c.review?.status ?? 'sample' }
    const row = byKey.get(c.key) ?? legacyByTitle.get(c.title)
    if (!row) {
      diff.added.push(`clause:${c.key}`)
      if (!dryRun) await prisma.clauseLibraryItem.create({ data: {
        orgId, categoryId, title: c.title, content: c.text, tags: c.tags ?? [], riskRating: c.risk_rating ?? null,
        isApproved: approved(c), createdById: ctx.adminId, ...provenance,
      } })
      continue
    }
    const current = clauseHash({ category: ctx.categorySlug.get(row.categoryId) ?? '', title: row.title, text: row.content, tags: row.tags, risk_rating: row.riskRating })
    // A legacy row adopts the pack: unchanged if it matches the pack now.
    const installedHash = row.packHash ?? (current === hash ? hash : null)
    if (installedHash && current === installedHash) {
      if (current !== hash) diff.updated.push(`clause:${c.key}`)
      if (!dryRun) await prisma.clauseLibraryItem.update({ where: { id: row.id }, data: {
        title: c.title, content: c.text, tags: c.tags ?? [], riskRating: c.risk_rating ?? null, categoryId,
        isApproved: approved(c), ...provenance,
      } })
    } else {
      diff.overridden.push({ key: `clause:${c.key}`, packChanged: row.packHash !== null && row.packHash !== hash })
      // Adopt without touching the org's words: packHash stays the pack
      // content they diverged from, so the next upgrade still sees the edit.
      if (!dryRun) await prisma.clauseLibraryItem.update({ where: { id: row.id }, data: {
        packId, packKey: c.key, packVersion: pack.version, packHash: row.packHash ?? hash,
      } })
    }
  }
  const inPack = new Set(pack.clauses.map(c => c.key))
  for (const r of rows) if (r.packId === packId && r.packKey && !inPack.has(r.packKey)) diff.removedFromPack.push(`clause:${r.packKey}`)
}

async function syncTemplates(ctx: Ctx) {
  const { orgId, pack, dryRun, diff } = ctx
  const packId = pack.manifest.id
  const rows = await prisma.template.findMany({
    where: { orgId, deletedAt: null },
    select: { id: true, name: true, description: true, contractType: true, variables: true, packId: true, packKey: true, packHash: true,
              sections: { select: { title: true, sortOrder: true, content: true } } },
  })
  const byKey = new Map(rows.filter(r => r.packId === packId && r.packKey).map(r => [r.packKey!, r]))
  const legacyByName = new Map(rows.filter(r => !r.packId).map(r => [r.name, r]))

  for (const t of pack.templates) {
    const hash = templateHash(t)
    const provenance = { packId, packKey: t.key, packVersion: pack.version, packHash: hash }
    const sections = t.sections.map(s => ({ title: s.title, sortOrder: s.sort_order, content: s.text, clauseRefs: [] as never }))
    const row = byKey.get(t.key) ?? legacyByName.get(t.name)
    if (!row) {
      diff.added.push(`template:${t.key}`)
      if (!dryRun) await prisma.template.create({ data: {
        orgId, name: t.name, description: t.description, contractType: t.contract_type, variables: t.variables as never,
        isPublished: t.published, createdById: ctx.adminId, ...provenance, sections: { create: sections },
      } })
      continue
    }
    const current = templateHash({ name: row.name, description: row.description, contract_type: row.contractType, variables: row.variables,
      sections: row.sections.map(s => ({ title: s.title, sort_order: s.sortOrder, text: s.content })) })
    const installedHash = row.packHash ?? (current === hash ? hash : null)
    if (installedHash && current === installedHash) {
      if (current !== hash) diff.updated.push(`template:${t.key}`)
      if (!dryRun) {
        await prisma.templateSection.deleteMany({ where: { templateId: row.id } })
        await prisma.template.update({ where: { id: row.id }, data: {
          name: t.name, description: t.description, contractType: t.contract_type, variables: t.variables as never,
          ...provenance, sections: { create: sections },
        } })
      }
    } else {
      diff.overridden.push({ key: `template:${t.key}`, packChanged: row.packHash !== null && row.packHash !== hash })
      if (!dryRun) await prisma.template.update({ where: { id: row.id }, data: {
        packId, packKey: t.key, packVersion: pack.version, packHash: row.packHash ?? hash,
      } })
    }
  }
  const inPack = new Set(pack.templates.map(t => t.key))
  for (const r of rows) if (r.packId === packId && r.packKey && !inPack.has(r.packKey)) diff.removedFromPack.push(`template:${r.packKey}`)
}

async function syncPlaybook(ctx: Ctx) {
  const { orgId, pack, dryRun, diff } = ctx
  const packId = pack.manifest.id
  const rows = await prisma.playbookPosition.findMany({
    where: { orgId },
    select: { id: true, clauseCategoryId: true, positionType: true, content: true, notes: true, riskThreshold: true, contractTypes: true,
              sortOrder: true, seedKey: true, packId: true, packKey: true, packHash: true },
  })
  const byKey = new Map(rows.filter(r => r.packId === packId && r.packKey).map(r => [r.packKey!, r]))
  const legacyBySeed = new Map(rows.filter(r => !r.packId && r.seedKey).map(r => [r.seedKey!, r]))

  for (const p of pack.playbook) {
    const clauseCategoryId = ctx.categoryId.get(p.category)
    if (!clauseCategoryId) continue
    const hash = positionHash(p)
    const provenance = { packId, packKey: p.key, packVersion: pack.version, packHash: hash, seedKey: p.key }
    const data = { clauseCategoryId, positionType: p.position, content: p.text, notes: p.notes ?? null,
                   riskThreshold: p.risk_threshold, contractTypes: p.contract_types ?? [], sortOrder: p.sort_order }
    const row = byKey.get(p.key) ?? legacyBySeed.get(p.key)
    if (!row) {
      diff.added.push(`position:${p.key}`)
      if (!dryRun) await prisma.playbookPosition.create({ data: { orgId, ...data, createdById: ctx.adminId, ...provenance } })
      continue
    }
    const current = positionHash({ category: ctx.categorySlug.get(row.clauseCategoryId) ?? '', position: row.positionType, text: row.content,
      notes: row.notes, risk_threshold: row.riskThreshold, contract_types: row.contractTypes, sort_order: row.sortOrder })
    const installedHash = row.packHash ?? (current === hash ? hash : null)
    if (installedHash && current === installedHash) {
      if (current !== hash) diff.updated.push(`position:${p.key}`)
      if (!dryRun) await prisma.playbookPosition.update({ where: { id: row.id }, data: { ...data, ...provenance } })
    } else {
      diff.overridden.push({ key: `position:${p.key}`, packChanged: row.packHash !== null && row.packHash !== hash })
      if (!dryRun) await prisma.playbookPosition.update({ where: { id: row.id }, data: {
        packId, packKey: p.key, packVersion: pack.version, packHash: row.packHash ?? hash, seedKey: p.key,
      } })
    }
  }
  const inPack = new Set(pack.playbook.map(p => p.key))
  for (const r of rows) if (r.packId === packId && r.packKey && !inPack.has(r.packKey)) diff.removedFromPack.push(`position:${r.packKey}`)
}

/**
 * Bring an org to the pack's current version. With dryRun it only reports the
 * diff (what an admin reviews before accepting); otherwise it applies it and
 * records the subscription. Installing is the same call on an org that has
 * none of the pack yet.
 */
export async function syncPack(orgId: string, adminId: string, packId: string, opts: { dryRun?: boolean } = {}): Promise<PackDiff> {
  const pack = loadPack(packId)
  const sub = await prisma.orgPackSubscription.findUnique({ where: { orgId_packId: { orgId, packId } } })
  const diff: PackDiff = { packId, fromVersion: sub?.version ?? null, toVersion: pack.version, added: [], updated: [], overridden: [], removedFromPack: [] }
  const { idBySlug, slugById } = opts.dryRun
    ? await categoryMaps(orgId)
    : await ensureCategories(orgId)
  const ctx: Ctx = { orgId, adminId, pack, dryRun: !!opts.dryRun, diff, categoryId: idBySlug, categorySlug: slugById }
  await syncClauses(ctx)
  await syncTemplates(ctx)
  await syncPlaybook(ctx)
  if (!opts.dryRun) {
    await prisma.orgPackSubscription.upsert({
      where: { orgId_packId: { orgId, packId } },
      create: { orgId, packId, version: pack.version },
      update: { version: pack.version },
    })
  }
  return diff
}

async function categoryMaps(orgId: string) {
  const cats = loadCategories()
  const existing = await prisma.clauseCategory.findMany({ where: { orgId }, select: { id: true, name: true } })
  const idByName = new Map(existing.map(c => [c.name, c.id]))
  const idBySlug = new Map<string, string>()
  const slugById = new Map<string, string>()
  for (const c of cats) {
    const id = idByName.get(c.name) ?? `pending:${c.slug}`
    idBySlug.set(c.slug, id); slugById.set(id, c.slug)
  }
  return { idBySlug, slugById }
}

export async function orgSubscriptions(orgId: string) {
  return prisma.orgPackSubscription.findMany({ where: { orgId }, orderBy: { packId: 'asc' } })
}
