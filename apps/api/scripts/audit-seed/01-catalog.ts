/**
 * Audit corpus — R.2.2: catalog (users, counterparties, matters, templates,
 * playbook, clause library).
 *
 * Designed to make every screen in the manual audit (Phase Q) demonstrably
 * non-empty. Run BEFORE 02-contracts.ts so the contracts can FK into these.
 *
 * Idempotent: re-running upserts on email/name keys.
 *
 * Run:
 *   pnpm tsx --env-file=.env scripts/audit-seed/01-catalog.ts
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

interface SeedUser {
  email: string
  name: string
  role: string
  title?: string
}

const TEAM_USERS: SeedUser[] = [
  { email: 'legal@demo.com',       name: 'Maya Goldberg',     role: 'LEGAL_COUNSEL', title: 'General Counsel' },
  { email: 'sales@demo.com',       name: 'Daniel Park',       role: 'SALES_REP',     title: 'Senior Account Executive' },
  { email: 'procurement@demo.com', name: 'Lisa Chen',         role: 'PROCUREMENT',   title: 'Head of Procurement' },
  { email: 'finance@demo.com',     name: 'Marcus Reyes',      role: 'FINANCE',       title: 'CFO' },
  { email: 'hr@demo.com',          name: 'Emily Watanabe',    role: 'CONTRACT_MANAGER', title: 'Director of People' },
]

const COUNTERPARTIES: Array<{
  name: string
  legalName?: string
  email?: string
  website?: string
  contacts?: Array<{ name: string; email: string; role: string }>
  address?: string
}> = [
  {
    name: 'Acme Corporation',
    legalName: 'Acme Corporation, Inc.',
    email: 'legal@acme.com',
    website: 'https://acme.com',
    address: '500 Market Street, Suite 1200, San Francisco, CA 94105',
    contacts: [
      { name: 'Robert Chen',  email: 'rchen@acme.com',  role: 'General Counsel' },
      { name: 'Patricia Lee', email: 'plee@acme.com',   role: 'VP Procurement' },
    ],
  },
  {
    name: 'Zynga Holdings',
    legalName: 'Zynga Holdings, LLC',
    email: 'contracts@zynga-holdings.com',
    website: 'https://zynga-holdings.com',
    address: '699 8th Street, San Francisco, CA 94103',
    contacts: [
      { name: 'Michael O\'Brien',   email: 'mobrien@zynga-holdings.com',  role: 'Chief Legal Officer' },
      { name: 'Sarah Nakamura',    email: 'snakamura@zynga-holdings.com', role: 'VP Engineering' },
      { name: 'James Whitfield',   email: 'jwhitfield@zynga-holdings.com', role: 'Procurement Director' },
    ],
  },
  {
    name: 'Cloudwave Inc',
    legalName: 'Cloudwave Technologies, Inc.',
    email: 'partners@cloudwave.io',
    website: 'https://cloudwave.io',
    address: '1455 Market Street, San Francisco, CA 94103',
    contacts: [
      { name: 'David Kim', email: 'dkim@cloudwave.io', role: 'Reseller Lead' },
    ],
  },
  {
    name: 'Pacific Distribution Co.',
    legalName: 'Pacific Distribution Company',
    email: 'partnerships@pacificdist.com',
    website: 'https://pacificdist.com',
    address: '2200 Powell Street, Emeryville, CA 94608',
    contacts: [
      { name: 'Jennifer Hsu',  email: 'jhsu@pacificdist.com',  role: 'Channel Director' },
      { name: 'Thomas Wilson', email: 'twilson@pacificdist.com', role: 'Legal Counsel' },
    ],
  },
  {
    name: 'Datadog Inc',
    legalName: 'Datadog, Inc.',
    email: 'enterprise-legal@datadoghq.com',
    website: 'https://datadoghq.com',
    address: '620 8th Avenue, 45th Floor, New York, NY 10018',
    contacts: [
      { name: 'Rachel Stein', email: 'rstein@datadoghq.com', role: 'Enterprise Account Manager' },
    ],
  },
  {
    name: 'Salesforce.com',
    legalName: 'Salesforce.com, Inc.',
    email: 'contracts@salesforce.com',
    website: 'https://salesforce.com',
    address: 'Salesforce Tower, 415 Mission Street, San Francisco, CA 94105',
    contacts: [
      { name: 'Andrew Mitchell', email: 'amitchell@salesforce.com', role: 'Customer Success Director' },
    ],
  },
  {
    name: 'Bayview Property Management',
    legalName: 'Bayview Property Management, LP',
    email: 'leasing@bayviewpm.com',
    website: 'https://bayviewpm.com',
    address: '1 Embarcadero Center, Suite 3100, San Francisco, CA 94111',
    contacts: [
      { name: 'Nathan Brooks',  email: 'nbrooks@bayviewpm.com',  role: 'Director of Leasing' },
      { name: 'Vanessa Ortiz',  email: 'vortiz@bayviewpm.com',   role: 'Property Manager' },
    ],
  },
  {
    name: 'Asia Capital Partners',
    legalName: 'Asia Capital Partners Pte. Ltd.',
    email: 'hello@asiacapital.sg',
    website: 'https://asiacapital.sg',
    address: '8 Marina View, #28-01, Asia Square Tower 1, Singapore 018960',
    contacts: [
      { name: 'Wei-Ming Tan',   email: 'wtan@asiacapital.sg',   role: 'Managing Director, APAC' },
    ],
  },
  {
    name: 'Quill Technologies',
    legalName: 'Quill Technologies, LLC',
    email: 'legal@quilltech.com',
    website: 'https://quilltech.com',
    address: '1 Boston Place, Suite 2400, Boston, MA 02108',
    contacts: [
      { name: 'Howard Levin', email: 'hlevin@quilltech.com', role: 'General Counsel' },
    ],
  },
  {
    name: 'Hartwell Partners',
    legalName: 'Hartwell Strategic Partners, LLC',
    email: 'engagements@hartwellpartners.com',
    website: 'https://hartwellpartners.com',
    address: '300 Park Avenue, 22nd Floor, New York, NY 10022',
    contacts: [
      { name: 'Elena Ferraro', email: 'eferraro@hartwellpartners.com', role: 'Managing Partner' },
    ],
  },
  {
    name: 'Priya Raghavan',
    legalName: 'Priya Raghavan',
    email: 'priya.raghavan@personal-mail.com',
    address: '224 Valencia Street, San Francisco, CA 94103',
    contacts: [
      { name: 'Priya Raghavan', email: 'priya.raghavan@personal-mail.com', role: 'Candidate' },
    ],
  },
]

const MATTERS = [
  {
    name: 'Zynga MSA — multi-year SaaS engagement',
    description: 'Master Services Agreement and all SOWs / DPA / amendments with Zynga Holdings. Single source of truth for the engagement.',
    counterpartyName: 'Zynga Holdings',
    ownerEmail: 'legal@demo.com',
    tags: ['enterprise', 'saas', 'priority'],
  },
  {
    name: 'HQ relocation — 1 Embarcadero Center',
    description: 'New HQ commercial lease at Bayview Property Management. Includes lease, parking addendum, build-out riders.',
    counterpartyName: 'Bayview Property Management',
    ownerEmail: 'finance@demo.com',
    tags: ['real-estate', 'capex'],
  },
  {
    name: 'Quill dispute — settlement & release',
    description: 'Settlement agreement closing the 2025 vendor performance dispute with Quill Technologies.',
    counterpartyName: 'Quill Technologies',
    ownerEmail: 'legal@demo.com',
    tags: ['litigation', 'closed'],
  },
]

// Standard professional clause library (~12 items across 5 categories).
// All HTML-formatted so they paste cleanly into the editor.
const CLAUSE_CATEGORIES = [
  { name: 'Confidentiality',           description: 'Mutual NDA + survival' },
  { name: 'Limitation of Liability',   description: 'Caps + carve-outs' },
  { name: 'Payment Terms',             description: 'Invoicing + late fees' },
  { name: 'Term & Termination',        description: 'Initial term, renewal, termination rights' },
  { name: 'Governing Law',             description: 'Jurisdiction + dispute resolution' },
  { name: 'Indemnification',           description: 'Mutual indemnity scope' },
  { name: 'IP Ownership',              description: 'Pre-existing vs work product' },
  { name: 'Data Processing',           description: 'GDPR / CCPA addenda' },
]

const CLAUSE_ITEMS: Array<{
  category: string
  title: string
  content: string
  riskRating: 'favorable' | 'standard' | 'unfavorable'
  tags: string[]
}> = [
  {
    category: 'Confidentiality',
    title: 'Mutual confidentiality (5-year tail)',
    riskRating: 'standard',
    tags: ['NDA', 'mutual'],
    content: `<p>Each party (the "Receiving Party") agrees to hold all Confidential Information of the other party (the "Disclosing Party") in strict confidence and use the same degree of care to prevent unauthorized disclosure as it uses to protect its own confidential information of similar nature, but in no event less than reasonable care. The Receiving Party may disclose Confidential Information only to its employees, contractors, advisors, and affiliates who have a legitimate need to know and who are bound by written obligations of confidentiality at least as protective as this Agreement. The obligations under this Section shall survive for five (5) years following termination or expiration of this Agreement, except that obligations with respect to trade secrets shall survive for so long as such information remains a trade secret under applicable law.</p>`,
  },
  {
    category: 'Limitation of Liability',
    title: 'Mutual cap — 12 months of fees (with carve-outs)',
    riskRating: 'standard',
    tags: ['liability-cap', 'mutual'],
    content: `<p>EXCEPT FOR (i) BREACHES OF CONFIDENTIALITY, (ii) INDEMNIFICATION OBLIGATIONS, AND (iii) GROSS NEGLIGENCE OR WILLFUL MISCONDUCT, EACH PARTY'S AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THIS AGREEMENT SHALL NOT EXCEED THE FEES PAID OR PAYABLE BY CUSTOMER TO PROVIDER UNDER THIS AGREEMENT IN THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE TO LIABILITY. IN NO EVENT SHALL EITHER PARTY BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, REVENUE, DATA, OR USE.</p>`,
  },
  {
    category: 'Limitation of Liability',
    title: 'Aggressive cap — provider-favored ($100k absolute)',
    riskRating: 'unfavorable',
    tags: ['liability-cap', 'provider-favored'],
    content: `<p>Customer hereby waives any and all claims against Provider, including for negligence and breach. Provider's aggregate liability arising out of or relating to this Agreement, regardless of cause or theory of liability, shall not exceed one hundred thousand dollars (USD $100,000), even if Provider has been advised of the possibility of such damages.</p>`,
  },
  {
    category: 'Payment Terms',
    title: 'Net 30 with 1.5%/mo late fee',
    riskRating: 'standard',
    tags: ['payment', 'net-30'],
    content: `<p>Customer shall pay all undisputed invoices within thirty (30) days of receipt. Late payments shall accrue interest at the rate of one and one-half percent (1.5%) per month, or the maximum rate permitted by applicable law, whichever is less, calculated from the original due date until paid in full. Customer shall reimburse Provider for reasonable costs of collection, including attorneys' fees.</p>`,
  },
  {
    category: 'Payment Terms',
    title: 'Net 60 — buyer-favored',
    riskRating: 'favorable',
    tags: ['payment', 'net-60'],
    content: `<p>Customer shall pay all undisputed invoices within sixty (60) days of receipt of a properly issued invoice. No interest, late fees, or collection costs shall accrue against Customer for any payment made within ninety (90) days of receipt. Disputed amounts shall be addressed through the dispute-resolution process in Section [X] before any late payment is deemed to have occurred.</p>`,
  },
  {
    category: 'Term & Termination',
    title: 'Auto-renewal with 60-day notice',
    riskRating: 'standard',
    tags: ['renewal', 'auto-renew'],
    content: `<p>This Agreement shall commence on the Effective Date and continue for an initial term of one (1) year (the "Initial Term"). Thereafter, this Agreement shall automatically renew for successive one-year terms (each a "Renewal Term") unless either party provides written notice of non-renewal at least sixty (60) days prior to the end of the then-current term. Pricing for any Renewal Term shall be subject to a maximum increase equal to the lesser of (i) the change in CPI-U for the most recent twelve-month period or (ii) seven percent (7%).</p>`,
  },
  {
    category: 'Term & Termination',
    title: 'Termination for convenience (90-day notice)',
    riskRating: 'standard',
    tags: ['termination', 'convenience'],
    content: `<p>Either party may terminate this Agreement for convenience upon ninety (90) days' prior written notice to the other party. Upon termination for convenience by Customer, Customer shall pay Provider for all services performed through the effective date of termination plus any non-cancellable third-party costs reasonably incurred in performance of this Agreement. No early-termination penalty shall apply.</p>`,
  },
  {
    category: 'Governing Law',
    title: 'Delaware law + state-court jurisdiction',
    riskRating: 'standard',
    tags: ['delaware', 'jurisdiction'],
    content: `<p>This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware, without regard to its conflict-of-laws principles. Any dispute arising out of or relating to this Agreement shall be brought exclusively in the state or federal courts located in New Castle County, Delaware, and each party hereby consents to the personal jurisdiction of such courts.</p>`,
  },
  {
    category: 'Indemnification',
    title: 'Mutual IP infringement indemnity',
    riskRating: 'standard',
    tags: ['indemnity', 'ip', 'mutual'],
    content: `<p>Each party (the "Indemnifying Party") shall defend, indemnify, and hold harmless the other party and its officers, directors, employees, and affiliates (the "Indemnified Party") from and against any third-party claim alleging that the Indemnifying Party's intellectual property, products, or services (as supplied to the Indemnified Party in connection with this Agreement) infringe such third party's patent, copyright, trademark, or trade secret rights. The Indemnified Party shall provide prompt written notice of the claim, allow the Indemnifying Party to control the defense, and provide reasonable cooperation. The Indemnifying Party shall not settle any claim that imposes any obligation or liability on the Indemnified Party without prior written consent.</p>`,
  },
  {
    category: 'IP Ownership',
    title: 'Customer-owned work product (with provider tools license)',
    riskRating: 'standard',
    tags: ['ip', 'work-product'],
    content: `<p>All deliverables, work product, materials, and inventions created by Provider specifically for Customer under this Agreement (the "Work Product") shall be the sole and exclusive property of Customer. Provider hereby assigns to Customer all right, title, and interest, including all intellectual property rights, in and to the Work Product. Notwithstanding the foregoing, Provider retains all right, title, and interest in any pre-existing tools, methodologies, frameworks, or general knowledge ("Provider Tools") used in creating the Work Product. Provider hereby grants Customer a perpetual, worldwide, non-exclusive, royalty-free license to use the Provider Tools embedded in the Work Product solely for Customer's internal business purposes.</p>`,
  },
  {
    category: 'Data Processing',
    title: 'GDPR DPA — controller/processor terms',
    riskRating: 'standard',
    tags: ['gdpr', 'dpa', 'data'],
    content: `<p>To the extent Provider processes Personal Data on behalf of Customer in connection with this Agreement, Provider shall: (a) process Personal Data only on documented written instructions from Customer; (b) ensure persons authorized to process Personal Data are bound by confidentiality obligations; (c) implement appropriate technical and organizational measures consistent with Article 32 of the GDPR; (d) assist Customer with data subject rights requests, breach notifications, and DPIAs as required by Articles 32–36; (e) notify Customer of any Personal Data breach without undue delay and in any case within seventy-two (72) hours after becoming aware; (f) at Customer's election, delete or return all Personal Data after termination; and (g) make available to Customer all information necessary to demonstrate compliance with this Section, allowing for audits not more than once per year on thirty (30) days' written notice.</p>`,
  },
  {
    category: 'Term & Termination',
    title: 'Survival clause',
    riskRating: 'standard',
    tags: ['survival', 'termination'],
    content: `<p>The provisions of this Agreement that by their nature should survive termination or expiration shall so survive, including without limitation: confidentiality obligations, indemnification obligations, payment obligations accrued prior to termination, limitations of liability, governing law, dispute resolution, and any provision that expressly states it survives.</p>`,
  },
]

// Playbook positions — 4 categories × 4 positions each, with structured rules.
const PLAYBOOK: Array<{
  category: string
  positionType: 'preferred' | 'acceptable' | 'fallback' | 'walkaway'
  content: string
  notes?: string
  rules?: Record<string, unknown>
}> = [
  // ── Limitation of Liability ──────────────────────────────────────
  {
    category: 'Limitation of Liability',
    positionType: 'preferred',
    content: `<p>Mutual cap of <strong>twelve (12) months</strong> of fees. Excludes (i) breaches of confidentiality, (ii) IP indemnity, (iii) gross negligence and willful misconduct, (iv) death or bodily injury.</p>`,
    notes: 'Standard SaaS market position. Push back on anything below 12 months for deals over $100k ARR.',
    rules: {
      bounds: {
        cap_months: { min: 12, max: 24, units: 'months_of_fees', severity: 'high' },
      },
      must_have: [
        { id: 'lol-confidentiality-carveout', description: 'Confidentiality breach carve-out present',
          check: 'contains', value: 'confidentiality', severity: 'high' },
        { id: 'lol-indemnity-carveout', description: 'IP indemnity carve-out present',
          check: 'contains', value: 'indemnif', severity: 'high' },
        { id: 'lol-gross-neg-carveout', description: 'Gross negligence / willful misconduct carve-out',
          check: 'regex', value: '(gross negligence|willful misconduct)', severity: 'medium' },
      ],
    },
  },
  {
    category: 'Limitation of Liability',
    positionType: 'acceptable',
    content: `<p>Mutual cap of 24 months of fees. Same carve-outs.</p>`,
    notes: 'Acceptable for strategic accounts (>$500k ARR).',
    rules: { bounds: { cap_months: { min: 12, max: 24, units: 'months_of_fees', severity: 'high' } } },
  },
  {
    category: 'Limitation of Liability',
    positionType: 'fallback',
    content: `<p>Cap of 6 months of fees acceptable ONLY when: (a) single-year term, (b) value under $50k, (c) no Customer Confidential Information in scope.</p>`,
    notes: 'Walkaway position for material deals.',
    rules: { bounds: { cap_months: { min: 6, max: 12, units: 'months_of_fees', severity: 'high' } } },
  },
  {
    category: 'Limitation of Liability',
    positionType: 'walkaway',
    content: `<p>Liability cap below 6 months' fees, OR ABSOLUTE CAP below $100k, OR no carve-outs for confidentiality / IP indemnity / gross negligence — DO NOT SIGN.</p>`,
    notes: 'Hard walkaway. Escalate to GC if counterparty insists.',
    rules: {
      must_not: [
        { id: 'lol-no-carveouts', description: 'No carve-outs at all', check: 'absent', value: 'except', severity: 'walkaway' },
        { id: 'lol-absolute-cap', description: 'Absolute dollar cap', check: 'regex', value: '\\$\\d+,?\\d{3}', severity: 'walkaway' },
      ],
    },
  },

  // ── Payment Terms ────────────────────────────────────────────────
  {
    category: 'Payment Terms',
    positionType: 'preferred',
    content: `<p>Net 30, 1.5% per month late fee, billed in advance for SaaS subscription, billed monthly in arrears for services.</p>`,
    rules: {
      bounds: { payment_days: { min: 30, max: 30, units: 'days', severity: 'medium' } },
      must_have: [{ id: 'pt-late-fee', description: 'Late fee provision present', check: 'regex', value: '(late|interest)', severity: 'low' }],
    },
  },
  {
    category: 'Payment Terms',
    positionType: 'acceptable',
    content: `<p>Net 45 acceptable for Fortune 500 customers on request.</p>`,
    rules: { bounds: { payment_days: { min: 30, max: 45, units: 'days', severity: 'medium' } } },
  },
  {
    category: 'Payment Terms',
    positionType: 'fallback',
    content: `<p>Net 60 acceptable in exchange for prepayment of first quarter or 5% pricing premium.</p>`,
    rules: { bounds: { payment_days: { min: 30, max: 60, units: 'days', severity: 'medium' } } },
  },
  {
    category: 'Payment Terms',
    positionType: 'walkaway',
    content: `<p>Net 90 or longer, or "pay when paid" terms — DO NOT ACCEPT.</p>`,
    rules: { bounds: { payment_days: { min: 30, max: 75, units: 'days', severity: 'walkaway' } } },
  },

  // ── Confidentiality (Term & Termination category for org sizing) ─
  {
    category: 'Confidentiality',
    positionType: 'preferred',
    content: `<p>5-year tail (perpetual for trade secrets). Mutual obligations. Standard 5 carve-outs (publicly known, independently developed, lawfully received from third party, required by law, prior knowledge).</p>`,
    rules: {
      bounds: { confidentiality_years: { min: 3, max: 5, units: 'years', severity: 'low' } },
      must_have: [
        { id: 'conf-mutual', description: 'Mutual obligation, not one-sided',
          check: 'regex', value: '(each party|mutual|both parties)', severity: 'medium' },
      ],
    },
  },
  {
    category: 'Confidentiality',
    positionType: 'acceptable',
    content: `<p>3-year tail acceptable. Counterparty-disclosed-only obligation acceptable for short engagements.</p>`,
    rules: { bounds: { confidentiality_years: { min: 3, max: 5, units: 'years', severity: 'low' } } },
  },
  {
    category: 'Confidentiality',
    positionType: 'fallback',
    content: `<p>2-year tail acceptable for one-off transactions ($25k or less).</p>`,
    rules: { bounds: { confidentiality_years: { min: 2, max: 3, units: 'years', severity: 'medium' } } },
  },
  {
    category: 'Confidentiality',
    positionType: 'walkaway',
    content: `<p>No NDA, or unilateral NDA where we disclose but they don't, or perpetual obligation on us — REVISE.</p>`,
    rules: { bounds: { confidentiality_years: { min: 1, max: 7, units: 'years', severity: 'walkaway' } } },
  },

  // ── IP Ownership ─────────────────────────────────────────────────
  {
    category: 'IP Ownership',
    positionType: 'preferred',
    content: `<p>Customer owns all work product. Provider retains pre-existing tools/IP and grants a perpetual royalty-free license to use them embedded in the work product.</p>`,
    rules: {
      must_have: [
        { id: 'ip-customer-owns', description: 'Customer owns the deliverables',
          check: 'regex', value: '(customer (shall be|is) the (sole|exclusive) owner|exclusive property of customer)', severity: 'high' },
      ],
    },
  },
  {
    category: 'IP Ownership',
    positionType: 'acceptable',
    content: `<p>Customer gets perpetual, worldwide, non-exclusive license. Provider retains ownership but cannot use Customer-specific data.</p>`,
    rules: {},
  },
  {
    category: 'IP Ownership',
    positionType: 'fallback',
    content: `<p>Provider retains ownership; Customer gets license for term + 5 years post-term.</p>`,
    rules: {},
  },
  {
    category: 'IP Ownership',
    positionType: 'walkaway',
    content: `<p>Provider claims ownership AND restricts Customer's use to a short term, OR Customer pays full development cost without owning the result.</p>`,
    rules: {
      must_not: [{ id: 'ip-no-customer-rights', description: 'Customer has no rights post-term', check: 'regex', value: 'no further rights', severity: 'walkaway' }],
    },
  },
]

// 5 templates with realistic section structure.
const TEMPLATES: Array<{
  name: string
  description: string
  contractType: string
  variables: Array<{ key: string; label: string; type: string; required: boolean; defaultValue?: string }>
  sections: Array<{ title: string; content: string }>
}> = [
  {
    name: 'Mutual NDA — standard',
    description: 'Mutual non-disclosure for evaluation discussions or partnership exploration.',
    contractType: 'NDA',
    variables: [
      { key: 'counterparty_name',  label: 'Counterparty name',  type: 'string', required: true },
      { key: 'counterparty_state', label: 'Counterparty state', type: 'string', required: true, defaultValue: 'Delaware' },
      { key: 'effective_date',     label: 'Effective date',     type: 'date',   required: true },
      { key: 'survival_years',     label: 'Survival period (years)', type: 'number', required: true, defaultValue: '5' },
    ],
    sections: [
      { title: '1. Parties',     content: '<p>This Mutual Non-Disclosure Agreement ("Agreement") is entered into as of {{effective_date}} between Demo Org, Inc., a Delaware corporation ("Demo Org"), and {{counterparty_name}}, a {{counterparty_state}} entity ("Counterparty").</p>' },
      { title: '2. Definition',  content: '<p>"Confidential Information" means any non-public information disclosed by one party to the other, whether orally, in writing, or by inspection of tangible objects, that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information and the circumstances of disclosure.</p>' },
      { title: '3. Obligations', content: '<p>Each Receiving Party shall (a) hold all Confidential Information in strict confidence, (b) use it solely for the purpose of evaluating the potential business relationship, and (c) not disclose it to any third party except to its representatives who need to know and who are bound by similar confidentiality obligations.</p>' },
      { title: '4. Exclusions',  content: '<p>The obligations under this Agreement do not apply to information that: (i) was publicly known at the time of disclosure, (ii) becomes publicly known through no breach by the Receiving Party, (iii) was independently developed without reference to Confidential Information, (iv) was lawfully received from a third party without restriction, or (v) is required to be disclosed by law or court order.</p>' },
      { title: '5. Term',        content: '<p>This Agreement shall remain in effect for {{survival_years}} years from the Effective Date, except that obligations with respect to trade secrets shall survive for so long as such information remains a trade secret under applicable law.</p>' },
      { title: '6. Governing Law', content: '<p>This Agreement shall be governed by the laws of the State of Delaware, without regard to its conflict-of-laws principles.</p>' },
    ],
  },
  {
    name: 'Master Services Agreement — SaaS',
    description: 'Standard MSA for ongoing SaaS engagements. Use with separate Order Forms or SOWs.',
    contractType: 'MSA',
    variables: [
      { key: 'customer_name',     label: 'Customer name',     type: 'string', required: true },
      { key: 'customer_state',    label: 'Customer state',    type: 'string', required: true, defaultValue: 'Delaware' },
      { key: 'effective_date',    label: 'Effective date',    type: 'date',   required: true },
      { key: 'liability_months',  label: 'Liability cap (months of fees)', type: 'number', required: true, defaultValue: '12' },
      { key: 'governing_law',     label: 'Governing law',     type: 'string', required: true, defaultValue: 'Delaware' },
    ],
    sections: [
      { title: '1. Definitions',     content: '<p>Capitalized terms used in this Master Services Agreement (the "Agreement") have the meanings set forth in this Section or where first defined herein.</p>' },
      { title: '2. Services',        content: '<p>Provider shall provide the services described in each Order Form or Statement of Work ("SOW") executed under this Agreement.</p>' },
      { title: '3. Fees & Payment',  content: '<p>Customer shall pay all undisputed invoices within thirty (30) days of receipt. Late payments accrue interest at 1.5% per month or the maximum rate permitted by law, whichever is less.</p>' },
      { title: '4. Confidentiality', content: '<p>Each party shall hold the other party\'s Confidential Information in strict confidence, using the same degree of care it uses to protect its own confidential information of similar nature, but in no event less than reasonable care.</p>' },
      { title: '5. IP Ownership',    content: '<p>Customer retains ownership of all Customer Data and any work product specifically created for Customer under an SOW. Provider retains ownership of its pre-existing tools, methodologies, and platform.</p>' },
      { title: '6. Limitation of Liability', content: '<p>EXCEPT FOR BREACHES OF CONFIDENTIALITY, INDEMNIFICATION OBLIGATIONS, AND GROSS NEGLIGENCE OR WILLFUL MISCONDUCT, EACH PARTY\'S AGGREGATE LIABILITY UNDER THIS AGREEMENT SHALL NOT EXCEED THE FEES PAID OR PAYABLE BY CUSTOMER IN THE {{liability_months}} MONTHS PRECEDING THE EVENT GIVING RISE TO LIABILITY.</p>' },
      { title: '7. Term & Termination', content: '<p>This Agreement commences on the Effective Date and continues until terminated. Either party may terminate for material breach upon thirty (30) days written notice and failure to cure within such period.</p>' },
      { title: '8. Governing Law',   content: '<p>This Agreement shall be governed by the laws of the State of {{governing_law}}, without regard to conflict-of-laws principles.</p>' },
    ],
  },
  {
    name: 'Statement of Work — under MSA',
    description: 'Standard SOW for use under an existing MSA. Specifies scope, deliverables, and pricing.',
    contractType: 'SOW',
    variables: [
      { key: 'sow_number',     label: 'SOW number',     type: 'string', required: true },
      { key: 'customer_name',  label: 'Customer name',  type: 'string', required: true },
      { key: 'effective_date', label: 'Effective date', type: 'date',   required: true },
      { key: 'fee_amount',     label: 'Total fee (USD)', type: 'number', required: true },
    ],
    sections: [
      { title: '1. Scope',         content: '<p>This Statement of Work {{sow_number}} ("SOW") is entered into under and incorporates by reference the Master Services Agreement between Demo Org, Inc. and {{customer_name}} dated [MSA date].</p>' },
      { title: '2. Deliverables',  content: '<p>Provider shall deliver: [LIST DELIVERABLES]</p>' },
      { title: '3. Timeline',      content: '<p>Estimated start: {{effective_date}}. Estimated completion: [completion date].</p>' },
      { title: '4. Fees',          content: '<p>Total fixed fee: USD {{fee_amount}}, payable as follows: [payment schedule].</p>' },
      { title: '5. Acceptance',    content: '<p>Deliverables shall be deemed accepted unless Customer provides written notice of rejection within fifteen (15) business days of delivery.</p>' },
    ],
  },
  {
    name: 'Data Processing Addendum — GDPR',
    description: 'GDPR-compliant DPA for use with EU/UK customers.',
    contractType: 'DPA',
    variables: [
      { key: 'customer_name',     label: 'Customer name',     type: 'string', required: true },
      { key: 'effective_date',    label: 'Effective date',    type: 'date',   required: true },
    ],
    sections: [
      { title: '1. Subject Matter', content: '<p>This Data Processing Addendum ("DPA") supplements the Agreement between Demo Org, Inc. ("Processor") and {{customer_name}} ("Controller") and applies whenever Processor processes Personal Data on behalf of Controller.</p>' },
      { title: '2. Processing Instructions', content: '<p>Processor shall process Personal Data only on documented written instructions from Controller, including with regard to transfers to third countries.</p>' },
      { title: '3. Security Measures', content: '<p>Processor shall implement appropriate technical and organizational measures consistent with Article 32 GDPR.</p>' },
      { title: '4. Sub-processors', content: '<p>Controller authorizes Processor to engage sub-processors listed in Schedule B. Processor shall provide thirty (30) days notice before adding new sub-processors.</p>' },
      { title: '5. Data Subject Requests', content: '<p>Processor shall assist Controller, taking into account the nature of processing, by appropriate technical and organizational measures, in fulfilling Controller\'s obligation to respond to data subject requests under Articles 12–22 GDPR.</p>' },
      { title: '6. Breach Notification', content: '<p>Processor shall notify Controller without undue delay and in any case within seventy-two (72) hours after becoming aware of any Personal Data Breach.</p>' },
      { title: '7. Audit Rights', content: '<p>Controller may audit Processor\'s compliance with this DPA not more than once per year on thirty (30) days written notice, except in the event of a Personal Data Breach.</p>' },
    ],
  },
  {
    name: 'Order Form — SaaS subscription',
    description: 'Order form for new or renewing SaaS subscription. References parent MSA.',
    contractType: 'ORDER_FORM',
    variables: [
      { key: 'customer_name',  label: 'Customer name',  type: 'string', required: true },
      { key: 'effective_date', label: 'Effective date', type: 'date',   required: true },
      { key: 'plan_name',      label: 'Plan name',      type: 'string', required: true },
      { key: 'seat_count',     label: 'Seats',          type: 'number', required: true },
      { key: 'annual_fee',     label: 'Annual fee (USD)', type: 'number', required: true },
      { key: 'term_months',    label: 'Term (months)',  type: 'number', required: true, defaultValue: '12' },
    ],
    sections: [
      { title: '1. Order Details', content: '<p>This Order Form is entered into between Demo Org, Inc. and {{customer_name}} effective {{effective_date}} under the parties\' Master Services Agreement.</p>' },
      { title: '2. Plan & Pricing', content: '<p>Plan: {{plan_name}}. Seats: {{seat_count}}. Annual fee: USD {{annual_fee}}. Initial term: {{term_months}} months.</p>' },
      { title: '3. Auto-Renewal', content: '<p>This Order shall automatically renew for successive {{term_months}}-month terms unless either party provides sixty (60) days written notice of non-renewal. Renewal pricing is subject to a maximum increase of CPI + 3% annually.</p>' },
      { title: '4. Payment', content: '<p>Customer shall pay the annual fee in advance, invoiced on the Effective Date. Net 30 payment terms apply per the MSA.</p>' },
    ],
  },
]

async function main() {
  const admin = await prisma.user.findFirst({ where: { email: 'admin@demo.com' }, select: { id: true, orgId: true } })
  if (!admin) throw new Error('admin@demo.com not found')
  const { orgId, id: adminId } = admin
  console.log(`[seed] target org=${orgId}, admin=${adminId}`)

  // ── 1. Team users ───────────────────────────────────────────────
  console.log('\n[seed] creating team users…')
  const passwordHash = await bcrypt.hash('password123', 10)
  for (const u of TEAM_USERS) {
    const role = await prisma.role.findFirst({ where: { orgId, name: u.role } })
    if (!role) {
      console.warn(`  ! role ${u.role} not found — skipping ${u.email}`)
      continue
    }
    const user = await prisma.user.upsert({
      where:  { orgId_email: { orgId, email: u.email } },
      create: {
        orgId, email: u.email, name: u.name, passwordHash,
        status: 'ACTIVE', preferences: { title: u.title } as object,
      },
      update: { name: u.name, status: 'ACTIVE' },
    })
    await prisma.userRole.upsert({
      where:  { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id, grantedBy: adminId },
      update: {},
    })
    console.log(`  ✓ ${u.email.padEnd(28)} role=${u.role.padEnd(20)} title=${u.title}`)
  }

  // ── 2. Counterparties ───────────────────────────────────────────
  console.log('\n[seed] creating counterparties…')
  for (const cp of COUNTERPARTIES) {
    const existing = await prisma.counterparty.findFirst({ where: { orgId, name: cp.name } })
    if (existing) {
      console.log(`  · ${cp.name.padEnd(35)} (exists)`)
      continue
    }
    await prisma.counterparty.create({
      data: {
        orgId, name: cp.name,
        legalName: cp.legalName, email: cp.email, website: cp.website,
        address: cp.address,
        contacts: (cp.contacts ?? []) as object,
      },
    })
    console.log(`  ✓ ${cp.name.padEnd(35)} ${cp.contacts?.length ?? 0} contact(s)`)
  }

  // ── 3. Matters ───────────────────────────────────────────────────
  console.log('\n[seed] creating matters…')
  const cpByName = Object.fromEntries(
    (await prisma.counterparty.findMany({ where: { orgId }, select: { id: true, name: true } }))
      .map(c => [c.name, c.id]),
  )
  const userByEmail = Object.fromEntries(
    (await prisma.user.findMany({ where: { orgId }, select: { id: true, email: true } }))
      .map(u => [u.email, u.id]),
  )
  for (const m of MATTERS) {
    const existing = await prisma.matter.findFirst({ where: { orgId, name: m.name, deletedAt: null } })
    if (existing) {
      console.log(`  · ${m.name.padEnd(50)} (exists)`)
      continue
    }
    const ownerId = userByEmail[m.ownerEmail] ?? adminId
    await prisma.matter.create({
      data: {
        orgId, name: m.name, description: m.description,
        counterpartyId: cpByName[m.counterpartyName],
        counterpartyName: m.counterpartyName,
        ownerId, createdById: adminId,
        tags: m.tags,
      },
    })
    console.log(`  ✓ ${m.name.padEnd(50)} → ${m.counterpartyName}`)
  }

  // ── 4. Clause categories + clause library ───────────────────────
  console.log('\n[seed] creating clause categories…')
  const categoryByName: Record<string, string> = {}
  for (const c of CLAUSE_CATEGORIES) {
    const existing = await prisma.clauseCategory.findFirst({ where: { orgId, name: c.name } })
    if (existing) {
      categoryByName[c.name] = existing.id
      console.log(`  · ${c.name.padEnd(28)} (exists)`)
      continue
    }
    const cat = await prisma.clauseCategory.create({
      data: { orgId, name: c.name, description: c.description },
    })
    categoryByName[c.name] = cat.id
    console.log(`  ✓ ${c.name.padEnd(28)}`)
  }

  console.log('\n[seed] creating clause library items…')
  for (const item of CLAUSE_ITEMS) {
    const catId = categoryByName[item.category]
    if (!catId) { console.warn(`  ! missing category ${item.category}`); continue }
    const existing = await prisma.clauseLibraryItem.findFirst({ where: { orgId, title: item.title, deletedAt: null } })
    if (existing) {
      console.log(`  · ${item.title.padEnd(55)} (exists)`)
      continue
    }
    await prisma.clauseLibraryItem.create({
      data: {
        orgId, categoryId: catId,
        title: item.title, content: item.content,
        tags: item.tags, riskRating: item.riskRating,
        isApproved: item.riskRating !== 'unfavorable',
        createdById: adminId,
      },
    })
    console.log(`  ✓ ${item.title.padEnd(55)} [${item.riskRating}]`)
  }

  // ── 5. Playbook positions ───────────────────────────────────────
  console.log('\n[seed] creating playbook positions…')
  for (const p of PLAYBOOK) {
    const catId = categoryByName[p.category]
    if (!catId) { console.warn(`  ! missing category ${p.category}`); continue }
    const existing = await prisma.playbookPosition.findFirst({
      where: { orgId, clauseCategoryId: catId, positionType: p.positionType },
    })
    if (existing) {
      console.log(`  · ${(p.category + ' / ' + p.positionType).padEnd(45)} (exists)`)
      continue
    }
    await prisma.playbookPosition.create({
      data: {
        orgId, clauseCategoryId: catId, positionType: p.positionType,
        content: p.content, notes: p.notes,
        rules: (p.rules ?? null) as object,
        createdById: adminId,
      },
    })
    console.log(`  ✓ ${(p.category + ' / ' + p.positionType).padEnd(45)}`)
  }

  // ── 6. Templates ────────────────────────────────────────────────
  console.log('\n[seed] creating templates…')
  for (const t of TEMPLATES) {
    const existing = await prisma.template.findFirst({ where: { orgId, name: t.name, deletedAt: null } })
    if (existing) {
      console.log(`  · ${t.name.padEnd(45)} (exists)`)
      continue
    }
    await prisma.template.create({
      data: {
        orgId, name: t.name, description: t.description,
        contractType: t.contractType,
        variables: t.variables as object,
        isPublished: true,
        createdById: adminId,
        sections: {
          create: t.sections.map((s, i) => ({
            title: s.title, sortOrder: i, content: s.content,
          })),
        },
      },
    })
    console.log(`  ✓ ${t.name.padEnd(45)} ${t.sections.length} sections`)
  }

  // ── Final report ─────────────────────────────────────────────────
  console.log('\n[seed] catalog report:')
  const report = {
    users:         await prisma.user.count({ where: { orgId } }),
    counterparties: await prisma.counterparty.count({ where: { orgId } }),
    matters:       await prisma.matter.count({ where: { orgId, deletedAt: null } }),
    templates:     await prisma.template.count({ where: { orgId, deletedAt: null } }),
    clauseLib:     await prisma.clauseLibraryItem.count({ where: { orgId, deletedAt: null } }),
    playbook:      await prisma.playbookPosition.count({ where: { orgId } }),
    clauseCats:    await prisma.clauseCategory.count({ where: { orgId } }),
  }
  console.log(JSON.stringify(report, null, 2))

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
