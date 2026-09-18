/**
 * seed-persona-playbooks.ts — adds 2 persona-specific PlaybookPosition rows
 * per persona on top of the generic seed. Idempotent: skips positions
 * already present for the same (orgId, clauseCategoryId, positionType).
 *
 * Per the original Phase 3 plan §3 — "1–2 playbooks per persona" — that
 * piece was missed in the initial seed-personas.ts. This catches up.
 *
 * Each persona gets two opinionated, persona-flavored playbook positions
 * that reflect its real-world buying or selling profile:
 *
 *   Vertex Cloud      → Sales-MSA liability cap (12 months ARR fees) +
 *                       Mutual-NDA term (2 years, California)
 *   Caldera Health    → BAA breach notification (30 days max) +
 *                       DPA sub-processor disclosure (mandatory list attached)
 *   Ironbridge Ind.   → Supplier price-escalation cap (CPI + 2%) +
 *                       Force-majeure tariff carve-out (excluded from FM)
 *   Lumen Bio         → Pharma collaboration IP carve-out (Lumen retains BG-IP) +
 *                       Sponsored research publication right (12-month embargo max)
 *   Beacon Logistics  → Customer-SLA liability cap (1× monthly fees) +
 *                       Carrier cargo-liability minimum (Carmack default = $100K)
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/seed-persona-playbooks.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface PlaybookSpec {
  /** ClauseCategory.name to attach to (must already exist via seedOrgDefaults) */
  clauseCategoryName: string
  positionType: 'preferred' | 'acceptable' | 'fallback' | 'walkaway'
  contentHtml: string
  notes: string
  riskThreshold: number   // 0-1
  contractTypes?: string[]   // [] = all types
}

interface PersonaPlaybooks {
  slug: string
  positions: PlaybookSpec[]
}

