/**
 * Biotech industry pack — research collaboration, materials transfer,
 * IND/clinical-data ownership, GLP/GMP compliance clauses, MTA template.
 */
import type { SeedClause }           from '../universal/clauses.js'
import type { SeedTemplate }         from '../universal/templates.js'
import type { SeedPlaybookPosition } from '../universal/playbook.js'

export const BIOTECH_CLAUSES: SeedClause[] = [
  {
    categorySlug: 'ip-ownership', title: 'Background IP — Pre-Existing Materials',
    content: `<p>Each party retains all rights in its pre-existing biological materials, compounds, cell lines, vectors, software, data, and know-how brought into the collaboration ("Background IP"). Neither party acquires any license to the other party's Background IP except as expressly granted in this Agreement.</p>`,
    tags: ['biotech', 'ip', 'background-materials'], riskRating: 'standard', isApproved: true,
  },
  {
    categorySlug: 'ip-ownership', title: 'Foreground IP — Joint Inventions',
    content: `<p>Inventions, discoveries, or improvements conceived or reduced to practice jointly by personnel of both parties in the course of the collaboration ("Joint IP") are jointly owned. Each party may exploit Joint IP in its own field without accounting to the other party, subject to the licensing terms set forth in the applicable Statement of Work.</p>`,
    tags: ['biotech', 'ip', 'joint-inventions'], riskRating: 'neutral', isApproved: true,
  },
  {
    categorySlug: 'ip-ownership', title: 'Clinical Data Ownership',
    content: `<p>Clinical trial data generated under this Agreement is owned by the Sponsor. The Investigator may publish abstracts and articles based on the Sponsor's data subject to Sponsor's prior written review for confidentiality and timing (review window not to exceed 60 days, plus an additional 60 days if Sponsor seeks IP protection).</p>`,
    tags: ['biotech', 'clinical-data', 'publication'], riskRating: 'standard', isApproved: true,
  },
  {
    categorySlug: 'compliance', title: 'GLP / GMP Compliance',
    content: `<p>Provider will perform any preclinical safety studies in accordance with Good Laboratory Practice (GLP, 21 CFR Part 58) and any manufacturing of clinical or commercial supplies in accordance with current Good Manufacturing Practice (cGMP, 21 CFR Parts 210–211 and 600–680, as applicable). Provider will maintain all records and documentation required to support FDA submissions.</p>`,
    tags: ['biotech', 'glp', 'gmp', 'fda'], riskRating: 'favorable', isApproved: true,
  },
  {
    categorySlug: 'compliance', title: 'Animal Welfare and IACUC',
    content: `<p>Any animal studies will be performed in accordance with the U.S. Animal Welfare Act, the National Research Council Guide for the Care and Use of Laboratory Animals, and an approved Institutional Animal Care and Use Committee (IACUC) protocol. Provider will provide copies of relevant approvals on request.</p>`,
    tags: ['biotech', 'animal-welfare', 'iacuc'], riskRating: 'standard', isApproved: true,
  },
  {
    categorySlug: 'compliance', title: 'Human Subjects and IRB',
    content: `<p>Any research involving human subjects or human-derived materials will be conducted under an approved Institutional Review Board (IRB) protocol, in compliance with 45 CFR Part 46 (Common Rule), 21 CFR Parts 50 and 56, and applicable state laws. Informed consent will be obtained from all subjects.</p>`,
    tags: ['biotech', 'human-subjects', 'irb'], riskRating: 'standard', isApproved: true,
  },
  {
    categorySlug: 'warranties', title: 'Research-Use-Only / No Diagnostic or Therapeutic Use',
    content: `<p>Materials provided under this Agreement are for research use only. The Recipient will not use the Materials in humans, in diagnostic procedures, or in commercial products without a separate written license. The Materials are provided "AS IS" with no warranty of safety or efficacy.</p>`,
    tags: ['biotech', 'ruo', 'research-use-only'], riskRating: 'standard', isApproved: true,
  },
]

