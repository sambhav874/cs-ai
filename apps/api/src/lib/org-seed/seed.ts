/**
 * Org defaults — the universal library at signup, an industry pack on request.
 *
 * Both now come from the repository's packs/ directory through lib/packs.ts
 * (merge step 8). This used to copy draftLegal's TypeScript seed arrays into
 * org rows and skip any row already present, so a corrected clause never
 * reached an org that had installed it. An org now subscribes to a pack
 * version; see lib/packs.ts for install, upgrade and overrides.
 */
import { installablePacks, loadCategories, loadPack, syncPack, type PackDiff } from '../packs.js'

/** A pack an org can install: any directory under packs/ with a drafting half. */
export type IndustryPackId = string

export interface SeedOrgOptions {
  industryPack?: IndustryPackId
}

export interface SeedReport {
  categoriesCreated: number
  clausesCreated: number
  templatesCreated: number
  playbookPositionsCreated: number
  packApplied?: IndustryPackId
}

// ─── Legacy playbook seed marker ────────────────────────────────────────────
// Older seeds embedded a position's key as a "[seed-key:…]" prefix on notes,
// where every reviewer read it. routes/playbook.ts still cleans those rows.

const LEGACY_MARKER = /^\[seed-key:([^\]]+)\]\s*/

/** The seed key and clean notes from a legacy-marked note, or null. */
export function splitLegacyMarker(notes: string | null): { key: string; notes: string } | null {
  const m = (notes ?? '').match(LEGACY_MARKER)
  return m ? { key: m[1], notes: (notes ?? '').slice(m[0].length) } : null
}

function countsOf(diff: PackDiff) {
  const n = (kind: string) => diff.added.filter(k => k.startsWith(`${kind}:`)).length
  return { clausesCreated: n('clause'), templatesCreated: n('template'), playbookPositionsCreated: n('position') }
}

export async function seedOrgDefaults(
  orgId: string,
  _orgSlug: string,
  adminId: string,
  options: SeedOrgOptions = {},
): Promise<SeedReport> {
  const universal = countsOf(await syncPack(orgId, adminId, 'universal'))
  const report: SeedReport = { categoriesCreated: 0, ...universal }
  if (options.industryPack) {
    const pack = countsOf(await syncPack(orgId, adminId, options.industryPack))
    report.packApplied = options.industryPack
    report.clausesCreated += pack.clausesCreated
    report.templatesCreated += pack.templatesCreated
    report.playbookPositionsCreated += pack.playbookPositionsCreated
  }
  return report
}

export async function applyIndustryPack(
  orgId: string,
  adminId: string,
  packId: IndustryPackId,
): Promise<{ clausesCreated: number; templatesCreated: number; playbookPositionsCreated: number }> {
  return countsOf(await syncPack(orgId, adminId, packId))
}

// ─── What the packs hold ────────────────────────────────────────────────────

export interface PackCatalogEntry {
  id: IndustryPackId
  label: string
  description: string
  version: string
  counts: { clauses: number; templates: number; playbookPositions: number }
  /** Both halves: installing it also gives extraction this family's obligation classes. */
  extraction: boolean
}

/** The packs an org can install, read from packs/. */
export function packCatalog(): PackCatalogEntry[] {
  return installablePacks().map(p => {
    const counts = { clauses: p.clauses.length, templates: p.templates.length, playbookPositions: p.playbook.length }
    const extraction = (p.manifest.halves ?? []).includes('extraction')
    return {
      id: p.manifest.id,
      label: p.manifest.display_name ?? p.manifest.id,
      version: p.version,
      counts,
      extraction,
      description: `Adds ${counts.clauses} clauses, ${counts.templates} template${counts.templates === 1 ? '' : 's'} and `
        + `${counts.playbookPositions} playbook positions${extraction ? ', plus family-aware obligation extraction' : ''}. Version ${p.version}.`,
    }
  })
}

export function universalCounts() {
  const u = loadPack('universal')
  return { categories: loadCategories().length, clauses: u.clauses.length, playbookPositions: u.playbook.length, templates: u.templates.length }
}