const PLAYBOOKS: PersonaPlaybooks[] = [
  {
    slug: 'vertex-cloud',
    positions: [
      {
        clauseCategoryName: 'Limitation of Liability',
        positionType: 'preferred',
        contentHtml: '<p><strong>Sales MSA — Liability Cap (preferred):</strong> Each Party\'s aggregate liability shall not exceed <strong>twelve (12) months of fees</strong> paid or payable in the twelve months preceding the claim. Indirect / consequential / lost profits excluded for both parties. Carve-outs from cap: IP indemnification, breach of confidentiality, gross negligence, willful misconduct.</p>',
        notes: 'Standard Vertex sales position. ≥18 months = walkaway for prospects under $250K ARR; 12 months = preferred for all sales contracts.',
        riskThreshold: 0.4,
        contractTypes: ['MSA', 'ORDER_FORM'],
      },
      {
        clauseCategoryName: 'Confidentiality',
        positionType: 'preferred',
        contentHtml: '<p><strong>Mutual NDA — Term (preferred):</strong> Two (2) year term from Effective Date. Confidentiality obligations survive five (5) years post-termination for trade-secret information; three (3) years for all other Confidential Information. Governing law: <strong>California</strong>. No automatic renewal.</p>',
        notes: 'Vertex sales NDA standard. Sara (Sales Ops) can self-serve at 2-year/CA. Anything longer (3-year+) flows to Maya for review.',
        riskThreshold: 0.3,
        contractTypes: ['NDA'],
      },
    ],
  },
  {
    slug: 'caldera-health',
    positions: [
      {
        clauseCategoryName: 'Confidentiality',
        positionType: 'preferred',
        contentHtml: '<p><strong>BAA — Breach Notification Timing (preferred):</strong> Business Associate shall notify Covered Entity of any Breach of Unsecured PHI within <strong>thirty (30) calendar days</strong> of discovery, with substantive notice (date, scope, remedial actions) within five (5) business days. Tail-end breach reports (forensic completion) within sixty (60) days. Immediate phone notification for breaches affecting ≥500 individuals.</p>',
        notes: 'HIPAA Security Rule §164.410 default is 60 days; we commit to 30. Marcus (DPO) reviews any BAA proposing >30 days.',
        riskThreshold: 0.5,
        contractTypes: ['OTHER'],
      },
      {
        clauseCategoryName: 'Confidentiality',
        positionType: 'preferred',
        contentHtml: '<p><strong>DPA — Sub-processor Disclosure (preferred):</strong> Caldera maintains a current sub-processor list as <strong>Schedule A</strong> attached to every DPA. New sub-processors require thirty (30) days advance written notice. Customer may object within fifteen (15) days; if no resolution, customer may terminate without penalty for the affected services. List MUST be attached at signature — no DPA ships with placeholder.</p>',
        notes: 'GDPR Art. 28 + HIPAA conduit-rule alignment. Tom (Procurement) blocks any DPA without an attached sub-processor schedule.',
        riskThreshold: 0.6,
        contractTypes: ['DATA_PROCESSING'],
      },
    ],
  },
  {
    slug: 'ironbridge-industrial',
    positions: [
      {
        clauseCategoryName: 'IP Ownership',
        positionType: 'preferred',
        contentHtml: '<p><strong>Supplier MSA — Price Escalation Cap (preferred):</strong> Supplier may adjust pricing no more than once per twelve (12) months. Annual increase capped at <strong>CPI-U (All Urban Consumers) + 2.0%</strong> per year. Material-cost passthroughs (steel, aluminum, copper) capped at quoted spot-index ± 8% YoY. Notice: minimum 90 days written notice; right to terminate without penalty if increase exceeds 5%.</p>',
        notes: 'Ironbridge supplier-risk standard. Carla applies on every Supplier MSA ≥$50K. Margaret reviews any deviation.',
        riskThreshold: 0.5,
        contractTypes: ['VENDOR_AGREEMENT', 'MSA'],
      },
      {
        clauseCategoryName: 'Limitation of Liability',
        positionType: 'preferred',
        contentHtml: '<p><strong>Supplier MSA — Force-Majeure Tariff Carve-out (preferred):</strong> Force-majeure events EXCLUDE government-imposed tariffs, duties, sanctions, or trade restrictions enacted after the Effective Date. Supplier remains obligated to perform under contracted terms; tariff impact shall be allocated per the price-escalation cap (above) — not invoked as force majeure. Limited carve-back: if combined tariff impact exceeds 15% of contract value, parties shall renegotiate in good faith for 60 days.</p>',
        notes: '2026 steel-tariff response. Specifically blocks force-majeure invocation for politically-driven cost increases. Required on all post-2026 supplier MSAs.',
        riskThreshold: 0.7,
        contractTypes: ['VENDOR_AGREEMENT', 'MSA'],
      },
    ],
  },
  {
    slug: 'lumen-bio',
    positions: [
      {
        clauseCategoryName: 'IP Ownership',
        positionType: 'preferred',
        contentHtml: '<p><strong>Pharma Collaboration — IP Carve-out (preferred):</strong> Lumen retains all rights to <strong>Background IP</strong> (developed before or independent of the Collaboration), including all antibody platforms, discovery libraries, and proprietary screening methods. Foreground IP (developed during the Collaboration) is jointly owned, with each party having full freedom to operate within its respective field. Any IP assigned EXCLUSIVELY to the counterparty must trigger a separate License Agreement with milestone payments.</p>',
        notes: 'Lumen\'s core IP protection. Aria reviews every Sponsored Research and Pharma Collab. Walkaway if counterparty insists on exclusive ownership of Background IP.',
        riskThreshold: 0.7,
        contractTypes: ['OTHER', 'PARTNERSHIP', 'LICENSE'],
      },
      {
        clauseCategoryName: 'IP Ownership',
        positionType: 'preferred',
        contentHtml: '<p><strong>Sponsored Research — Publication Right (preferred):</strong> Lumen retains the right to publish results of all Sponsored Research, subject to a <strong>twelve (12) month embargo</strong> from completion of the work for the sponsor to file patents on Foreground IP. Sponsor may extend embargo by an additional six (6) months on written request. After embargo, Lumen may publish without consent. Sponsor may NOT block publication permanently — only delay for IP filing.</p>',
        notes: 'Academic-style publication right preserved. Critical for PI recruitment. Aria walkaway if counterparty insists on permanent secrecy.',
        riskThreshold: 0.6,
        contractTypes: ['OTHER', 'PARTNERSHIP'],
      },
    ],
  },
  {
    slug: 'beacon-logistics',
    positions: [
      {
        clauseCategoryName: 'Limitation of Liability',
        positionType: 'preferred',
        contentHtml: '<p><strong>Customer SLA — Liability Cap (preferred):</strong> Beacon\'s aggregate liability for service-level failures, late deliveries, or operational errors shall not exceed <strong>one (1) month of fees</strong> paid by the customer in the trailing 30 days. Service credits (per the SLA matrix) are the exclusive remedy for missed SLAs. Carve-outs from cap: gross negligence, willful misconduct, breach of confidentiality, IP indemnification.</p>',
        notes: 'Beacon customer-SLA standard. Hannah applies on every customer agreement <$1M ARR. Dean reviews any deviation, especially for retail customers (Walmart-class).',
        riskThreshold: 0.5,
        contractTypes: ['SLA', 'MSA'],
      },
      {
        clauseCategoryName: 'Limitation of Liability',
        positionType: 'preferred',
        contentHtml: '<p><strong>Carrier Agreement — Cargo Liability Floor (preferred):</strong> Carrier shall maintain cargo liability insurance with a <strong>minimum per-occurrence coverage of $100,000</strong> (Carmack Amendment default for motor carriers; higher for ocean / air per Hague-Visby or Montreal Convention). Cargo loss claims shall be paid within 30 days of documentation. Beacon may require declared-value coverage for shipments >$50K with cost passthrough. Excluded: acts of war, contraband, customer-packed misdeclared cargo.</p>',
        notes: 'Required on every carrier onboarding. Chris (carrier-side) blocks any agreement with sub-Carmack limits without explicit Eli (compliance) sign-off.',
        riskThreshold: 0.6,
        contractTypes: ['VENDOR_AGREEMENT'],
      },
    ],
  },
]

