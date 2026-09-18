/**
 * org-seed — pre-loaded library for every new org.
 *
 * This file replaces the original no-op stub. The real implementation lives
 * in the `org-seed/` directory (universal content + 5 industry packs);
 * this file is the public re-export so existing import paths keep working.
 *
 *   import { seedOrgDefaults } from '../lib/org-seed.js'   // ← unchanged
 *
 * Callers:
 *   - signup endpoint            (routes/auth.ts:121)
 *   - demo seed                  (prisma/seed.ts:236)
 *   - seed-personas script       (scripts/seed-personas.ts)
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
} from './org-seed/index.js'