export const BIOTECH_TEMPLATES: SeedTemplate[] = [
  {
    name: 'Material Transfer Agreement (Research)',
    description: 'Standard MTA for transferring biological materials between research entities for non-commercial research use.',
    contractType: 'MTA',
    isPublished: true,
    variables: [
      { key: 'providerName',    label: 'Provider Institution',   type: 'string', required: true },
      { key: 'recipientName',   label: 'Recipient Institution',  type: 'string', required: true },
      { key: 'effectiveDate',   label: 'Effective Date',         type: 'date',   required: true },
      { key: 'materialDescription', label: 'Material Description', type: 'string', required: true },
      { key: 'researchPurpose', label: 'Research Purpose',       type: 'string', required: true },
    ],
    sections: [
      { title: 'Provider and Recipient', sortOrder: 10, content: `<p>This Material Transfer Agreement is entered into as of {{effectiveDate}} between {{providerName}} ("Provider") and {{recipientName}} ("Recipient").</p>` },
      { title: 'Material',          sortOrder: 20, content: `<p>Provider will transfer to Recipient {{materialDescription}} (the "Original Material"), together with any progeny and unmodified derivatives (collectively, the "Material").</p>` },
      { title: 'Use of the Material', sortOrder: 30, content: `<p>Recipient will use the Material solely for {{researchPurpose}} and for no other purpose. Recipient will not use the Material in human subjects, in diagnostic procedures, or for commercial purposes. Recipient will not transfer the Material to any third party without Provider's prior written consent.</p>` },
      { title: 'Ownership',         sortOrder: 40, content: `<p>Provider retains all rights in the Material, including all progeny and unmodified derivatives. Modifications and inventions made by Recipient using the Material are owned by Recipient, subject to Provider's rights in the underlying Material.</p>` },
      { title: 'Publications',      sortOrder: 50, content: `<p>Recipient may publish research results based on the Material. Recipient will provide Provider with a copy of any proposed publication at least 30 days before submission. Recipient will acknowledge Provider in any publication.</p>` },
      { title: 'No Warranty',       sortOrder: 60, content: `<p>The Material is provided "AS IS" without any warranty of any kind. Provider makes no representation that the Material is safe, effective, or suitable for any particular purpose, or that its use will not infringe any third-party rights.</p>` },
      { title: 'Indemnification',   sortOrder: 70, content: `<p>Recipient will indemnify Provider against any claim arising from Recipient's use, storage, or handling of the Material, except to the extent caused by Provider's gross negligence or willful misconduct.</p>` },
      { title: 'Term and Termination', sortOrder: 80, content: `<p>This Agreement continues until the research purpose is complete or terminated by either party on 30 days' notice. On termination, Recipient will return or destroy any remaining Material at Provider's direction.</p>` },
    ],
  },
]

export const BIOTECH_PLAYBOOK: SeedPlaybookPosition[] = [
  { key: 'bio-bg-ip-retained',        categorySlug: 'ip-ownership', positionType: 'preferred',  content: `<p>Each party retains all rights in pre-existing materials and IP. No implied licenses.</p>`,                                                                                notes: 'Standard for research collaborations.',                                                     riskThreshold: 0.7, contractTypes: ['MTA', 'Research'], sortOrder: 5 },
  { key: 'bio-joint-ip-acceptable',   categorySlug: 'ip-ownership', positionType: 'acceptable', content: `<p>Joint ownership for inventions made jointly. Each party may exploit in its own field without accounting.</p>`,                                                                  notes: 'Often the easiest compromise.',                                                             riskThreshold: 0.5, contractTypes: ['Research', 'Collaboration'], sortOrder: 5 },
  { key: 'bio-clinical-data-sponsor', categorySlug: 'ip-ownership', positionType: 'preferred',  content: `<p>Sponsor owns clinical data. Investigator publication right with sponsor pre-review (60-day window, +60-day for IP).</p>`,                                                  notes: 'Standard for sponsored clinical trials.',                                                  riskThreshold: 0.7, contractTypes: ['Clinical', 'CRO'], sortOrder: 5 },
  { key: 'bio-glp-gmp-required',      categorySlug: 'compliance',   positionType: 'preferred',  content: `<p>GLP for preclinical safety studies. cGMP for clinical/commercial manufacturing. FDA-submission-ready documentation.</p>`,                                                  notes: 'Required for any FDA filing.',                                                              riskThreshold: 0.9, contractTypes: ['CMO', 'Preclinical'], sortOrder: 5 },
  { key: 'bio-ruo-warranty',          categorySlug: 'warranties',   positionType: 'acceptable', content: `<p>"Research use only" labeling for transferred materials. Express disclaimer of safety, efficacy, and fitness for human/diagnostic use.</p>`,                                  notes: 'Required for academic MTAs.',                                                               riskThreshold: 0.6, contractTypes: ['MTA'], sortOrder: 5 },
  { key: 'bio-publication-block',     categorySlug: 'ip-ownership', positionType: 'walkaway',   content: `<p>Sponsor demands unlimited publication suppression right OR &gt;120-day review window without good cause.</p>`,                                                                   notes: 'Reject — kills academic credibility.',                                                      riskThreshold: 0.2, contractTypes: ['Clinical', 'Research'], sortOrder: 30 },
]