async function main() {
  console.log('━━━ Seeding persona-specific playbook positions ━━━\n')
  let created = 0
  let skipped = 0
  let missingCategory = 0

  for (const p of PLAYBOOKS) {
    const org = await prisma.organization.findUnique({
      where: { slug: p.slug }, select: { id: true, name: true },
    })
    if (!org) {
      console.log(`  ✗ ${p.slug}: org not found`)
      continue
    }
    // Find first user as creator
    const admin = await prisma.user.findFirst({
      where: { orgId: org.id }, select: { id: true },
    })
    if (!admin) continue

    console.log(`\n  ${org.name}`)
    for (const pos of p.positions) {
      const cat = await prisma.clauseCategory.findFirst({
        where: { orgId: org.id, name: pos.clauseCategoryName },
        select: { id: true },
      })
      if (!cat) {
        console.log(`    ✗ category "${pos.clauseCategoryName}" not found, skipping`)
        missingCategory++
        continue
      }
      // Idempotency: skip if (orgId, categoryId, positionType, content prefix) exists
      const existing = await prisma.playbookPosition.findFirst({
        where: {
          orgId: org.id,
          clauseCategoryId: cat.id,
          positionType: pos.positionType,
          content: { startsWith: pos.contentHtml.slice(0, 60) },
        },
      })
      if (existing) {
        skipped++
        continue
      }
      await prisma.playbookPosition.create({
        data: {
          orgId:            org.id,
          clauseCategoryId: cat.id,
          positionType:     pos.positionType,
          content:          pos.contentHtml,
          notes:            pos.notes,
          riskThreshold:    pos.riskThreshold,
          contractTypes:    pos.contractTypes ?? [],
          createdById:      admin.id,
        },
      })
      created++
      console.log(`    ✓ ${pos.clauseCategoryName} / ${pos.positionType}`)
    }
  }

  console.log(`\n━━━ ${created} created, ${skipped} skipped, ${missingCategory} missing-category ━━━`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
