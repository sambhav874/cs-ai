/**
 * Mapping a clause's `clauseType` onto an org's `ClauseCategory`.
 *
 * There is no foreign key between them — clauseType is a free-text label the
 * extractor produces (`limitation_of_liability`) and category names are
 * human-written (`Limitation of Liability`). The join is by normalised name.
 *
 * This lived in three places with three different rules:
 *
 *   internal-ai.ts     `s.replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().toLowerCase()`
 *   clause-propose.ts  `clause.clauseType.replace(/_/g, ' ')`  (case-insensitive equals)
 *   internal-ai.ts     substring containment, in org_memory
 *
 * They disagree. A category named `limitation-of-liability` resolves in the
 * checker and misses in the rewriter — and a miss there is silent: the rewrite
 * simply runs with `hasPlaybook: false` and invents language from the clause
 * alone, with nothing in the response saying the playbook was lost. That is the
 * worst kind of failure for this feature, because the output still looks like a
 * playbook-grounded redline.
 */
import { prisma } from './prisma.js'

/**
 * Collapse a clauseType or category name to a comparable key.
 * Underscores, hyphens and whitespace runs all become single spaces.
 */
export function normalisedKey(s: string): string {
  return s.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

export interface MatchedCategory { id: string; name: string }

/**
 * Resolve one clauseType to a category for an org.
 *
 * Matching happens in memory rather than in SQL because the normalisation is
 * not expressible as a Postgres comparison without a functional index, and an
 * org has on the order of 3–20 categories.
 */
export async function findCategoryForClauseType(
  orgId: string,
  clauseType: string,
): Promise<MatchedCategory | null> {
  const categories = await prisma.clauseCategory.findMany({
    where: { orgId },
    select: { id: true, name: true },
  })
  return matchCategory(categories, clauseType)
}

/**
 * The extractor's clause types (review_agent.py) and the category names the
 * seeded playbook uses do not line up: the extractor says `payment`,
 * `termination`, `ip_ownership`; the playbook says "Fees & Payment", "Term &
 * Termination", "Intellectual Property". With exact matching alone most
 * clauses of a real contract resolved to no category, the checker reported
 * them unmapped and the rewriter ran without the playbook.
 *
 * This table is the bridge. It is explicit on purpose — every entry is a
 * known extractor type and the category names that mean the same thing, tried
 * in order — so it cannot drift into the substring guessing this module
 * exists to prevent. `and` and `&` are the same word here.
 */
const CLAUSE_TYPE_ALIASES: Record<string, string[]> = {
  payment:                   ['fees & payment', 'payment terms', 'fees'],
  price_adjustment:          ['fees & payment', 'payment', 'pricing'],
  minimum_commitment:        ['fees & payment', 'payment'],
  termination:               ['term & termination', 'term'],
  post_termination_services: ['term & termination', 'termination'],
  auto_renewal:              ['term & termination', 'renewal', 'termination'],
  renewal_term:              ['term & termination', 'renewal', 'termination'],
  confidential_info_definition: ['confidentiality'],
  ip_ownership:              ['intellectual property', 'intellectual property rights', 'ip'],
  ip_license_back:           ['intellectual property', 'ip ownership'],
  license_grant:             ['intellectual property', 'license', 'licence'],
  joint_ip:                  ['intellectual property', 'ip ownership'],
  source_code_escrow:        ['intellectual property', 'escrow'],
  representations_warranties: ['representations & warranties', 'warranties'],
  warranty:                  ['representations & warranties', 'warranties'],
  warranty_duration:         ['representations & warranties', 'warranty', 'warranties'],
  uncapped_liability:        ['limitation of liability'],
  liquidated_damages:        ['limitation of liability'],
  force_majeure:             ['force majeure & excused events'],
  assignment:                ['assignment & change of control'],
  change_of_control:         ['assignment & change of control', 'assignment'],
  notice:                    ['notices & miscellaneous', 'notices'],
  governing_law:             ['dispute resolution', 'governing law & dispute resolution'],
  dispute_resolution:        ['governing law & dispute resolution', 'governing law'],
  data_protection:           ['data protection & privacy', 'privacy', 'data privacy'],
  acceptance:                ['scope of services', 'acceptance testing'],
  audit_rights:              ['audit'],
}

const sameWord = (k: string) => k.replace(/\band\b/g, '&')

/** Pure form, for callers that already hold the org's categories. */
export function matchCategory(
  categories: MatchedCategory[],
  clauseType: string,
): MatchedCategory | null {
  const key = sameWord(normalisedKey(clauseType))
  if (!key) return null
  const byKey = new Map<string, MatchedCategory>()
  for (const c of categories) {
    const k = sameWord(normalisedKey(c.name))
    if (!byKey.has(k)) byKey.set(k, c)
  }
  const exact = byKey.get(key)
  if (exact) return exact
  const aliases = CLAUSE_TYPE_ALIASES[normalisedKey(clauseType).replace(/ /g, '_')] ?? []
  for (const a of aliases) {
    const hit = byKey.get(sameWord(a))
    if (hit) return hit
  }
  return null
}
