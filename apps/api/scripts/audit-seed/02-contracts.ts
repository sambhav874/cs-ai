/**
 * Audit corpus — R.2.3: 15 real-text contracts spanning 10 domains.
 *
 * Each contract has:
 *   • Realistic legal prose (3000–7000 chars, ~3–10 pages rendered)
 *   • Owner from the appropriate persona (legal/sales/finance/procurement/hr)
 *   • Counterparty from the seeded list
 *   • Matter assignment where applicable
 *   • Status reflecting the audit-test scenario
 *   • value, currency, expiryDate, effectiveDate populated
 *   • Pre-filled summary, riskFactors, keyTerms so the rail renders
 *     without waiting for the analyze worker on first paint
 *   • analysisStatus: DONE so dashboard counts include it
 *
 * Idempotent: skips contracts whose title already exists.
 *
 * Run AFTER 01-catalog.ts:
 *   pnpm tsx --env-file=.env scripts/audit-seed/02-contracts.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface SeedContract {
  title:           string
  type:            string
  status:          string
  ownerEmail:      string          // who owns it
  counterpartyName: string         // FK by name
  matterName?:     string          // FK by name
  parentTitle?:    string          // for amendments
  effectiveDate?:  string          // ISO
  expiryDate?:     string          // ISO
  value?:          number
  currency?:       string
  jurisdiction?:   string
  tags?:           string[]
  summary?:        string          // pre-filled so rail shows AI summary
  riskFactors?:    string[]        // pre-filled
  keyTerms?:       Record<string, unknown>  // pre-filled
  riskScore?:      number          // 0..1
  bodyHtml:        string          // the contract text
}

// Helper — wraps body in a top-level title + simple H2 sections.
function htmlOf(title: string, sections: Array<{ heading: string; content: string }>): string {
  return [
    `<h1>${title}</h1>`,
    ...sections.map(s => `<h2>${s.heading}</h2>${s.content}`),
  ].join('\n')
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<\/(p|div|h\d|li)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ─────────────────────────────────────────────────────────────────────
//                          THE 15 CONTRACTS
// ─────────────────────────────────────────────────────────────────────

const CONTRACTS: SeedContract[] = []

// ── #1 — Mutual NDA — Acme × Demo (EXECUTED) ────────────────────────
CONTRACTS.push({
  title: 'Mutual NDA — Acme Corporation × Demo Org',
  type: 'NDA',
  status: 'EXECUTED',
  ownerEmail: 'legal@demo.com',
  counterpartyName: 'Acme Corporation',
  matterName: undefined,
  effectiveDate: '2026-01-15',
  expiryDate:    '2027-01-14',
  jurisdiction: 'Delaware',
  tags: ['nda', 'partnership-evaluation'],
  summary: 'Mutual non-disclosure agreement for evaluating a potential go-to-market partnership. Standard 5-year tail with the usual five carve-outs.',
  keyTerms: {
    counterparty: 'Acme Corporation',
    governingLaw: 'Delaware',
    survivalYears: 5,
    mutual: true,
  },
  riskScore: 0.12,
  riskFactors: [],
  bodyHtml: htmlOf('MUTUAL NON-DISCLOSURE AGREEMENT', [
    { heading: '1. Parties', content: `<p>This Mutual Non-Disclosure Agreement (this "Agreement") is entered into and effective as of January 15, 2026 (the "Effective Date") by and between Demo Org, Inc., a Delaware corporation with its principal place of business at 224 Valencia Street, San Francisco, California 94103 ("Demo Org"), and Acme Corporation, a Delaware corporation with its principal place of business at 500 Market Street, Suite 1200, San Francisco, California 94105 ("Acme"). Demo Org and Acme are each referred to as a "Party" and collectively as the "Parties."</p>` },
    { heading: '2. Purpose', content: `<p>The Parties wish to explore a potential business relationship involving the joint development and go-to-market collaboration of contract lifecycle management offerings, and in connection with such exploration, may exchange certain non-public, proprietary, and confidential information (the "Purpose"). This Agreement governs the protection and use of such Confidential Information disclosed by either Party to the other in connection with the Purpose.</p>` },
    { heading: '3. Definition of Confidential Information', content: `<p>"Confidential Information" means any non-public, proprietary, or confidential information disclosed by one Party (the "Disclosing Party") to the other Party (the "Receiving Party") in connection with the Purpose, whether disclosed orally, in writing, electronically, or by inspection of tangible objects, that is designated as confidential at the time of disclosure or that reasonably should be understood to be confidential given the nature of the information and the circumstances of disclosure. Confidential Information includes, without limitation, business strategies, product roadmaps, pricing and customer information, financial and forecasting information, technical specifications, source code, designs, methodologies, marketing plans, employee and contractor information, and the terms and existence of this Agreement and any discussions hereunder.</p>` },
    { heading: '4. Obligations of the Receiving Party', content: `<p>The Receiving Party shall: (a) hold the Disclosing Party's Confidential Information in strict confidence and use the same degree of care to prevent unauthorized disclosure as the Receiving Party uses to protect its own confidential information of similar nature, but in no event less than a reasonable degree of care; (b) use the Confidential Information solely for the Purpose and for no other purpose; (c) limit access to the Confidential Information to those of its employees, contractors, advisors, and affiliates (collectively, "Representatives") who have a legitimate need to know such information for the Purpose and who are bound by written or professional obligations of confidentiality at least as protective as those set forth herein; and (d) be responsible for any breach of this Agreement by its Representatives.</p>` },
    { heading: '5. Exclusions', content: `<p>The obligations under this Agreement do not apply to information that the Receiving Party can demonstrate by competent evidence: (i) was publicly known or generally available without restriction at the time of disclosure; (ii) becomes publicly known or generally available without restriction through no act or omission of the Receiving Party or its Representatives; (iii) was lawfully in the Receiving Party's possession without obligation of confidentiality at the time of disclosure; (iv) was independently developed by the Receiving Party without reference to or use of the Confidential Information; or (v) was lawfully received from a third party without obligation of confidentiality.</p>` },
    { heading: '6. Compelled Disclosure', content: `<p>If the Receiving Party is required by law, regulation, court order, or governmental authority to disclose any Confidential Information, the Receiving Party shall provide the Disclosing Party with prompt written notice (where legally permissible) so that the Disclosing Party may seek a protective order or other appropriate remedy, and shall cooperate with the Disclosing Party's reasonable efforts to obtain such protection. The Receiving Party shall disclose only that portion of the Confidential Information that, on advice of counsel, is legally required to be disclosed.</p>` },
    { heading: '7. Return or Destruction', content: `<p>Upon the Disclosing Party's written request or upon termination of this Agreement, the Receiving Party shall, at the Disclosing Party's election, promptly return to the Disclosing Party or destroy all Confidential Information in the Receiving Party's possession or control, and shall certify such return or destruction in writing. Notwithstanding the foregoing, the Receiving Party may retain Confidential Information solely to the extent required by law, professional standards, or its routine archival or backup procedures, provided such retained information remains subject to this Agreement for so long as it is retained.</p>` },
    { heading: '8. Term and Survival', content: `<p>This Agreement shall commence on the Effective Date and continue for a period of one (1) year, unless earlier terminated by either Party upon thirty (30) days' prior written notice. The confidentiality obligations set forth in Sections 4 through 7 shall survive termination or expiration of this Agreement for a period of five (5) years, except that obligations with respect to information constituting a trade secret shall survive for so long as such information remains a trade secret under applicable law.</p>` },
    { heading: '9. No License or Obligation', content: `<p>Nothing in this Agreement is intended to grant any rights to either Party under any patent, copyright, trademark, trade secret, or other intellectual property right, nor shall this Agreement grant any Party any rights in or to the Confidential Information of the other Party except as expressly set forth herein. Nothing in this Agreement shall obligate either Party to disclose any particular information, to enter into any further agreement, or to undertake any business relationship.</p>` },
    { heading: '10. Governing Law', content: `<p>This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware, without regard to its conflict-of-laws principles. Any dispute arising out of or relating to this Agreement shall be brought exclusively in the state or federal courts located in New Castle County, Delaware, and each Party hereby consents to the personal jurisdiction of such courts.</p>` },
    { heading: '11. Miscellaneous', content: `<p>This Agreement contains the entire understanding of the Parties with respect to the subject matter hereof and supersedes all prior negotiations, representations, or agreements, whether oral or written. Any modification to this Agreement must be in writing and signed by both Parties. The failure of either Party to enforce any provision of this Agreement shall not constitute a waiver of such provision or the right to enforce it later. If any provision is held unenforceable, the remaining provisions shall remain in full force and effect. This Agreement may be executed in counterparts, including by electronic signature, each of which shall be deemed an original.</p>` },
    { heading: '12. Signatures', content: `<p>IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.</p><p>DEMO ORG, INC.<br/>By: ___________________________<br/>Name: Maya Goldberg<br/>Title: General Counsel</p><p>ACME CORPORATION<br/>By: ___________________________<br/>Name: Robert Chen<br/>Title: General Counsel</p>` },
  ]),
})

// ── #10 — Employment Offer (DRAFT) ──────────────────────────────────
CONTRACTS.push({
  title: 'Employment Offer — Senior Software Engineer (Priya Raghavan)',
  type: 'EMPLOYMENT',
  status: 'DRAFT',
  ownerEmail: 'hr@demo.com',
  counterpartyName: 'Priya Raghavan',
  effectiveDate: '2026-05-15',
  jurisdiction: 'California',
  tags: ['employment', 'engineering', 'senior'],
  summary: 'Standard at-will employment offer for a Senior Software Engineer role. Includes equity, benefits, IP assignment, and standard at-will provisions per California law.',
  keyTerms: { role: 'Senior Software Engineer', baseSalary: 180000, equityShares: 10000, vestingYears: 4, signOnBonus: 25000 },
  riskScore: 0.10,
  riskFactors: [],
  bodyHtml: htmlOf('OFFER OF EMPLOYMENT', [
    { heading: '1. Position', content: `<p>Demo Org, Inc. (the "Company") is pleased to offer you, Priya Raghavan, the position of Senior Software Engineer, reporting to the VP of Engineering. Your start date will be May 15, 2026, contingent on satisfactory completion of background and reference checks. Your principal place of work will be the Company's San Francisco, California office, with hybrid remote work permitted in accordance with Company policy.</p>` },
    { heading: '2. Compensation', content: `<p>Your annual base salary will be one hundred eighty thousand dollars (USD $180,000), payable in accordance with the Company's standard payroll schedule and subject to applicable tax withholdings. You will be eligible for a one-time sign-on bonus of twenty-five thousand dollars (USD $25,000), payable on your first regular pay date and subject to a one-year clawback if you voluntarily resign or are terminated for Cause within twelve (12) months of your start date. You will be eligible to participate in the Company's annual performance bonus program, with a target bonus of fifteen percent (15%) of base salary based on individual and company performance.</p>` },
    { heading: '3. Equity', content: `<p>Subject to approval by the Company's Board of Directors, you will be granted an option to purchase ten thousand (10,000) shares of the Company's common stock (the "Option") at a per-share exercise price equal to the fair market value of the common stock on the date of grant. The Option will be subject to a four-year vesting schedule with a one-year cliff: 25% of the Option will vest on the first anniversary of your start date, with the remaining 75% vesting in equal monthly installments thereafter. The Option will be governed by the Company's Equity Incentive Plan and a separate Stock Option Agreement.</p>` },
    { heading: '4. Benefits', content: `<p>You will be eligible to participate in the Company's benefit programs, including medical, dental, and vision insurance (Company pays 100% of employee premiums), a 401(k) plan with up to 4% Company match, twenty (20) days of paid vacation per year, ten (10) paid sick days, eleven (11) paid holidays, and twelve (12) weeks of paid parental leave. Benefits are subject to the terms of the applicable plan documents and Company policies, which may be modified from time to time.</p>` },
    { heading: '5. At-Will Employment', content: `<p>Your employment with the Company is at-will, meaning that either you or the Company may terminate the employment relationship at any time, with or without cause, and with or without notice. Nothing in this offer letter or any other Company communication constitutes a contract for employment for any specific period of time or a guarantee of continued employment. The at-will nature of your employment may only be modified by a written agreement signed by you and the Chief Executive Officer of the Company.</p>` },
    { heading: '6. Confidentiality and IP Assignment', content: `<p>As a condition of your employment, you will be required to sign the Company's standard Employee Proprietary Information and Inventions Assignment Agreement (the "PIIA"), under which you will agree to assign to the Company all inventions and work product created during your employment that relate to the Company's business or are created using Company resources. You will also agree to maintain the confidentiality of the Company's confidential information and to comply with the Company's policies regarding data security and acceptable use.</p>` },
    { heading: '7. Background Check', content: `<p>This offer is contingent upon (a) satisfactory completion of a background check, including verification of employment history, education, and the absence of a disqualifying criminal record, (b) verification of your right to work in the United States as required by federal law, and (c) the satisfactory outcome of any required reference checks. The Company will conduct background checks in compliance with applicable law, including the federal Fair Credit Reporting Act and California's investigative consumer reporting statutes.</p>` },
    { heading: '8. Entire Agreement', content: `<p>This offer letter, together with the PIIA and the Stock Option Agreement, constitutes the entire agreement between you and the Company regarding the terms and conditions of your employment, and supersedes any prior representations or agreements, whether oral or written. This offer letter may be modified only by a written agreement signed by you and an authorized officer of the Company.</p>` },
    { heading: '9. Acceptance', content: `<p>To accept this offer, please sign and return this letter to the People Operations team by April 30, 2026. We are excited about the opportunity to work with you and look forward to your decision.</p><p>Sincerely,<br/>Emily Watanabe<br/>Director of People<br/>Demo Org, Inc.</p><p>ACCEPTED AND AGREED:<br/>______________________________<br/>Priya Raghavan<br/>Date: __________________</p>` },
  ]),
})

// ── #14 — Consulting agreement (EXECUTED) ───────────────────────────
CONTRACTS.push({
  title: 'Consulting Agreement — Brand Strategy (Hartwell Partners)',
  type: 'CONSULTING',
  status: 'EXECUTED',
  ownerEmail: 'legal@demo.com',
  counterpartyName: 'Hartwell Partners',
  effectiveDate: '2026-03-01',
  expiryDate: '2026-09-30',
  value: 45000,
  currency: 'USD',
  jurisdiction: 'New York',
  tags: ['consulting', 'marketing', 'short-term'],
  summary: 'Six-month brand-strategy consulting engagement with Hartwell Partners. Fixed fee of $45K paid in 3 installments. Standard mutual confidentiality and customer-owned work product.',
  keyTerms: { totalFee: 45000, paymentSchedule: '3 installments', durationMonths: 6, ipOwnership: 'customer-owned' },
  riskScore: 0.18,
  riskFactors: ['No carve-out for pre-existing IP — to clarify in next engagement'],
  bodyHtml: htmlOf('CONSULTING SERVICES AGREEMENT', [
    { heading: '1. Parties and Engagement', content: `<p>This Consulting Services Agreement (this "Agreement") is entered into as of March 1, 2026 by and between Demo Org, Inc. ("Client") and Hartwell Strategic Partners, LLC, a New York limited liability company ("Consultant"). Client engages Consultant to provide the brand-strategy advisory services described in Schedule A (the "Services"), and Consultant agrees to provide such Services in accordance with the terms of this Agreement.</p>` },
    { heading: '2. Term', content: `<p>This Agreement shall commence on the Effective Date and continue until September 30, 2026 (the "Term"), unless earlier terminated in accordance with Section 8.</p>` },
    { heading: '3. Compensation', content: `<p>In consideration of the Services, Client shall pay Consultant a fixed fee of forty-five thousand dollars (USD $45,000), payable in three equal installments of fifteen thousand dollars (USD $15,000) each, invoiced upon (i) execution of this Agreement, (ii) completion of the mid-engagement review (estimated June 1, 2026), and (iii) delivery of the final brand-strategy deliverables. Each invoice shall be due within thirty (30) days of receipt. Consultant shall be responsible for all of its own expenses, except that Client shall reimburse pre-approved travel costs in accordance with Client's standard expense policy.</p>` },
    { heading: '4. Independent Contractor Relationship', content: `<p>Consultant is an independent contractor and not an employee, agent, partner, or joint venturer of Client. Nothing in this Agreement shall be construed to create an employer-employee relationship or any other agency or partnership relationship between the Parties. Consultant shall be solely responsible for all taxes, insurance, and benefits related to its personnel.</p>` },
    { heading: '5. Confidentiality', content: `<p>Consultant shall hold all non-public information of Client in strict confidence and use it solely to perform the Services. The confidentiality obligations shall survive for three (3) years following termination or expiration of this Agreement.</p>` },
    { heading: '6. Intellectual Property', content: `<p>All deliverables, work product, and materials created by Consultant specifically for Client under this Agreement (the "Work Product") shall be the sole and exclusive property of Client. Consultant hereby assigns to Client all right, title, and interest, including all intellectual property rights, in and to the Work Product. Consultant retains the right to use general methodologies, frameworks, and skills developed in the course of its consulting practice for other clients.</p>` },
    { heading: '7. Warranties', content: `<p>Consultant represents and warrants that (a) it has the right and authority to enter into this Agreement and to perform the Services, (b) the Services will be performed in a professional and workmanlike manner consistent with industry standards, and (c) the Work Product will not infringe the intellectual property rights of any third party.</p>` },
    { heading: '8. Termination', content: `<p>Either Party may terminate this Agreement for convenience upon thirty (30) days' prior written notice. Upon termination, Client shall pay Consultant for all Services performed through the effective date of termination on a pro-rata basis. Either Party may terminate immediately for material breach if such breach is not cured within fifteen (15) days following written notice.</p>` },
    { heading: '9. Limitation of Liability', content: `<p>Consultant's aggregate liability under this Agreement shall not exceed the total fees paid by Client to Consultant. Neither Party shall be liable for any indirect, incidental, special, or consequential damages.</p>` },
    { heading: '10. Governing Law', content: `<p>This Agreement shall be governed by the laws of the State of New York. Any dispute shall be resolved by binding arbitration administered by the American Arbitration Association under its Commercial Arbitration Rules.</p>` },
    { heading: 'Schedule A — Services', content: `<p>Consultant shall deliver: (i) brand audit report (April 30, 2026), (ii) competitive landscape analysis (May 31, 2026), (iii) revised brand positioning framework (July 31, 2026), and (iv) implementation playbook (September 15, 2026). Consultant will participate in bi-weekly status meetings with Client's Chief Marketing Officer.</p>` },
  ]),
})

// ── #4 — SOW#2 (Year-2 expansion) — Zynga (DRAFT) ───────────────────
CONTRACTS.push({
  title: 'SOW #2 — Year-2 Platform Expansion (Zynga)',
  type: 'SOW',
  status: 'DRAFT',
  ownerEmail: 'sales@demo.com',
  counterpartyName: 'Zynga Holdings',
  matterName: 'Zynga MSA — multi-year SaaS engagement',
  effectiveDate: '2026-05-01',
  expiryDate: '2027-04-30',
  value: 400000,
  currency: 'USD',
  jurisdiction: 'Delaware',
  tags: ['sow', 'expansion', 'zynga'],
  summary: 'Year-2 expansion SOW under the Zynga MSA. Adds analytics module + 100 additional seats. $400K fixed fee.',
  keyTerms: { totalFee: 400000, additionalSeats: 100, modules: ['analytics'], term: '12 months' },
  riskScore: 0.20,
  riskFactors: ['Pricing locked for 12 months but no renewal cap'],
  bodyHtml: htmlOf('STATEMENT OF WORK #2', [
    { heading: '1. Parties and Reference', content: `<p>This Statement of Work #2 ("SOW") is entered into as of May 1, 2026 by and between Demo Org, Inc. ("Provider") and Zynga Holdings, LLC ("Customer"), and is governed by the Master Services Agreement between the parties dated February 12, 2026 (the "MSA"). Capitalized terms used but not defined herein have the meanings set forth in the MSA.</p>` },
    { heading: '2. Scope', content: `<p>Provider shall: (a) deliver and configure the Analytics Module, including dashboard customization, role-based access controls, and integration with Customer's existing identity provider; (b) provision an additional one hundred (100) seat licenses to be added to Customer's existing 250-seat baseline; (c) provide eight (8) hours of dedicated training delivered remotely; and (d) provide ongoing support during the SOW term consistent with the support tier in the MSA.</p>` },
    { heading: '3. Deliverables and Timeline', content: `<p>(a) Analytics Module configured and live by June 15, 2026. (b) Seat provisioning completed within five (5) business days of execution. (c) Training sessions scheduled and completed by July 31, 2026. (d) Quarterly business reviews on a calendar basis.</p>` },
    { heading: '4. Fees', content: `<p>Total fixed fee: USD $400,000, payable as follows: (i) USD $200,000 invoiced upon execution of this SOW, due within thirty (30) days; and (ii) USD $200,000 invoiced upon completion of the Analytics Module deployment, due within thirty (30) days. All fees are exclusive of applicable taxes, which shall be borne by Customer.</p>` },
    { heading: '5. Term', content: `<p>This SOW shall commence on the Effective Date and continue for a period of twelve (12) months. Renewal is subject to a separate written agreement.</p>` },
    { heading: '6. Acceptance', content: `<p>Deliverables shall be deemed accepted unless Customer provides written notice of rejection, with reasonable detail, within fifteen (15) business days of delivery. Provider shall correct any deficiencies and re-submit within ten (10) business days.</p>` },
    { heading: '7. Signatures', content: `<p>This SOW is governed by the MSA. Each Party represents that the signatory below is authorized to bind such Party.</p><p>DEMO ORG, INC.<br/>By: ___________________________<br/>Name: Daniel Park<br/>Title: Senior Account Executive</p><p>ZYNGA HOLDINGS, LLC<br/>By: ___________________________<br/>Name: Sarah Nakamura<br/>Title: VP Engineering</p>` },
  ]),
})

// ── #9 — Order Form — Salesforce subscription renewal (PENDING_APPROVAL) ──
CONTRACTS.push({
  title: 'Order Form — Salesforce Subscription Renewal (FY27)',
  type: 'ORDER_FORM',
  status: 'PENDING_APPROVAL',
  ownerEmail: 'finance@demo.com',
  counterpartyName: 'Salesforce.com',
  effectiveDate: '2026-06-01',
  expiryDate:    '2027-05-31',
  value: 360000,
  currency: 'USD',
  jurisdiction: 'California',
  tags: ['saas', 'renewal', 'salesforce'],
  summary: 'FY27 Salesforce Sales Cloud subscription renewal. 12-month term, $360K. Auto-renew with 60-day non-renewal notice; CPI+3% annual cap on renewal pricing.',
  keyTerms: { plan: 'Sales Cloud Enterprise', seats: 200, annualFee: 360000, autoRenew: true, renewalCap: 'CPI+3%' },
  riskScore: 0.30,
  riskFactors: ['Auto-renewal active', 'No early-termination right during 12-month term'],
  bodyHtml: htmlOf('ORDER FORM — SALESFORCE SUBSCRIPTION RENEWAL', [
    { heading: '1. Order Details', content: `<p>This Order Form is entered into between Salesforce.com, Inc. ("Salesforce") and Demo Org, Inc. ("Customer") effective June 1, 2026 under the parties' Master Subscription Agreement dated June 1, 2024 (the "MSA"). Capitalized terms used but not defined herein have the meanings set forth in the MSA.</p>` },
    { heading: '2. Subscribed Services', content: `<p>Plan: Sales Cloud Enterprise Edition. Subscribed Seats: 200. Effective Date: June 1, 2026. Subscription Term: 12 months ("Initial Term"). Annual Subscription Fee: USD $360,000 (USD $1,800 per seat per year), invoiced annually in advance. Net 30 payment terms.</p>` },
    { heading: '3. Auto-Renewal', content: `<p>This Order shall automatically renew for successive 12-month terms (each a "Renewal Term") unless Customer provides written notice of non-renewal at least sixty (60) days prior to the end of the then-current term. The annual fee for any Renewal Term shall be subject to a maximum increase equal to the lesser of (i) the change in CPI-U for the most recent twelve-month period, or (ii) three percent (3%).</p>` },
    { heading: '4. Termination', content: `<p>Customer may not terminate this Order for convenience during the Initial Term. Either Party may terminate for material breach upon thirty (30) days' prior written notice if such breach is not cured during the notice period.</p>` },
    { heading: '5. Use Restrictions', content: `<p>Customer shall not exceed the Subscribed Seats. If actual usage exceeds the Subscribed Seats, Salesforce will invoice Customer for the additional seats at the per-seat fee on a prorated basis through the end of the Term.</p>` },
    { heading: '6. SLA', content: `<p>Salesforce shall maintain 99.9% monthly uptime for the Subscribed Services as measured in accordance with the SLA in the MSA. Service credits for downtime below the SLA target shall be Customer's sole and exclusive remedy.</p>` },
    { heading: '7. Authorized Signatures', content: `<p>SALESFORCE.COM, INC.<br/>By: ___________________________<br/>Name: Andrew Mitchell<br/>Title: Customer Success Director</p><p>DEMO ORG, INC.<br/>By: ___________________________<br/>Name: Marcus Reyes<br/>Title: CFO</p>` },
  ]),
})

// ── #6 — Vendor agreement — AWS reseller (Cloudwave) — EXECUTED, expiring soon ──
CONTRACTS.push({
  title: 'Vendor Agreement — Cloudwave AWS Reseller',
  type: 'VENDOR',
  status: 'EXECUTED',
  ownerEmail: 'procurement@demo.com',
  counterpartyName: 'Cloudwave Inc',
  effectiveDate: '2025-08-15',
  expiryDate:    '2026-08-15',
  value: 480000,
  currency: 'USD',
  jurisdiction: 'California',
  tags: ['vendor', 'cloud', 'aws', 'expiring-soon'],
  summary: 'AWS reseller agreement with Cloudwave. $480K annual commit with 5% discount. Expires August 15, 2026 — currently inside the 90-day renewal window.',
  keyTerms: { annualCommit: 480000, discountPct: 5, paymentTerms: 'Net 45', cloudProvider: 'AWS' },
  riskScore: 0.40,
  riskFactors: ['Expires in <90 days', 'Annual commit with overage at list price', 'Auto-renews unless 60-day notice'],
  bodyHtml: htmlOf('CLOUD INFRASTRUCTURE RESELLER AGREEMENT', [
    { heading: '1. Parties', content: `<p>This Cloud Infrastructure Reseller Agreement (this "Agreement") is entered into and effective as of August 15, 2025 (the "Effective Date") by and between Cloudwave Technologies, Inc., a Delaware corporation ("Cloudwave"), and Demo Org, Inc., a Delaware corporation ("Customer").</p>` },
    { heading: '2. Services', content: `<p>Cloudwave shall provide Customer with: (a) access to Amazon Web Services ("AWS") cloud infrastructure under Cloudwave's Enterprise Discount Program ("EDP") commit pricing tier, (b) consolidated monthly billing across all of Customer's AWS accounts, (c) eligibility for a five percent (5%) discount on Customer's monthly AWS spend above the committed minimum, and (d) Cloudwave's standard tier of cloud advisory and architecture review services.</p>` },
    { heading: '3. Annual Commitment', content: `<p>Customer commits to an annual minimum spend of four hundred eighty thousand dollars (USD $480,000) on AWS services through the EDP commit (the "Annual Commit"). If Customer's actual monthly AWS spend, calculated on a trailing twelve-month basis, falls below the Annual Commit, Customer shall be obligated to pay the difference as a true-up at the end of the contract year. Spend in excess of the Annual Commit shall be billed at standard list pricing without the EDP discount.</p>` },
    { heading: '4. Payment Terms', content: `<p>Cloudwave shall invoice Customer monthly in arrears for actual AWS usage. Customer shall pay all undisputed invoices within forty-five (45) days of receipt. Late payments shall accrue interest at the rate of one percent (1%) per month or the maximum rate permitted by law, whichever is less.</p>` },
    { heading: '5. Term and Renewal', content: `<p>This Agreement shall commence on the Effective Date and continue for an initial term of twelve (12) months (the "Initial Term"). Thereafter, this Agreement shall automatically renew for successive twelve-month terms (each a "Renewal Term") unless either party provides written notice of non-renewal at least sixty (60) days prior to the end of the then-current term.</p>` },
    { heading: '6. Service Levels', content: `<p>Cloudwave shall pass through to Customer all AWS service-level commitments and any associated service credits earned by Cloudwave on Customer's behalf. Cloudwave's own SLA covers (a) billing accuracy (30-day correction window), (b) support response times (1 business day for high-priority tickets), and (c) advisory engagement scheduling.</p>` },
    { heading: '7. Confidentiality', content: `<p>Each party shall hold the other party's confidential information in strict confidence and use it solely to perform under this Agreement. Confidentiality obligations survive termination for a period of three (3) years.</p>` },
    { heading: '8. Limitation of Liability', content: `<p>EXCEPT FOR BREACHES OF CONFIDENTIALITY OR INDEMNIFICATION OBLIGATIONS, EACH PARTY'S AGGREGATE LIABILITY UNDER THIS AGREEMENT SHALL NOT EXCEED THE FEES PAID BY CUSTOMER IN THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE TO LIABILITY. NEITHER PARTY SHALL BE LIABLE FOR INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES.</p>` },
    { heading: '9. Termination', content: `<p>Either party may terminate this Agreement for material breach upon thirty (30) days' written notice and the opportunity to cure. Upon termination, Customer shall remain liable for any unpaid amounts and any true-up obligation under the Annual Commit, prorated through the date of termination.</p>` },
    { heading: '10. Governing Law', content: `<p>This Agreement shall be governed by the laws of the State of California, without regard to conflict-of-laws principles. Any disputes shall be resolved by binding arbitration administered by JAMS in San Francisco, California.</p>` },
  ]),
})

// ── #8 — Software License — Datadog (EXECUTED, ~60d to expiry) ──────
CONTRACTS.push({
  title: 'Software License Agreement — Datadog Monitoring',
  type: 'LICENSE',
  status: 'EXECUTED',
  ownerEmail: 'procurement@demo.com',
  counterpartyName: 'Datadog Inc',
  effectiveDate: '2025-06-30',
  expiryDate:    '2026-06-30',
  value: 120000,
  currency: 'USD',
  jurisdiction: 'New York',
  tags: ['license', 'observability', 'expiring-soon', 'auto-renew'],
  summary: 'Datadog Pro plan with 100 hosts. $120K annual. Auto-renews 60-day notice. Currently inside renewal window.',
  keyTerms: { plan: 'Datadog Pro', hosts: 100, annualFee: 120000, autoRenew: true, renewalNoticeDays: 60 },
  riskScore: 0.45,
  riskFactors: ['Auto-renew clause active', 'Expires in <90 days', 'No price-cap on renewal'],
  bodyHtml: htmlOf('SOFTWARE LICENSE AGREEMENT', [
    { heading: '1. Grant of License', content: `<p>Datadog, Inc. ("Datadog") grants Demo Org, Inc. ("Customer") a non-exclusive, non-transferable, worldwide license to access and use the Datadog Pro monitoring platform (the "Service") for Customer's internal business operations, subject to the terms of this Agreement and Datadog's Acceptable Use Policy.</p>` },
    { heading: '2. Subscribed Capacity', content: `<p>Plan: Datadog Pro. Subscribed hosts: one hundred (100). Effective Date: June 30, 2025. Initial Term: twelve (12) months. Annual fee: USD $120,000.</p>` },
    { heading: '3. Auto-Renewal', content: `<p>This Agreement shall automatically renew for successive 12-month terms unless either party provides written notice of non-renewal at least sixty (60) days prior to the end of the then-current term. Renewal pricing will be Datadog's then-current list pricing for the subscribed plan and capacity, with no contractual cap on year-over-year increases.</p>` },
    { heading: '4. Overage', content: `<p>If Customer exceeds the Subscribed Hosts in any month, Datadog will invoice Customer for the overage at $1,200 per host per year, prorated to the remainder of the term.</p>` },
    { heading: '5. Service Levels', content: `<p>Datadog shall maintain 99.9% monthly uptime for the Service. Service credits up to 25% of monthly fees are available for downtime below 99.5%.</p>` },
    { heading: '6. Data Ownership', content: `<p>Customer retains all right, title, and interest in Customer Data. Datadog shall use Customer Data solely to provide the Service and shall delete Customer Data within thirty (30) days following termination, except as required by law.</p>` },
    { heading: '7. Limitation of Liability', content: `<p>Datadog's aggregate liability under this Agreement shall not exceed the fees paid in the prior twelve (12) months. Datadog disclaims all liability for indirect, incidental, or consequential damages, including lost profits, lost data, or business interruption.</p>` },
    { heading: '8. Term, Renewal, and Termination', content: `<p>This Agreement shall continue until terminated. Either party may terminate for material breach upon thirty (30) days' notice and opportunity to cure. Customer may not terminate for convenience during the Initial Term or any Renewal Term.</p>` },
    { heading: '9. Governing Law', content: `<p>This Agreement shall be governed by the laws of the State of New York. Any disputes shall be resolved in the state or federal courts of New York County, New York.</p>` },
  ]),
})

// ── #3 — SOW#1 (Onboarding) — Zynga (EXECUTED) ──────────────────────
CONTRACTS.push({
  title: 'SOW #1 — Onboarding & Implementation (Zynga)',
  type: 'SOW',
  status: 'EXECUTED',
  ownerEmail: 'sales@demo.com',
  counterpartyName: 'Zynga Holdings',
  matterName: 'Zynga MSA — multi-year SaaS engagement',
  effectiveDate: '2026-02-15',
  expiryDate: '2026-05-31',
  value: 250000,
  currency: 'USD',
  jurisdiction: 'Delaware',
  tags: ['sow', 'onboarding', 'zynga'],
  summary: 'Initial onboarding SOW under Zynga MSA. Platform setup, data migration, training. Fixed $250K, 3-month engagement.',
  keyTerms: { totalFee: 250000, durationMonths: 3, scope: ['platform setup', 'data migration', 'training'] },
  riskScore: 0.15,
  riskFactors: [],
  bodyHtml: htmlOf('STATEMENT OF WORK #1', [
    { heading: '1. Parties and Reference', content: `<p>This Statement of Work #1 ("SOW") is entered into as of February 15, 2026 by and between Demo Org, Inc. ("Provider") and Zynga Holdings, LLC ("Customer"), and is governed by the Master Services Agreement between the parties dated February 12, 2026 (the "MSA").</p>` },
    { heading: '2. Scope of Services', content: `<p>Provider shall deliver: (a) initial platform configuration including SSO integration, role provisioning, and tenant setup; (b) data migration from Customer's existing CLM system, including up to 500 contracts and 50 templates; (c) twenty (20) hours of administrator training delivered in two onsite sessions; and (d) thirty (30) hours of go-live support during the cutover week.</p>` },
    { heading: '3. Timeline', content: `<p>Effective Date: February 15, 2026. Estimated go-live: April 15, 2026. SOW completion: May 31, 2026, or earlier upon Customer acceptance of all deliverables.</p>` },
    { heading: '4. Fees', content: `<p>Total fixed fee: USD $250,000, invoiced as follows: (i) USD $100,000 upon execution; (ii) USD $100,000 upon platform go-live; and (iii) USD $50,000 upon SOW completion. Net 30 payment terms.</p>` },
    { heading: '5. Acceptance Criteria', content: `<p>Each phase deliverable shall be deemed accepted upon Customer's written confirmation or upon expiration of a fifteen (15) business-day review period without written rejection.</p>` },
    { heading: '6. Signatures', content: `<p>DEMO ORG, INC. — Daniel Park, Senior Account Executive<br/>ZYNGA HOLDINGS, LLC — Sarah Nakamura, VP Engineering</p>` },
  ]),
})

// ── #13 — Settlement agreement (EXECUTED, Quill dispute) ────────────
CONTRACTS.push({
  title: 'Settlement & Release Agreement — Quill Technologies',
  type: 'SETTLEMENT',
  status: 'EXECUTED',
  ownerEmail: 'legal@demo.com',
  counterpartyName: 'Quill Technologies',
  matterName: 'Quill dispute — settlement & release',
  effectiveDate: '2026-02-28',
  value: 85000,
  currency: 'USD',
  jurisdiction: 'Massachusetts',
  tags: ['settlement', 'litigation', 'closed'],
  summary: 'Settlement of 2025 vendor performance dispute with Quill Technologies. Demo Org pays $85K in exchange for full mutual release; no admission of liability.',
  keyTerms: { paymentAmount: 85000, paymentDays: 30, releaseScope: 'mutual', noAdmission: true },
  riskScore: 0.10,
  riskFactors: [],
  bodyHtml: htmlOf('CONFIDENTIAL SETTLEMENT AND RELEASE AGREEMENT', [
    { heading: '1. Parties', content: `<p>This Confidential Settlement and Release Agreement (this "Agreement") is entered into as of February 28, 2026 (the "Effective Date") by and between Quill Technologies, LLC, a Massachusetts limited liability company ("Quill"), and Demo Org, Inc., a Delaware corporation ("Demo Org"). Quill and Demo Org are collectively referred to as the "Parties."</p>` },
    { heading: '2. Recitals', content: `<p>WHEREAS, the Parties have had a commercial dispute concerning Quill's performance under the Statement of Work dated July 1, 2025 (the "Disputed SOW"); and WHEREAS, the Parties wish to fully and finally resolve all claims and disputes arising from or related to the Disputed SOW without admission of any wrongdoing or liability by either Party; NOW, THEREFORE, in consideration of the mutual promises and covenants contained herein, the Parties agree as follows:</p>` },
    { heading: '3. Settlement Payment', content: `<p>Demo Org shall pay Quill the sum of eighty-five thousand dollars (USD $85,000) (the "Settlement Payment") within thirty (30) days of the Effective Date, by wire transfer to an account designated by Quill in writing. The Settlement Payment is in full and final satisfaction of all claims, demands, and causes of action that Quill has, may have, or could have against Demo Org arising from or related to the Disputed SOW.</p>` },
    { heading: '4. Mutual Release', content: `<p>Effective upon receipt of the Settlement Payment, each Party, on behalf of itself and its officers, directors, employees, agents, affiliates, successors, and assigns, hereby fully and forever releases, discharges, and acquits the other Party and its officers, directors, employees, agents, affiliates, successors, and assigns, from any and all claims, demands, causes of action, damages, losses, costs, and expenses (including attorneys' fees), whether known or unknown, asserted or unasserted, that such Party has or may have against the other Party arising from or related to the Disputed SOW, from the beginning of time through the Effective Date.</p>` },
    { heading: '5. No Admission of Liability', content: `<p>This Agreement is a compromise of disputed claims and shall not be construed as an admission of liability, fault, or wrongdoing by either Party. Each Party expressly denies any wrongdoing or liability.</p>` },
    { heading: '6. Confidentiality', content: `<p>The Parties shall keep the terms of this Agreement, including the amount of the Settlement Payment, strictly confidential, except that disclosure may be made: (a) to attorneys, accountants, and tax advisors bound by professional duties of confidentiality; (b) as required by law, regulation, or court order; (c) in connection with the enforcement of this Agreement; or (d) with the prior written consent of the other Party. The Parties shall not disparage each other or their respective products, services, or personnel.</p>` },
    { heading: '7. Termination of the Disputed SOW', content: `<p>The Disputed SOW is hereby terminated effective immediately. Each Party shall return or destroy any Confidential Information of the other Party in its possession received in connection with the Disputed SOW. The Parties' confidentiality obligations under the underlying NDA shall survive in accordance with its terms.</p>` },
    { heading: '8. Governing Law', content: `<p>This Agreement shall be governed by the laws of the Commonwealth of Massachusetts, without regard to conflict-of-laws principles. Any dispute arising from or related to this Agreement shall be brought exclusively in the state or federal courts located in Suffolk County, Massachusetts.</p>` },
    { heading: '9. Entire Agreement', content: `<p>This Agreement constitutes the entire understanding of the Parties with respect to the subject matter hereof and supersedes all prior negotiations and agreements. Any modification must be in writing and signed by both Parties.</p>` },
    { heading: '10. Counterparts', content: `<p>This Agreement may be executed in counterparts, including by electronic signature. Each Party represents that the signatory below is authorized to bind such Party.</p>` },
  ]),
})

// ── #2 — Master Services Agreement — Zynga (UNDER_NEGOTIATION) ──────
CONTRACTS.push({
  title: 'Master Services Agreement — Zynga × Demo Org',
  type: 'MSA',
  status: 'UNDER_NEGOTIATION',
  ownerEmail: 'legal@demo.com',
  counterpartyName: 'Zynga Holdings',
  matterName: 'Zynga MSA — multi-year SaaS engagement',
  effectiveDate: '2026-02-12',
  expiryDate:    '2027-02-11',
  value: 2400000,
  currency: 'USD',
  jurisdiction: 'Delaware',
  tags: ['msa', 'enterprise', 'zynga', 'under-negotiation'],
  summary: 'Multi-year MSA with Zynga ($2.4M ARR). Currently in legal review. Material risks: 6-month liability cap (we want 12), broad indemnity scope (we want carve-outs), 90-day cure period (we want 30).',
  keyTerms: {
    annualValue: 2400000,
    liabilityCapMonths: 6,        // counterparty's position
    paymentTerms: 'Net 60',       // counterparty's position
    autoRenew: true,
    governingLaw: 'Delaware',
    initialTerm: '36 months',
  },
  riskScore: 0.78,
  riskFactors: [
    'Liability cap at 6 months — playbook walkaway is <6, our preferred is 12',
    'Net 60 payment — outside playbook preferred Net 30',
    'Broad indemnity from Provider with no Customer-side reciprocal — playbook says mutual',
    '90-day cure period for material breach — playbook says 30 days',
    'Unilateral right to update DPA on 30-day notice',
  ],
  bodyHtml: htmlOf('MASTER SERVICES AGREEMENT', [
    { heading: '1. Parties and Effective Date', content: `<p>This Master Services Agreement (this "Agreement") is entered into and effective as of February 12, 2026 (the "Effective Date") by and between Demo Org, Inc., a Delaware corporation with its principal place of business at 224 Valencia Street, San Francisco, California 94103 ("Provider"), and Zynga Holdings, LLC, a Delaware limited liability company with its principal place of business at 699 8th Street, San Francisco, California 94103 ("Customer"). Provider and Customer are each a "Party" and collectively the "Parties."</p>` },
    { heading: '2. Definitions', content: `<p>"Authorized User" means an employee, contractor, or agent of Customer authorized by Customer to access and use the Services. "Confidential Information" means any non-public information disclosed by one Party to the other that is designated as confidential or that reasonably should be understood to be confidential. "Customer Data" means any data, content, or information uploaded to or processed by the Services by or on behalf of Customer. "Documentation" means Provider's then-current published technical documentation for the Services. "Order Form" or "SOW" means a written order or statement of work executed by the Parties referencing this Agreement. "Services" means the cloud-hosted contract lifecycle management software, related professional services, and support, as described in each Order Form or SOW.</p>` },
    { heading: '3. Provision of Services', content: `<p>Subject to Customer's compliance with this Agreement and the applicable Order Form or SOW, Provider shall provide the Services to Customer during the applicable Subscription Term. Provider shall use commercially reasonable efforts to provide the Services in accordance with the Service Level Agreement attached as Schedule A.</p>` },
    { heading: '4. Customer Responsibilities', content: `<p>Customer shall: (a) ensure that Authorized Users comply with this Agreement and any acceptable use policies; (b) maintain the security of its accounts and authentication credentials; (c) provide Provider with reasonable cooperation and access to information needed to perform the Services; (d) be responsible for the legality, accuracy, and content of all Customer Data; and (e) obtain any necessary consents from third parties whose information is included in Customer Data.</p>` },
    { heading: '5. Fees and Payment', content: `<p>Customer shall pay all fees specified in each Order Form or SOW. Fees are quoted exclusive of taxes, which are Customer's responsibility (other than taxes on Provider's income). Invoices are due within sixty (60) days of receipt. Late payments accrue interest at the rate of one percent (1%) per month or the maximum permitted by law, whichever is less. Customer shall reimburse reasonable collection costs.</p>` },
    { heading: '6. Confidentiality', content: `<p>Each Party (the "Receiving Party") shall hold the other Party's (the "Disclosing Party's") Confidential Information in strict confidence and use the same degree of care to prevent unauthorized disclosure as it uses for its own confidential information of similar nature, but in no event less than reasonable care. The Receiving Party shall use Confidential Information solely to perform under this Agreement and shall limit access to its personnel and advisors with a need to know who are bound by similar obligations. The obligations under this Section shall survive for five (5) years following termination, except that obligations regarding trade secrets shall survive for so long as such information remains a trade secret.</p>` },
    { heading: '7. Data Protection', content: `<p>The Parties' processing of Personal Data shall be governed by the Data Processing Addendum attached as Schedule B (the "DPA"). Provider may update the DPA from time to time on thirty (30) days' notice to comply with applicable law.</p>` },
    { heading: '8. Intellectual Property', content: `<p>(a) Provider Property. Provider retains all right, title, and interest in and to the Services, Documentation, Provider's software, and all derivatives, modifications, and improvements thereto. (b) Customer Property. As between the Parties, Customer retains all right, title, and interest in and to Customer Data. Customer grants Provider a worldwide, non-exclusive, royalty-free license to use, copy, store, transmit, and display Customer Data solely as needed to provide the Services. (c) Feedback. If Customer provides any feedback or suggestions regarding the Services, Provider may use such feedback without restriction or compensation.</p>` },
    { heading: '9. Warranties', content: `<p>Provider warrants that: (a) the Services will perform materially in accordance with the Documentation under normal use; and (b) Provider will use commercially reasonable efforts consistent with industry standards in performing professional services. Customer's exclusive remedy and Provider's sole obligation for breach of these warranties is for Provider to use commercially reasonable efforts to correct the non-conformity. EXCEPT FOR THE EXPRESS WARRANTIES IN THIS SECTION, THE SERVICES ARE PROVIDED "AS IS" AND PROVIDER DISCLAIMS ALL OTHER WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.</p>` },
    { heading: '10. Indemnification', content: `<p>(a) By Provider. Provider shall defend Customer from any third-party claim alleging that the Services, as provided by Provider and used by Customer in accordance with this Agreement, infringe such third party's U.S. patent, copyright, or trademark, and shall pay damages and costs finally awarded against Customer (or settled with Provider's consent). Provider's obligations do not apply to claims arising from (i) Customer Data, (ii) modifications to the Services not made by Provider, (iii) Customer's combination of the Services with any third-party product, or (iv) Customer's use of the Services other than in accordance with this Agreement and the Documentation.</p><p>(b) By Customer. Customer shall defend Provider from any third-party claim arising from (i) Customer Data, including any allegation that Customer Data infringes the rights of a third party or violates law; (ii) Customer's use of the Services in violation of this Agreement or applicable law; or (iii) Customer's modifications to the Services not made by Provider.</p>` },
    { heading: '11. Limitation of Liability', content: `<p>EXCEPT FOR (i) BREACHES OF CONFIDENTIALITY OR (ii) A PARTY'S INDEMNIFICATION OBLIGATIONS, EACH PARTY'S AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THIS AGREEMENT SHALL NOT EXCEED THE FEES PAID OR PAYABLE BY CUSTOMER IN THE SIX (6) MONTHS PRECEDING THE EVENT GIVING RISE TO LIABILITY. IN NO EVENT SHALL EITHER PARTY BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS, REVENUE, DATA, OR USE.</p>` },
    { heading: '12. Term and Termination', content: `<p>(a) Term. This Agreement commences on the Effective Date and continues for an initial term of thirty-six (36) months. Thereafter, this Agreement shall automatically renew for successive 12-month terms unless either Party provides written notice of non-renewal at least sixty (60) days prior to the end of the then-current term.</p><p>(b) Termination for Cause. Either Party may terminate this Agreement for material breach upon ninety (90) days' written notice to the other Party if such breach is not cured during the notice period. Customer shall have no right to terminate for convenience during the Initial Term.</p><p>(c) Effect of Termination. Upon termination or expiration, Customer's right to access the Services shall immediately cease. Provider shall make Customer Data available for export for thirty (30) days following termination, after which Provider may delete Customer Data.</p>` },
    { heading: '13. Suspension', content: `<p>Provider may suspend Customer's access to the Services upon written notice if (a) Customer's account is more than thirty (30) days past due, (b) Customer's use of the Services poses a security risk, or (c) Customer breaches the acceptable use policy. Provider shall use commercially reasonable efforts to resolve the issue causing suspension promptly.</p>` },
    { heading: '14. Governing Law', content: `<p>This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware, without regard to its conflict-of-laws principles. Any dispute shall be brought exclusively in the state or federal courts located in New Castle County, Delaware. Each Party waives the right to a jury trial.</p>` },
    { heading: '15. Miscellaneous', content: `<p>(a) Entire Agreement. This Agreement, together with all Schedules and Order Forms, constitutes the entire agreement between the Parties and supersedes all prior negotiations and agreements regarding the subject matter. (b) Amendments. Any amendment must be in writing and signed by both Parties. (c) Assignment. Neither Party may assign this Agreement without the other Party's prior written consent, except in connection with a merger, acquisition, or sale of substantially all of its assets, in which case the assignee shall be bound by all terms of this Agreement. (d) Notices. All notices must be in writing and sent to the address specified on the signature page or to such other address as a Party may designate in writing. (e) Force Majeure. Neither Party shall be liable for any delay or failure to perform due to causes beyond its reasonable control, including acts of God, war, terrorism, riots, embargoes, acts of civil or military authorities, fires, floods, accidents, network infrastructure failures, strikes, or shortages of transportation facilities, fuel, energy, labor, or materials. (f) Severability. If any provision is held unenforceable, the remaining provisions shall remain in full force and effect.</p>` },
  ]),
})

// ── #5 — DPA — Zynga (EXECUTED) ─────────────────────────────────────
CONTRACTS.push({
  title: 'Data Processing Addendum — Zynga (GDPR)',
  type: 'DPA',
  status: 'EXECUTED',
  ownerEmail: 'legal@demo.com',
  counterpartyName: 'Zynga Holdings',
  matterName: 'Zynga MSA — multi-year SaaS engagement',
  effectiveDate: '2026-02-12',
  jurisdiction: 'Delaware',
  tags: ['dpa', 'gdpr', 'zynga'],
  summary: 'GDPR-compliant DPA addendum to the Zynga MSA. Provider acts as Processor; Customer as Controller. SCCs Module 2 incorporated. 72-hour breach notification, annual audit right, sub-processor approval.',
  keyTerms: { sccsModule: 'Module 2', breachNoticeHours: 72, auditRights: 'annual', subProcessorApproval: 'opt-out (30 days)' },
  riskScore: 0.20,
  riskFactors: ['Sub-processor approval is opt-out (we prefer opt-in for material processors)'],
  bodyHtml: htmlOf('DATA PROCESSING ADDENDUM', [
    { heading: '1. Subject Matter and Roles', content: `<p>This Data Processing Addendum (this "DPA") supplements the Master Services Agreement between Demo Org, Inc. ("Processor") and Zynga Holdings, LLC ("Controller") dated February 12, 2026 (the "MSA"). For purposes of this DPA, Controller is the data controller and Processor acts as the data processor with respect to Personal Data processed in connection with the Services.</p>` },
    { heading: '2. Scope and Duration', content: `<p>This DPA applies whenever Processor processes Personal Data on behalf of Controller in connection with the Services. The duration of processing shall match the term of the MSA.</p>` },
    { heading: '3. Processor Obligations', content: `<p>Processor shall: (a) process Personal Data only on documented written instructions from Controller, including with regard to transfers to third countries, unless required to do otherwise by Union or Member State law (in which case Processor shall inform Controller of that legal requirement before processing, unless that law prohibits such information on important grounds of public interest); (b) ensure that persons authorized to process Personal Data have committed themselves to confidentiality; (c) implement appropriate technical and organizational measures consistent with Article 32 GDPR; (d) respect the conditions for engaging sub-processors set forth in Section 5; (e) taking into account the nature of processing, assist Controller by appropriate technical and organizational measures, insofar as possible, in fulfilling Controller's obligation to respond to data subject requests under Articles 12-22 GDPR; (f) assist Controller in ensuring compliance with Articles 32-36 GDPR; (g) at Controller's election, delete or return all Personal Data after termination; and (h) make available to Controller all information necessary to demonstrate compliance with this DPA.</p>` },
    { heading: '4. Security Measures', content: `<p>Processor shall maintain the security measures described in Annex II, which address access control, encryption in transit and at rest, network security, vulnerability management, business continuity, incident response, and personnel security. Processor shall regularly test, assess, and evaluate the effectiveness of its security measures.</p>` },
    { heading: '5. Sub-Processors', content: `<p>(a) Existing Sub-Processors. Controller authorizes Processor's engagement of the sub-processors listed in Annex III. (b) New Sub-Processors. Processor shall provide thirty (30) days' notice before engaging any new sub-processor. Controller may object on reasonable grounds within fifteen (15) days of such notice; if Controller objects, the parties shall work in good faith to resolve the concern, and if not resolved within thirty (30) days, Controller may terminate the affected portion of the Services with a pro-rated refund.</p>` },
    { heading: '6. International Transfers', content: `<p>Where Processor transfers Personal Data outside of the European Economic Area or the United Kingdom to a country not deemed adequate by the European Commission or UK ICO, the parties shall rely on the Standard Contractual Clauses adopted by the European Commission on June 4, 2021, Module 2 (Controller to Processor), incorporated herein by reference and completed as set forth in Annex IV.</p>` },
    { heading: '7. Personal Data Breach', content: `<p>Processor shall notify Controller without undue delay and in any case within seventy-two (72) hours after becoming aware of any Personal Data Breach affecting Controller's Personal Data. Such notice shall include: (a) the nature of the Personal Data Breach including, where possible, the categories and approximate number of data subjects concerned; (b) the likely consequences of the Personal Data Breach; and (c) the measures taken or proposed to be taken to address the Personal Data Breach and mitigate its possible adverse effects.</p>` },
    { heading: '8. Audits', content: `<p>Controller may, on no more than once per year basis (except in the event of a Personal Data Breach), audit Processor's compliance with this DPA on thirty (30) days' written notice. Such audits shall be conducted during normal business hours, in a manner that does not unreasonably interfere with Processor's operations, and at Controller's expense unless the audit reveals a material breach of this DPA. Processor may satisfy the audit obligation by providing recent SOC 2 Type II reports or equivalent third-party attestations.</p>` },
    { heading: '9. Return or Deletion', content: `<p>Upon termination of the Services, Processor shall, at Controller's election, return all Personal Data to Controller or delete and destroy all Personal Data in its possession or control, except to the extent retention is required by law, in which case Processor shall continue to comply with this DPA with respect to such retained Personal Data.</p>` },
    { heading: '10. Liability', content: `<p>The liability provisions of the MSA apply to this DPA, except that neither party may exclude or limit its liability for breach of its data protection obligations under applicable law that cannot be limited by agreement.</p>` },
    { heading: 'Annex I — Description of Processing', content: `<p>Categories of data subjects: Customer's employees, contractors, and counterparties. Categories of Personal Data: name, email, phone, business address, role/title, contract preferences. Special categories: none expected. Frequency: continuous. Nature and purpose: contract lifecycle management.</p>` },
    { heading: 'Annex II — Security Measures', content: `<p>Encryption in transit (TLS 1.2+) and at rest (AES-256). Role-based access controls. SSO/SAML support. Quarterly security training for personnel. Annual SOC 2 Type II and ISO 27001 audits. 24/7 security monitoring. Documented incident response procedures.</p>` },
    { heading: 'Annex III — Approved Sub-Processors', content: `<p>Amazon Web Services (US-East-1) — cloud hosting. SendGrid — transactional email. Stripe — payment processing. OpenAI — generative AI features (Customer may opt out).</p>` },
    { heading: 'Annex IV — SCCs Module 2 Schedules', content: `<p>(a) List of Parties — Demo Org, Inc. (data importer); Zynga Holdings, LLC (data exporter). (b) Description of Transfer — as set forth in Annex I. (c) Competent Supervisory Authority — Irish Data Protection Commission.</p>` },
  ]),
})

// ── #15 — Amendment #1 to Zynga MSA (EXECUTED) ──────────────────────
CONTRACTS.push({
  title: 'Amendment #1 to Zynga MSA — Liability Cap Adjustment',
  type: 'AMENDMENT',
  status: 'EXECUTED',
  ownerEmail: 'legal@demo.com',
  counterpartyName: 'Zynga Holdings',
  matterName: 'Zynga MSA — multi-year SaaS engagement',
  parentTitle: 'Master Services Agreement — Zynga × Demo Org',
  effectiveDate: '2026-04-01',
  jurisdiction: 'Delaware',
  tags: ['amendment', 'msa', 'zynga'],
  summary: 'Amendment #1 to the Zynga MSA increasing the liability cap from 6 months to 12 months in exchange for a 2% pricing adjustment. Negotiated by Legal in March 2026.',
  keyTerms: { newCapMonths: 12, oldCapMonths: 6, pricingAdjustment: '+2%' },
  riskScore: 0.10,
  riskFactors: [],
  bodyHtml: htmlOf('AMENDMENT #1 TO MASTER SERVICES AGREEMENT', [
    { heading: '1. Reference', content: `<p>This Amendment #1 (this "Amendment") is entered into as of April 1, 2026 (the "Amendment Effective Date") by and between Demo Org, Inc. ("Provider") and Zynga Holdings, LLC ("Customer"), and amends the Master Services Agreement between the parties dated February 12, 2026 (the "MSA"). Capitalized terms used but not defined herein have the meanings set forth in the MSA.</p>` },
    { heading: '2. Amendment to Section 11 (Limitation of Liability)', content: `<p>Section 11 of the MSA is hereby deleted in its entirety and replaced with the following: "EXCEPT FOR (i) BREACHES OF CONFIDENTIALITY, (ii) A PARTY'S INDEMNIFICATION OBLIGATIONS, AND (iii) GROSS NEGLIGENCE OR WILLFUL MISCONDUCT, EACH PARTY'S AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THIS AGREEMENT SHALL NOT EXCEED THE FEES PAID OR PAYABLE BY CUSTOMER IN THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE TO LIABILITY. IN NO EVENT SHALL EITHER PARTY BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES."</p>` },
    { heading: '3. Pricing Adjustment', content: `<p>In consideration of the amendment to Section 11, the annual subscription fee under each Order Form executed under the MSA shall be increased by two percent (2%), effective as of the Amendment Effective Date. The first invoice reflecting this adjustment shall be issued in accordance with the standard billing cycle.</p>` },
    { heading: '4. Effect of Amendment', content: `<p>Except as expressly modified by this Amendment, all terms and conditions of the MSA shall remain in full force and effect. In the event of any conflict between this Amendment and the MSA, this Amendment shall control with respect to the matters addressed herein.</p>` },
    { heading: '5. Counterparts', content: `<p>This Amendment may be executed in counterparts, including by electronic signature. Each Party represents that the signatory below is authorized to bind such Party.</p><p>DEMO ORG, INC.<br/>By: ___________________________<br/>Name: Maya Goldberg<br/>Title: General Counsel</p><p>ZYNGA HOLDINGS, LLC<br/>By: ___________________________<br/>Name: Michael O'Brien<br/>Title: Chief Legal Officer</p>` },
  ]),
})

// ── #7 — Reseller agreement — Pacific Distribution (UNDER_NEGOTIATION) ──
CONTRACTS.push({
  title: 'Reseller Agreement — Pacific Distribution Co.',
  type: 'RESELLER',
  status: 'UNDER_NEGOTIATION',
  ownerEmail: 'sales@demo.com',
  counterpartyName: 'Pacific Distribution Co.',
  effectiveDate: '2026-05-15',
  expiryDate:    '2028-05-14',
  jurisdiction: 'California',
  tags: ['reseller', 'channel', 'high-priority'],
  summary: 'Two-year reseller agreement with Pacific Distribution. Revenue share at 25% (we want 20%). Exclusivity in APAC ex-Japan. Currently in counteroffer.',
  keyTerms: { revenueSharePct: 25, term: '24 months', exclusivity: 'APAC ex-Japan', minimumQuotaUSD: 1500000 },
  riskScore: 0.62,
  riskFactors: [
    'Revenue share above playbook (25% vs preferred 20%)',
    'Exclusivity carve-out for Japan only — broader than typical',
    'Minimum annual quota of $1.5M with no relief mechanism',
  ],
  bodyHtml: htmlOf('CHANNEL RESELLER AGREEMENT', [
    { heading: '1. Parties', content: `<p>This Channel Reseller Agreement (this "Agreement") is entered into as of May 15, 2026 (the "Effective Date") by and between Demo Org, Inc. ("Vendor") and Pacific Distribution Company ("Reseller").</p>` },
    { heading: '2. Appointment', content: `<p>Vendor hereby appoints Reseller as a non-exclusive reseller of the Services in the territory defined as the Asia-Pacific region excluding Japan (the "Territory"). Reseller shall not market or sell the Services outside the Territory without Vendor's prior written consent.</p>` },
    { heading: '3. Revenue Share', content: `<p>Reseller shall be entitled to a revenue share equal to twenty-five percent (25%) of the net subscription fees collected by Vendor from each customer originated by Reseller. Net subscription fees means gross fees less applicable taxes, refunds, and customer credits. Vendor shall pay Reseller's share within thirty (30) days of receipt of payment from the underlying customer.</p>` },
    { heading: '4. Minimum Annual Quota', content: `<p>Reseller commits to delivering a minimum of USD $1,500,000 in net subscription fees per contract year (the "Quota"). If Reseller fails to meet the Quota in any contract year, Vendor may, at its option, (a) reduce or eliminate Reseller's exclusivity in the Territory, (b) reduce the revenue share for the following year by 5 percentage points, or (c) terminate this Agreement.</p>` },
    { heading: '5. Reseller Responsibilities', content: `<p>Reseller shall: (a) actively market the Services in the Territory using Vendor-approved materials; (b) maintain a qualified sales and pre-sales team trained on the Services; (c) submit pipeline and forecast reports to Vendor on a monthly basis; (d) comply with Vendor's brand guidelines and do not represent itself as Vendor; and (e) ensure all customers execute Vendor's standard end-user agreement.</p>` },
    { heading: '6. Vendor Responsibilities', content: `<p>Vendor shall: (a) provide Reseller with sales enablement materials, pricing tools, and product training; (b) maintain the Services in good working order in accordance with the published SLA; and (c) handle all support, billing, and contract administration directly with end customers.</p>` },
    { heading: '7. Term and Termination', content: `<p>This Agreement shall commence on the Effective Date and continue for an initial term of twenty-four (24) months. Either party may terminate this Agreement (a) for material breach upon thirty (30) days' written notice and the opportunity to cure, or (b) for convenience upon ninety (90) days' written notice after the first contract anniversary. Termination shall not affect Reseller's right to revenue share for customers originated prior to termination, which shall continue for the remaining term of each such customer's then-current subscription.</p>` },
    { heading: '8. Confidentiality and IP', content: `<p>Each party shall maintain the confidentiality of the other party's confidential information for a period of three (3) years following termination. Vendor retains all right, title, and interest in the Services. Reseller's use of Vendor's trademarks shall be limited to those usages expressly approved in writing.</p>` },
    { heading: '9. Limitation of Liability', content: `<p>Each party's aggregate liability shall not exceed the revenue share paid in the twelve (12) months preceding the event. Neither party shall be liable for indirect, incidental, or consequential damages.</p>` },
    { heading: '10. Governing Law', content: `<p>This Agreement shall be governed by the laws of California. Any dispute shall be resolved by binding arbitration administered by JAMS in San Francisco.</p>` },
  ]),
})

// ── #11 — Commercial Lease (UNDER_NEGOTIATION, HQ matter) ───────────
CONTRACTS.push({
  title: 'Commercial Lease — 1 Embarcadero Center, Floor 3',
  type: 'LEASE',
  status: 'UNDER_NEGOTIATION',
  ownerEmail: 'finance@demo.com',
  counterpartyName: 'Bayview Property Management',
  matterName: 'HQ relocation — 1 Embarcadero Center',
  effectiveDate: '2026-06-01',
  expiryDate:    '2031-05-31',
  value: 432000,
  currency: 'USD',
  jurisdiction: 'California',
  tags: ['lease', 'real-estate', 'long-term', 'capex'],
  summary: '5-year commercial lease for our new HQ at 1 Embarcadero Center, Floor 3. ~12,000 sq ft. $36K/mo base rent ($432K/yr). Includes 6 months free rent + $200K TI allowance. Currently negotiating force majeure + assignment provisions.',
  keyTerms: {
    monthlyRent: 36000, squareFeet: 12000, termYears: 5,
    freeRentMonths: 6, tiAllowanceUSD: 200000,
    annualEscalator: '3%', renewalOption: '5-year option at FMV',
  },
  riskScore: 0.55,
  riskFactors: [
    'Long lock-in period (5 years, no early-termination right)',
    'Personal guarantee request from Landlord (we are pushing back)',
    'Force majeure clause excludes pandemic — needs revision after COVID precedent',
    'Annual rent escalator at 3% with no CPI cap',
  ],
  bodyHtml: htmlOf('OFFICE LEASE', [
    { heading: '1. Parties and Premises', content: `<p>This Office Lease (this "Lease") is entered into and effective as of June 1, 2026 (the "Effective Date") by and between Bayview Property Management, LP, a California limited partnership ("Landlord"), and Demo Org, Inc., a Delaware corporation ("Tenant"). Landlord hereby leases to Tenant, and Tenant hereby leases from Landlord, approximately 12,000 rentable square feet on the third (3rd) floor of the building located at 1 Embarcadero Center, San Francisco, California 94111 (the "Premises"), for use as general office space and for no other purpose.</p>` },
    { heading: '2. Term', content: `<p>The term of this Lease shall commence on June 1, 2026 (the "Commencement Date") and shall continue until May 31, 2031, unless sooner terminated as provided herein (the "Initial Term"). Tenant shall have one (1) option to extend the Initial Term for an additional sixty (60) months at the then-prevailing fair market rental rate, exercisable upon not less than nine (9) months' prior written notice to Landlord.</p>` },
    { heading: '3. Base Rent', content: `<p>Tenant shall pay to Landlord monthly base rent of thirty-six thousand dollars (USD $36,000) (the "Base Rent"), payable in advance on the first day of each month. Base Rent shall escalate by three percent (3%) on each anniversary of the Commencement Date. Notwithstanding the foregoing, Tenant shall be entitled to six (6) months of free Base Rent commencing on the Commencement Date (the "Rent Abatement"). The Rent Abatement shall not apply to Tenant's obligation to pay Operating Expenses, taxes, or other charges hereunder.</p>` },
    { heading: '4. Tenant Improvements', content: `<p>Landlord shall provide Tenant with a tenant improvement allowance of two hundred thousand dollars (USD $200,000) (the "TI Allowance") to be used for the construction of Tenant's improvements to the Premises in accordance with plans and specifications approved by Landlord. The TI Allowance shall be paid by Landlord to Tenant or Tenant's contractors upon substantial completion of the work and submission of properly documented invoices and lien waivers. Any improvement costs in excess of the TI Allowance shall be borne solely by Tenant.</p>` },
    { heading: '5. Operating Expenses and Taxes', content: `<p>Tenant shall pay its proportionate share of Operating Expenses and Real Estate Taxes for the Building, which is estimated to be approximately twelve thousand dollars (USD $12,000) per month. Operating Expenses include all costs incurred by Landlord in operating, maintaining, and managing the Building, including utilities, janitorial, security, insurance, and repairs. Real Estate Taxes include all real property taxes and assessments levied against the Building. Operating Expenses and Real Estate Taxes shall be reconciled annually.</p>` },
    { heading: '6. Use', content: `<p>Tenant shall use the Premises solely for general office purposes consistent with the character of a Class A office building. Tenant shall not use or permit the Premises to be used for any unlawful purpose or in any manner that creates a nuisance, hazard, or violation of law.</p>` },
    { heading: '7. Maintenance and Repairs', content: `<p>Landlord shall maintain the structural elements of the Building, the common areas, the building systems serving multiple tenants (HVAC, elevators, plumbing risers, electrical mains), and the exterior. Tenant shall maintain the interior of the Premises in good condition, ordinary wear and tear excepted, and shall be responsible for the repair of any damage caused by Tenant or its agents.</p>` },
    { heading: '8. Insurance and Indemnification', content: `<p>Tenant shall maintain commercial general liability insurance with limits of not less than $2,000,000 per occurrence, property insurance covering Tenant's personal property and improvements, and workers' compensation insurance as required by law. Tenant shall name Landlord as additional insured. Tenant shall indemnify, defend, and hold Landlord harmless from any claims, damages, or liabilities arising from Tenant's use of the Premises or breach of this Lease, except to the extent caused by Landlord's gross negligence or willful misconduct.</p>` },
    { heading: '9. Default', content: `<p>The following shall constitute an Event of Default by Tenant: (a) failure to pay Base Rent or Operating Expenses when due, with such failure continuing for more than ten (10) days after written notice; (b) failure to perform any other obligation under this Lease, with such failure continuing for more than thirty (30) days after written notice; (c) Tenant's bankruptcy or insolvency; or (d) abandonment of the Premises. Upon an Event of Default, Landlord may terminate this Lease, recover possession, and pursue all remedies available at law or equity.</p>` },
    { heading: '10. Assignment and Subletting', content: `<p>Tenant shall not assign this Lease or sublet all or any portion of the Premises without Landlord's prior written consent, which shall not be unreasonably withheld. Notwithstanding the foregoing, Tenant may assign this Lease or sublet to any affiliate of Tenant or to any successor entity in connection with a merger, acquisition, or sale of substantially all of Tenant's assets, provided such assignee or sublessee has a tangible net worth at least equal to that of Tenant immediately prior to the assignment or subletting.</p>` },
    { heading: '11. Force Majeure', content: `<p>Neither party shall be liable for any delay or failure in the performance of its obligations under this Lease (other than the payment of money) due to causes beyond its reasonable control, including acts of God, war, terrorism, riots, embargoes, fires, floods, earthquakes, and acts of civil or military authority. For the avoidance of doubt, "force majeure" does not include pandemic, epidemic, or government-mandated business closures.</p>` },
    { heading: '12. Surrender', content: `<p>Upon termination of this Lease, Tenant shall surrender the Premises in good condition, ordinary wear and tear excepted, with all personal property, trade fixtures, and signage removed and any damage caused by such removal repaired.</p>` },
    { heading: '13. Governing Law', content: `<p>This Lease shall be governed by the laws of the State of California. Any disputes shall be brought exclusively in the state or federal courts located in San Francisco County, California.</p>` },
  ]),
})

// ── #12 — Distribution Agreement — Asia Capital Partners (EXECUTED) ──
CONTRACTS.push({
  title: 'Distribution Agreement — APAC Region (Asia Capital Partners)',
  type: 'DISTRIBUTION',
  status: 'EXECUTED',
  ownerEmail: 'sales@demo.com',
  counterpartyName: 'Asia Capital Partners',
  effectiveDate: '2025-11-01',
  expiryDate:    '2027-10-31',
  jurisdiction: 'Singapore',
  tags: ['distribution', 'apac', 'international'],
  summary: 'APAC distribution agreement with Asia Capital Partners (Singapore). 24-month term with rev-share. Singapore-law-governed; SIAC arbitration.',
  keyTerms: { revenueSharePct: 18, exclusivity: 'Non-exclusive', term: '24 months', territory: 'APAC' },
  riskScore: 0.30,
  riskFactors: ['Singapore arbitration may be costly to enforce in US', 'No minimum performance commitment'],
  bodyHtml: htmlOf('DISTRIBUTION AGREEMENT', [
    { heading: '1. Parties', content: `<p>This Distribution Agreement (this "Agreement") is entered into and effective as of November 1, 2025 (the "Effective Date") by and between Demo Org, Inc., a Delaware corporation ("Vendor"), and Asia Capital Partners Pte. Ltd., a Singapore private limited company ("Distributor").</p>` },
    { heading: '2. Appointment', content: `<p>Vendor hereby appoints Distributor as a non-exclusive distributor of the Services in the Asia-Pacific region (the "Territory"), including without limitation Singapore, Malaysia, Indonesia, Thailand, Vietnam, the Philippines, India, Hong Kong, and Australia. Distributor shall have the right to market, promote, and resell the Services to end customers in the Territory.</p>` },
    { heading: '3. Distributor Obligations', content: `<p>Distributor shall (a) market the Services in the Territory using its own sales and marketing personnel; (b) at its own cost, translate marketing materials into local languages as appropriate; (c) maintain a local presence sufficient to provide pre-sales engagement; (d) ensure customers in the Territory enter into Vendor's standard end-user agreements; and (e) report sales activity and pipeline on a quarterly basis.</p>` },
    { heading: '4. Vendor Obligations', content: `<p>Vendor shall (a) provide the Services in accordance with the SLA; (b) provide reasonable sales and product training to Distributor; and (c) provide marketing materials and case studies that Distributor may use under the trademark license set forth in Section 7.</p>` },
    { heading: '5. Compensation', content: `<p>Vendor shall pay Distributor a revenue share equal to eighteen percent (18%) of the net subscription fees collected by Vendor from each end customer originated by Distributor in the Territory. Net subscription fees means gross fees less applicable taxes, refunds, and customer credits. Vendor shall pay Distributor's share within thirty (30) days of receipt of payment from the end customer.</p>` },
    { heading: '6. Term and Termination', content: `<p>This Agreement shall commence on the Effective Date and continue for an initial term of twenty-four (24) months. Either party may terminate (a) for convenience upon ninety (90) days' written notice or (b) for material breach upon thirty (30) days' written notice and opportunity to cure.</p>` },
    { heading: '7. Trademark License', content: `<p>Vendor grants Distributor a non-exclusive, royalty-free license to use Vendor's trademarks solely in connection with marketing the Services in the Territory in accordance with Vendor's brand guidelines.</p>` },
    { heading: '8. Confidentiality', content: `<p>Each party shall maintain the confidentiality of the other party's confidential information in accordance with the standards of the locality. Confidentiality obligations survive termination for a period of three (3) years.</p>` },
    { heading: '9. Limitation of Liability', content: `<p>Each party's aggregate liability under this Agreement shall not exceed the revenue share paid in the prior twelve (12) months. Neither party shall be liable for indirect or consequential damages.</p>` },
    { heading: '10. Governing Law and Arbitration', content: `<p>This Agreement shall be governed by the laws of Singapore, without regard to conflict-of-laws principles. Any dispute shall be referred to and finally resolved by arbitration administered by the Singapore International Arbitration Centre ("SIAC") in accordance with the SIAC Rules then in force. The seat of arbitration shall be Singapore. The language of arbitration shall be English.</p>` },
  ]),
})

// ─────────────────────────────────────────────────────────────────────
//                          INSERTION
// ─────────────────────────────────────────────────────────────────────

async function main() {
  const admin = await prisma.user.findFirst({ where: { email: 'admin@demo.com' }, select: { id: true, orgId: true } })
  if (!admin) throw new Error('admin@demo.com not found')
  const { orgId, id: adminId } = admin
  console.log(`[contracts] target org=${orgId}; ${CONTRACTS.length} contracts to seed.\n`)

  // Pre-fetch FK lookups
  const userByEmail = Object.fromEntries(
    (await prisma.user.findMany({ where: { orgId }, select: { id: true, email: true } })).map(u => [u.email, u.id]),
  )
  const cpByName = Object.fromEntries(
    (await prisma.counterparty.findMany({ where: { orgId }, select: { id: true, name: true } })).map(c => [c.name, c.id]),
  )
  const matterByName = Object.fromEntries(
    (await prisma.matter.findMany({ where: { orgId, deletedAt: null }, select: { id: true, name: true } })).map(m => [m.name, m.id]),
  )

  // First pass — create contracts (skipping any that need a parent we haven't seeded yet)
  for (const c of CONTRACTS) {
    const existing = await prisma.contract.findFirst({ where: { orgId, title: c.title, deletedAt: null } })
    if (existing) {
      console.log(`  · ${c.title.slice(0, 70).padEnd(72)} (exists)`)
      continue
    }
    if (c.parentTitle) continue   // defer amendments to second pass

    const ownerId = userByEmail[c.ownerEmail] ?? adminId
    const counterpartyId = cpByName[c.counterpartyName]
    const matterId = c.matterName ? matterByName[c.matterName] : undefined

    const created = await prisma.contract.create({
      data: {
        orgId,
        title: c.title,
        type: c.type,
        status: c.status,
        counterpartyId,
        counterpartyName: c.counterpartyName,
        matterId,
        ownerId,
        createdBy: adminId,
        value: c.value,
        currency: c.currency ?? 'USD',
        jurisdiction: c.jurisdiction,
        effectiveDate: c.effectiveDate ? new Date(c.effectiveDate) : undefined,
        expiryDate: c.expiryDate ? new Date(c.expiryDate) : undefined,
        analysisStatus: 'DONE',
        summary: c.summary,
        keyTerms: (c.keyTerms ?? {}) as object,
        riskScore: c.riskScore,
        riskFactors: c.riskFactors ?? [],
        tags: c.tags ?? [],
        versions: {
          create: {
            versionNumber: 1,
            htmlContent: c.bodyHtml,
            plainText: htmlToPlain(c.bodyHtml),
            createdById: adminId,
          },
        },
      },
      include: { versions: true },
    })
    await prisma.contract.update({
      where: { id: created.id },
      data: { currentVersionId: created.versions[0].id },
    })
    console.log(`  ✓ ${c.title.slice(0, 70).padEnd(72)} [${c.status.padEnd(18)}] $${(c.value ?? 0).toLocaleString()}`)
  }

  // Second pass — create amendments now that parents exist
  for (const c of CONTRACTS) {
    if (!c.parentTitle) continue
    const existing = await prisma.contract.findFirst({ where: { orgId, title: c.title, deletedAt: null } })
    if (existing) continue
    const parent = await prisma.contract.findFirst({ where: { orgId, title: c.parentTitle, deletedAt: null }, select: { id: true } })
    const ownerId = userByEmail[c.ownerEmail] ?? adminId
    const counterpartyId = cpByName[c.counterpartyName]
    const matterId = c.matterName ? matterByName[c.matterName] : undefined

    const created = await prisma.contract.create({
      data: {
        orgId,
        title: c.title,
        type: c.type,
        status: c.status,
        counterpartyId,
        counterpartyName: c.counterpartyName,
        matterId,
        ownerId,
        createdBy: adminId,
        parentContractId: parent?.id,
        relationshipType: c.type === 'AMENDMENT' ? 'amendment' : (c.type === 'SOW' ? 'sow' : null),
        value: c.value,
        currency: c.currency ?? 'USD',
        jurisdiction: c.jurisdiction,
        effectiveDate: c.effectiveDate ? new Date(c.effectiveDate) : undefined,
        expiryDate: c.expiryDate ? new Date(c.expiryDate) : undefined,
        analysisStatus: 'DONE',
        summary: c.summary,
        keyTerms: (c.keyTerms ?? {}) as object,
        riskScore: c.riskScore,
        riskFactors: c.riskFactors ?? [],
        tags: c.tags ?? [],
        versions: {
          create: {
            versionNumber: 1,
            htmlContent: c.bodyHtml,
            plainText: htmlToPlain(c.bodyHtml),
            createdById: adminId,
          },
        },
      },
      include: { versions: true },
    })
    await prisma.contract.update({
      where: { id: created.id },
      data: { currentVersionId: created.versions[0].id },
    })
    console.log(`  ✓ ${c.title.slice(0, 70).padEnd(72)} [${c.status.padEnd(18)}] (amendment of ${c.parentTitle?.slice(0, 30)})`)
  }

  // Final report
  const total = await prisma.contract.count({ where: { orgId, deletedAt: null } })
  console.log(`\n[contracts] total contracts in org: ${total}`)

  // Status breakdown
  const breakdown = await prisma.contract.groupBy({
    by: ['status'],
    where: { orgId, deletedAt: null },
    _count: true,
  })
  console.log('  by status:')
  breakdown.forEach(b => console.log(`    ${(b.status ?? '?').padEnd(20)} ${b._count}`))

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
