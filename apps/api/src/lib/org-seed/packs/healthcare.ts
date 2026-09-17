/**
 * Healthcare industry pack — HIPAA-aware clauses, Business Associate
 * Agreement template, and playbook positions for handling Protected Health
 * Information (PHI).
 */
import type { SeedClause }           from '../universal/clauses.js'
import type { SeedTemplate }         from '../universal/templates.js'
import type { SeedPlaybookPosition } from '../universal/playbook.js'

export const HEALTHCARE_CLAUSES: SeedClause[] = [
  {
    categorySlug: 'data-privacy', title: 'HIPAA — Business Associate Status',
    content: `<p>The parties acknowledge that, to the extent Provider creates, receives, maintains, or transmits Protected Health Information ("PHI") on behalf of Customer in connection with the Services, Provider is a "Business Associate" and Customer is a "Covered Entity" or "Business Associate" (as applicable) under the HIPAA Privacy Rule and Security Rule. The Business Associate Agreement attached as Exhibit {{baaExhibit}} governs the handling of PHI.</p>`,
    tags: ['healthcare', 'hipaa', 'baa', 'phi'], riskRating: 'standard', isApproved: true,
  },
  {
    categorySlug: 'data-privacy', title: 'HIPAA — Minimum Necessary',
    content: `<p>Provider will request, use, and disclose only the minimum amount of PHI reasonably necessary to perform the Services, in accordance with the Minimum Necessary standard under HIPAA.</p>`,
    tags: ['healthcare', 'hipaa', 'minimum-necessary'], riskRating: 'standard', isApproved: true,
  },
  {
    categorySlug: 'data-privacy', title: 'HIPAA Breach Notification — 60 Days',
    content: `<p>Provider will notify Customer of any actual or reasonably suspected Breach of Unsecured PHI without unreasonable delay and in no event later than 60 calendar days after discovery, with the information required by 45 CFR § 164.410.</p>`,
    tags: ['healthcare', 'hipaa', 'breach-notification', '60-day'], riskRating: 'standard', isApproved: true,
  },
  {
    categorySlug: 'security', title: 'HIPAA Security Rule Safeguards',
    content: `<p>Provider will implement administrative, physical, and technical safeguards required by the HIPAA Security Rule (45 CFR Part 164, Subpart C), including access controls, audit controls, integrity controls, transmission security, and workforce training. Provider's safeguards are aligned with the NIST Cybersecurity Framework and SP 800-53.</p>`,
    tags: ['healthcare', 'hipaa', 'security-rule', 'nist'], riskRating: 'favorable', isApproved: true,
  },
  {
    categorySlug: 'security', title: 'HITRUST or SOC 2 + HITECH Certification',
    content: `<p>Provider will maintain HITRUST CSF certification (or, alternatively, SOC 2 Type II reports that include a HITECH/HIPAA examination scope) during the Term and will furnish reports to Customer annually upon request.</p>`,
    tags: ['healthcare', 'hitrust', 'soc2', 'hitech'], riskRating: 'favorable', isApproved: true,
  },
  {
    categorySlug: 'compliance', title: 'Anti-Kickback Statute and Stark Law Compliance',
    content: `<p>The parties agree that the fees and other terms of this Agreement have been negotiated at arm's length, represent fair market value for the Services, and are not intended to induce or reward referrals of patients or business in violation of the federal Anti-Kickback Statute (42 USC § 1320a-7b(b)) or the Stark Law (42 USC § 1395nn).</p>`,
    tags: ['healthcare', 'anti-kickback', 'stark'], riskRating: 'standard', isApproved: true,
  },
  {
    categorySlug: 'data-privacy', title: 'De-Identification',
    content: `<p>Provider may use PHI to create de-identified data (under the Safe Harbor or Expert Determination methods of 45 CFR § 164.514(b)) and to use such de-identified data for purposes of improving the Services and producing aggregate analytics. De-identified data is not PHI and is not subject to HIPAA restrictions.</p>`,
    tags: ['healthcare', 'hipaa', 'de-identification'], riskRating: 'neutral', isApproved: true,
  },
  {
    categorySlug: 'data-privacy', title: 'Patient Access to PHI',
    content: `<p>Provider will, within 15 days of Customer's request, make available to Customer (for forwarding to a patient) any PHI in a designated record set held by Provider, to enable Customer to comply with its obligations under 45 CFR § 164.524.</p>`,
    tags: ['healthcare', 'hipaa', 'patient-access'], riskRating: 'standard', isApproved: true,
  },
]

