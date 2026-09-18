/**
 * org-seed — public surface.
 *
 * Replaces the original stub at `apps/api/src/lib/org-seed.ts` (which only
 * exported types and a no-op `seedOrgDefaults`). All exports below match the
 * stub's original signatures, so callers (signup at `routes/auth.ts:121` and
 * `prisma/seed.ts:236`) need no change.
 */

export {
  seedOrgDefaults,
  applyIndustryPack,
  UNIVERSAL_COUNTS,
  PACK_COUNTS,
  INDUSTRY_PACK_INFO,
  type IndustryPackId,
  type SeedOrgOptions,
  type SeedReport,
} from './seed.js'
