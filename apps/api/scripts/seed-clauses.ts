/**
 * seed-clauses.ts — populate ContractClause rows for persona-seeded contracts.
 *
 * Two paths:
 *   1. ANCHORS (5 contracts, one per persona): trigger the real extract-ai
 *      pipeline (queueExtractAi → agents service /review → ContractClause
 *      rows). This proves the pipeline works end-to-end on our seed.
 *   2. EVERYTHING ELSE (~795 contracts): deterministically split each
 *      contract's htmlContent by <h3> headings and write ContractClause
 *      rows directly. No LLM cost, no extraction time.
 *
 * Why two paths: running the real pipeline on 800 contracts is expensive
 * (LLM per call, sequential) and we don't need it — we already know the
 * pipeline works once we verify on 5 anchors. The other 795 just need
 * structured-clause data that the agent's clause_search / playbook_check /
 * contract_validate tools can read.
 *
 * Idempotent: skips contracts that already have clauses.
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/seed-clauses.ts                # both paths
 *   pnpm tsx --env-file=.env scripts/seed-clauses.ts anchors        # anchors only
 *   pnpm tsx --env-file=.env scripts/seed-clauses.ts synthesize     # synth only
 */
import { PrismaClient } from '@prisma/client'
import { queueExtractAi } from '../src/lib/queue.js'
import { indexContract } from '../src/lib/elasticsearch.js'

const prisma = new PrismaClient()

// ─── Anchor selection ─────────────────────────────────────────────────────

interface AnchorSpec {
  personaSlug: string
  /** Title patterns ranked by preference; first match wins */
  titlePatterns: string[]
  /** Fall-back filter if no title pattern matches */
  fallback: { counterparty: string; type?: string }
}

const ANCHORS: AnchorSpec[] = [
  {
    personaSlug: 'vertex-cloud',
    titlePatterns: ['Snowflake — Master Services Agreement'],
    fallback: { counterparty: 'Snowflake', type: 'MSA' },
  },
  {
    personaSlug: 'caldera-health',
    titlePatterns: ['Pfizer — Business Associate Agreement'],
    fallback: { counterparty: 'Pfizer' },
  },
  {
    personaSlug: 'ironbridge-industrial',
    titlePatterns: ['ArcelorMittal — Supplier Master Agreement'],
    fallback: { counterparty: 'ArcelorMittal', type: 'VENDOR_AGREEMENT' },
  },
  {
    personaSlug: 'lumen-bio',
    titlePatterns: ['Pfizer — Confidential Disclosure Agreement'],
    fallback: { counterparty: 'Pfizer', type: 'NDA' },
  },
  {
    personaSlug: 'beacon-logistics',
    titlePatterns: ['Walmart — Customer Service Level Agreement'],
    fallback: { counterparty: 'Walmart', type: 'SLA' },
  },
]

// ─── Heading → clause-type mapping ────────────────────────────────────────