export const HEALTHCARE_TEMPLATES: SeedTemplate[] = [
  {
    name: 'Business Associate Agreement (BAA)',
    description: 'HIPAA-compliant Business Associate Agreement for vendors handling PHI on behalf of a Covered Entity or upstream Business Associate.',
    contractType: 'BAA',
    isPublished: true,
    variables: [
      { key: 'coveredEntityName', label: 'Covered Entity Name',  type: 'string', required: true },
      { key: 'businessAssociateName', label: 'Business Associate Name', type: 'string', required: true },
      { key: 'underlyingAgreement', label: 'Underlying Services Agreement', type: 'string', required: true },
      { key: 'effectiveDate',   label: 'Effective Date',         type: 'date',   required: true },
    ],
    sections: [
      { title: 'Preamble',          sortOrder: 10,  content: `<p>This Business Associate Agreement ("BAA") is entered into as of {{effectiveDate}} between {{coveredEntityName}} ("Covered Entity") and {{businessAssociateName}} ("Business Associate") and supplements the {{underlyingAgreement}} (the "Underlying Agreement").</p>` },
      { title: 'Definitions',       sortOrder: 20,  content: `<p>Capitalized terms have the meanings given in the HIPAA Rules (45 CFR Parts 160 and 164), including "PHI," "Breach," "Designated Record Set," "Health Care Operations," and "Security Incident."</p>` },
      { title: 'Permitted Uses and Disclosures', sortOrder: 30, content: `<p>Business Associate may use and disclose PHI only to (a) perform functions specified in the Underlying Agreement; (b) provide data aggregation services to Covered Entity; (c) carry out Business Associate's proper management and administration; and (d) comply with legal obligations. Business Associate will limit use and disclosure to the Minimum Necessary.</p>` },
      { title: 'Safeguards',        sortOrder: 40,  content: `<p>Business Associate will implement administrative, physical, and technical safeguards in accordance with the HIPAA Security Rule (45 CFR §§ 164.308, 164.310, 164.312, 164.316) to protect Electronic PHI from unauthorized access, use, or disclosure.</p>` },
      { title: 'Subcontractors',    sortOrder: 50,  content: `<p>Business Associate will obtain written assurances from any Subcontractor that creates, receives, maintains, or transmits PHI on its behalf, in the form of a BAA imposing obligations no less protective than this BAA.</p>` },
      { title: 'Breach Notification', sortOrder: 60, content: `<p>Business Associate will notify Covered Entity of any Breach of Unsecured PHI without unreasonable delay and in any event within 60 calendar days of discovery, with the information required by 45 CFR § 164.410.</p>` },
      { title: 'Access, Amendment, and Accounting', sortOrder: 70, content: `<p>Business Associate will, within 15 days of Covered Entity's request, (a) provide access to PHI in a Designated Record Set; (b) make amendments to PHI; and (c) provide an accounting of disclosures, in each case to enable Covered Entity to meet its obligations under 45 CFR §§ 164.524–164.528.</p>` },
      { title: 'Termination',       sortOrder: 80,  content: `<p>This BAA terminates with the Underlying Agreement. On termination, Business Associate will return or destroy all PHI in its possession, or, if return or destruction is not feasible, extend the protections of this BAA to such PHI and limit further use and disclosure.</p>` },
      { title: 'Obligations of Covered Entity', sortOrder: 90, content: `<p>Covered Entity will (a) provide Business Associate with its Notice of Privacy Practices; (b) notify Business Associate of any restrictions on uses or disclosures of PHI agreed to by Covered Entity; and (c) not request Business Associate to use or disclose PHI in a manner that would violate HIPAA if done by Covered Entity directly.</p>` },
      { title: 'Miscellaneous',     sortOrder: 100, content: `<p>This BAA will be interpreted to give effect to the parties' intent that Business Associate complies with HIPAA. In the event of conflict between this BAA and the Underlying Agreement, this BAA controls with respect to PHI. This BAA may be amended in writing as needed to comply with changes to HIPAA.</p>` },
    ],
  },
]

export const HEALTHCARE_PLAYBOOK: SeedPlaybookPosition[] = [
  { key: 'hc-baa-required',           categorySlug: 'data-privacy', positionType: 'preferred',  content: `<p>BAA required and signed before any PHI is shared. BAA includes 60-day breach notification, sub-processor BAAs, return/destroy on termination.</p>`,                          notes: 'Non-negotiable for PHI handling.',                                                          riskThreshold: 0.9, contractTypes: ['BAA'], sortOrder: 5 },
  { key: 'hc-hitrust-preferred',      categorySlug: 'security',     positionType: 'preferred',  content: `<p>HITRUST CSF certified, OR SOC 2 Type II with HITECH scope. Annual attestation provided.</p>`,                                                                                  notes: 'For healthcare data vendors.',                                                              riskThreshold: 0.8, contractTypes: [], sortOrder: 5 },
  { key: 'hc-soc2-acceptable',        categorySlug: 'security',     positionType: 'acceptable', content: `<p>SOC 2 Type II maintained. Annual security questionnaire. Penetration testing annually.</p>`,                                                                                       notes: 'Acceptable if no PHI involved.',                                                            riskThreshold: 0.5, contractTypes: [], sortOrder: 6 },
  { key: 'hc-aks-stark-required',     categorySlug: 'compliance',   positionType: 'preferred',  content: `<p>Express acknowledgment that fees represent fair market value and are not intended to induce referrals. Anti-Kickback and Stark Law compliance commitments.</p>`,                  notes: 'Required if any provider/payer overlap.',                                                  riskThreshold: 0.8, contractTypes: [], sortOrder: 5 },
  { key: 'hc-deid-acceptable',        categorySlug: 'data-privacy', positionType: 'acceptable', content: `<p>Vendor may use de-identified data (per Safe Harbor or Expert Determination) for product improvement and aggregate analytics.</p>`,                                                  notes: 'Standard ask in healthcare SaaS.',                                                          riskThreshold: 0.5, contractTypes: [], sortOrder: 7 },
  { key: 'hc-no-baa-walkaway',        categorySlug: 'data-privacy', positionType: 'walkaway',   content: `<p>Vendor refuses to sign BAA or insists on terms materially weaker than HHS sample BAA, OR breach notification longer than 60 days.</p>`,                                            notes: 'Reject — HIPAA non-compliant.',                                                             riskThreshold: 0.1, contractTypes: [], sortOrder: 30 },
]