/** Map a human-readable section heading to a canonical clauseType key. */
function clauseTypeFromHeading(heading: string): string {
  const h = heading.toLowerCase()
  // Order matters — more specific first
  if (h.includes('breach notification')) return 'breach_notification'
  if (h.includes('safeguard'))           return 'hipaa_safeguards'
  if (h.includes('permitted use'))       return 'hipaa_permitted_uses'
  if (h.includes('sub-processor') || h.includes('sub-contractor') || h.includes('subcontractor')) return 'sub_processors'
  if (h.includes('cross-border') || h.includes('data transfer')) return 'data_transfers'
  if (h.includes('limitation of liability') || h.includes('liability cap')) return 'limitation_of_liability'
  if (h.includes('indemnif'))            return 'indemnification'
  if (h.includes('confidentiality') || h.includes('confidential information')) return 'confidentiality'
  if (h.includes('intellectual property') || h.includes('ip ')) return 'ip_assignment'
  if (h.includes('ip assignment'))       return 'ip_assignment'
  if (h.includes('payment') || h.includes('fees') || h.includes('royalt')) return 'payment'
  if (h.includes('service level') || h.includes('sla'))         return 'service_levels'
  if (h.includes('service credit'))      return 'service_credits'
  if (h.includes('volume commit'))       return 'volume_commitments'
  if (h.includes('cargo liab'))          return 'cargo_liability'
  if (h.includes('fuel surcharge'))      return 'fuel_surcharge'
  if (h.includes('force majeure'))       return 'force_majeure'
  if (h.includes('audit'))               return 'audit_rights'
  if (h.includes('warranty') || h.includes('quality'))          return 'warranty'
  if (h.includes('pricing') || h.includes('price'))             return 'pricing'
  if (h.includes('term') && h.includes('terminat'))             return 'term_termination'
  if (h.includes('terminat'))            return 'termination'
  if (h.includes('term'))                return 'term'
  if (h.includes('governing law'))       return 'governing_law'
  if (h.includes('exclusivity') || h.includes('no-shop'))       return 'exclusivity'
  if (h.includes('non-binding'))         return 'non_binding'
  if (h.includes('proposed transaction')) return 'transaction_terms'
  if (h.includes('grant'))               return 'license_grant'
  if (h.includes('insurance'))           return 'insurance'
  if (h.includes('use'))                 return 'permitted_use'
  if (h.includes('rent'))                return 'rent'
  if (h.includes('territory') || h.includes('exclusivity'))     return 'territory'
  if (h.includes('publication'))         return 'publication'
  if (h.includes('funding'))             return 'funding'
  if (h.includes('duties') || h.includes('at-will'))            return 'employment_duties'
  if (h.includes('scope'))               return 'scope'
  if (h.includes('change order'))        return 'change_orders'
  if (h.includes('deliverable'))         return 'deliverables'
  if (h.includes('services'))            return 'services'
  return 'general'
}

/** Risk rating: distribute deterministically by contract risk score. */
function riskRatingFor(contractRiskScore: number | null, clauseIdx: number): string {
  // Lower risk → mostly neutral/favorable; higher risk → more unfavorable.
  const r = (contractRiskScore ?? 0.2) + (clauseIdx % 3) * 0.05
  if (r < 0.2)  return 'favorable'
  if (r < 0.45) return 'neutral'
  if (r < 0.7)  return 'unfavorable'
  return 'unusual'
}

/** Strip basic HTML tags + collapse whitespace. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

interface ParsedClause {
  heading: string
  clauseType: string
  sectionRef: string
  content: string
  sortOrder: number
}

/**
 * Split an htmlContent body by <h3> headings into clause sections. The first
 * <h3> (if any) is the start of section 1; everything before that is the
 * preamble (assigned to a 'recitals' clause if non-empty).
 */
function parseClauses(html: string): ParsedClause[] {
  // Match <h3>…</h3> + everything up to the next <h3> or end of string
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3[^>]*>|$)/gi
  const out: ParsedClause[] = []
  // Capture preamble (everything before first <h3>) as a 'recitals' section
  const firstH3 = html.search(/<h3/i)
  if (firstH3 > 0) {
    const preamble = stripHtml(html.slice(0, firstH3))
    if (preamble.length > 60) {
      out.push({
        heading: 'Recitals',
        clauseType: 'recitals',
        sectionRef: 'Recitals',
        content: preamble,
        sortOrder: 0,
      })
    }
  }
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(html)) !== null) {
    i++
    const heading = stripHtml(m[1]).replace(/^\d+\.?\s*/, '')   // drop leading "1." / "2."
    const body = stripHtml(m[2])
    if (!heading || body.length < 20) continue
    out.push({
      heading,
      clauseType: clauseTypeFromHeading(heading),
      sectionRef: `Section ${i}`,
      content: body,
      sortOrder: out.length,
    })
  }
  return out
}

/**
 * Plain-English interpretation: short paraphrase tailored to the clause type.
 * For seed data this can be templated; production extraction would use an LLM.
 */
function interpretation(clauseType: string, content: string): string {
  const snippet = content.length > 120 ? `${content.slice(0, 120)}…` : content
  const map: Record<string, string> = {
    limitation_of_liability: 'Caps each party\'s financial exposure under this agreement.',
    indemnification:         'Defines who pays for third-party claims and damages.',
    confidentiality:         'Protects non-public information shared between the parties.',
    breach_notification:     'Specifies how quickly a breach must be reported.',
    hipaa_safeguards:        'Required HIPAA security safeguards for PHI.',
    hipaa_permitted_uses:    'Defines what the Business Associate may do with PHI.',
    sub_processors:          'Rules for using third parties to handle data.',
    data_transfers:          'Conditions for moving data across borders.',
    governing_law:           'Picks which jurisdiction\'s law applies.',
    payment:                 'Payment timing, amount, and consequences for late payment.',
    service_levels:          'Performance commitments (uptime, response time, etc.).',
    service_credits:         'Money back when service levels are missed.',
    volume_commitments:      'Minimum volumes a customer commits to.',
    cargo_liability:         'Carrier\'s liability cap for lost or damaged cargo.',
    fuel_surcharge:          'How fuel cost changes flow through to pricing.',
    force_majeure:           'Excused-performance events (war, pandemic, etc.).',
    audit_rights:            'Customer\'s right to audit the supplier.',
    warranty:                'Promises about quality and conformance.',
    pricing:                 'Price and adjustment mechanics.',
    term_termination:        'Duration and how either party can exit.',
    termination:             'How and when the agreement ends.',
    term:                    'Effective and expiry dates.',
    ip_assignment:           'Who owns intellectual property created under the agreement.',
    license_grant:           'Scope of license rights granted.',
    exclusivity:             'No-shop / exclusivity restrictions.',
    insurance:               'Required insurance coverage.',
    rent:                    'Rent amount, frequency, and adjustments.',
    territory:               'Geographic scope of the rights granted.',
    publication:             'Rules for publishing research findings.',
    funding:                 'Budget and milestone-based payments.',
    employment_duties:       'Scope of employment and at-will status.',
    scope:                   'What work is covered.',
    change_orders:           'Process for adding or modifying scope.',
    deliverables:            'What gets delivered and when.',
    services:                'High-level description of services.',
    transaction_terms:       'Headline financial terms of the deal.',
    non_binding:             'Which provisions of the LOI are binding.',
    permitted_use:           'Allowed uses of the leased premises or licensed material.',
    recitals:                'Background context and the parties.',
    general:                 'Standard contract provision.',
  }
  return `${map[clauseType] ?? 'Standard contract provision.'} (${snippet})`
}

// ─── Path 1 — Anchor extraction (real pipeline) ───────────────────────────

async function findAnchorContract(spec: AnchorSpec): Promise<{ id: string; orgId: string; versionId: string; type: string; title: string } | null> {
  const org = await prisma.organization.findUnique({
    where: { slug: spec.personaSlug }, select: { id: true },
  })
  if (!org) return null

  // Try exact title match first
  for (const pat of spec.titlePatterns) {
    const c = await prisma.contract.findFirst({
      where: { orgId: org.id, title: pat },
      select: { id: true, type: true, title: true,
        versions: { select: { id: true }, orderBy: { versionNumber: 'desc' }, take: 1 },
      },
    })
    if (c?.versions[0]) {
      return { id: c.id, orgId: org.id, versionId: c.versions[0].id, type: c.type, title: c.title }
    }
  }
  // Fallback: any contract with the named counterparty
  const c = await prisma.contract.findFirst({
    where: {
      orgId: org.id,
      counterpartyName: spec.fallback.counterparty,
      ...(spec.fallback.type ? { type: spec.fallback.type } : {}),
    },
    select: { id: true, type: true, title: true,
      versions: { select: { id: true }, orderBy: { versionNumber: 'desc' }, take: 1 },
    },
  })
  if (c?.versions[0]) {
    return { id: c.id, orgId: org.id, versionId: c.versions[0].id, type: c.type, title: c.title }
  }
  return null
}

async function runAnchorExtraction(): Promise<void> {
  console.log('\n━━━ Path 1 — Real extraction pipeline on 5 anchors ━━━\n')
  for (const spec of ANCHORS) {
    const anchor = await findAnchorContract(spec)
    if (!anchor) {
      console.log(`  ✗ ${spec.personaSlug}: anchor not found, skipping`)
      continue
    }
    // Skip if clauses already exist
    const existing = await prisma.contractClause.count({ where: { versionId: anchor.versionId } })
    if (existing > 0) {
      console.log(`  ↷ ${spec.personaSlug}: "${anchor.title}" already has ${existing} clauses, skipping`)
      continue
    }
    queueExtractAi({
      contractId: anchor.id,
      versionId:  anchor.versionId,
      orgId:      anchor.orgId,
      contractType: anchor.type,
      triggeredBy:  'seed-clauses-anchor',
    })
    console.log(`  ⟳ ${spec.personaSlug}: queued extract-ai for "${anchor.title}"`)
  }

  // Poll for completion (up to 90s per anchor)
  console.log('\n  Waiting for anchor extractions to finish (poll every 3s)…')
  const start = Date.now()
  const TIMEOUT_MS = 180_000
  while (Date.now() - start < TIMEOUT_MS) {
    let allDone = true
    for (const spec of ANCHORS) {
      const anchor = await findAnchorContract(spec)
      if (!anchor) continue
      const count = await prisma.contractClause.count({ where: { versionId: anchor.versionId } })
      if (count === 0) { allDone = false; break }
    }
    if (allDone) break
    await new Promise(r => setTimeout(r, 3000))
  }

  // Final report
  for (const spec of ANCHORS) {
    const anchor = await findAnchorContract(spec)
    if (!anchor) continue
    const count = await prisma.contractClause.count({ where: { versionId: anchor.versionId } })
    console.log(`  ${count > 0 ? '✓' : '✗'} ${spec.personaSlug}: "${anchor.title}" → ${count} clauses`)
  }
}

// ─── Path 2 — Synthetic clause seeding for everything else ────────────────

async function runSyntheticSeed(): Promise<void> {
  console.log('\n━━━ Path 2 — Synthesize clauses for the other ~795 contracts ━━━\n')
  const personaOrgIds = (await Promise.all(
    ANCHORS.map(a => prisma.organization.findUnique({ where: { slug: a.personaSlug }, select: { id: true } }))
  )).map(o => o?.id).filter(Boolean) as string[]

  // Pull all persona contracts that DON'T already have clauses
  const allContracts = await prisma.contract.findMany({
    where: { orgId: { in: personaOrgIds } },
    select: {
      id: true, orgId: true, title: true, type: true, riskScore: true,
      versions: {
        select: { id: true, htmlContent: true },
        orderBy: { versionNumber: 'desc' }, take: 1,
      },
    },
  })

  let created = 0
  let skipped = 0
  let parseFailed = 0

  for (const c of allContracts) {
    if (!c.versions[0]) continue
    const versionId = c.versions[0].id

    const existing = await prisma.contractClause.count({ where: { versionId } })
    if (existing > 0) { skipped++; continue }

    const parsed = parseClauses(c.versions[0].htmlContent)
    if (parsed.length === 0) {
      parseFailed++
      continue
    }

    await prisma.contractClause.createMany({
      data: parsed.map(p => ({
        versionId,
        clauseType:     p.clauseType,
        content:        p.content,
        interpretation: interpretation(p.clauseType, p.content),
        riskRating:     riskRatingFor(c.riskScore, p.sortOrder),
        sectionRef:     p.sectionRef,
        sortOrder:      p.sortOrder,
        reviewState:    'unreviewed',
      })),
    })
    created += parsed.length
  }

  console.log(`  ✓ Synthesized ${created} clauses across ${allContracts.length - skipped - parseFailed} contracts`)
  console.log(`  ↷ Skipped ${skipped} contracts (already had clauses)`)
  if (parseFailed > 0) console.log(`  ⚠ ${parseFailed} contracts had no parseable <h3> sections`)
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2]
  if (arg === 'anchors') {
    await runAnchorExtraction()
  } else if (arg === 'synthesize') {
    await runSyntheticSeed()
  } else {
    await runAnchorExtraction()
    await runSyntheticSeed()
  }

  // Final stats
  console.log('\n━━━ Final stats ━━━')
  const personaOrgIds = (await Promise.all(
    ANCHORS.map(a => prisma.organization.findUnique({ where: { slug: a.personaSlug }, select: { id: true } }))
  )).map(o => o?.id).filter(Boolean) as string[]
  for (const slug of ANCHORS.map(a => a.personaSlug)) {
    const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true, name: true } })
    if (!org) continue
    const total = await prisma.contractClause.count({
      where: { version: { contract: { orgId: org.id } } },
    })
    console.log(`  ${org.name.padEnd(28)} → ${total} ContractClause rows`)
  }
}

main()
  .catch(e => { console.error('seed-clauses failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
