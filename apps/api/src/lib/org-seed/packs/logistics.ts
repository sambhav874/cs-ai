/**
 * Logistics industry pack — carrier liability, fuel surcharges, demurrage,
 * detention, Incoterms-aware transportation clauses, transportation services
 * agreement template.
 */
import type { SeedClause }           from '../universal/clauses.js'
import type { SeedTemplate }         from '../universal/templates.js'
import type { SeedPlaybookPosition } from '../universal/playbook.js'

export const LOGISTICS_CLAUSES: SeedClause[] = [
  {
    categorySlug: 'liability', title: 'Carrier Cargo Liability — Carmack / Released Value',
    content: `<p>For shipments subject to the Carmack Amendment (49 USC § 14706), Carrier's liability for loss or damage to Cargo is the actual value of the Cargo at the point of origin, subject to a maximum of $5.00 per pound per package unless Shipper declares a higher released value in writing and pays the applicable surcharge. International shipments are subject to the Montreal or Warsaw Convention or Hague-Visby Rules, as applicable.</p>`,
    tags: ['logistics', 'carrier-liability', 'carmack'], riskRating: 'standard', isApproved: true,
  },
  {
    categorySlug: 'fees-payment', title: 'Fuel Surcharge',
    content: `<p>Rates are subject to a fuel surcharge, calculated weekly based on the U.S. Department of Energy's national average diesel price published each Monday. The fuel surcharge applies as set forth in Exhibit A and may be adjusted up or down as fuel prices change.</p>`,
    tags: ['logistics', 'fuel-surcharge', 'doe'], riskRating: 'neutral', isApproved: true,
  },
  {
    categorySlug: 'fees-payment', title: 'Demurrage and Detention',
    content: `<p>Free time for loading and unloading is two (2) hours per stop. Detention beyond free time is charged at $75 per hour or fraction thereof. Demurrage charges apply to containers held at port or rail beyond the carrier's free time at the applicable per diem rate.</p>`,
    tags: ['logistics', 'demurrage', 'detention'], riskRating: 'neutral', isApproved: true,
  },
  {
    categorySlug: 'scope-services', title: 'Delivery Service Levels',
    content: `<p>Carrier will achieve on-time pickup and on-time delivery performance of at least 95% measured monthly. "On-time" means within the 2-hour delivery window confirmed at booking. Shipments delayed by more than 24 hours from the scheduled delivery time are subject to a 25% rate refund.</p>`,
    tags: ['logistics', 'otp', 'service-level'], riskRating: 'favorable', isApproved: true,
  },
  {
    categorySlug: 'insurance', title: 'Auto Liability and Cargo Insurance',
    content: `<p>Carrier will maintain (a) Commercial Auto Liability insurance of not less than $1,000,000 combined single limit; (b) Motor Truck Cargo insurance of not less than $250,000 per shipment with no exclusions for shipper's commodity; and (c) General Liability of not less than $1,000,000. Carrier will name Shipper as additional insured on the Auto Liability policy.</p>`,
    tags: ['logistics', 'insurance', 'cargo'], riskRating: 'favorable', isApproved: true,
  },
  {
    categorySlug: 'compliance', title: 'DOT / FMCSA Compliance',
    content: `<p>Carrier represents that it (a) is registered with the Federal Motor Carrier Safety Administration with active operating authority; (b) maintains a satisfactory safety rating (or no rating if newly registered); (c) complies with Hours-of-Service regulations (49 CFR Part 395); and (d) maintains valid Electronic Logging Devices on all commercial motor vehicles as required by 49 CFR Part 395.</p>`,
    tags: ['logistics', 'fmcsa', 'dot', 'hos'], riskRating: 'standard', isApproved: true,
  },
  {
    categorySlug: 'compliance', title: 'Hazardous Materials',
    content: `<p>Carrier will not transport hazardous materials, hazardous substances, or hazardous wastes (as those terms are defined under 49 CFR Parts 171–180) unless (a) Shipper provides accurate shipping papers and labeling and (b) Carrier holds the necessary hazmat endorsement and permits.</p>`,
    tags: ['logistics', 'hazmat'], riskRating: 'standard', isApproved: true,
  },
  {
    categorySlug: 'scope-services', title: 'Subcontracting / Brokering',
    content: `<p>Carrier may not subcontract or broker any Shipment without Shipper's prior written consent. If Shipper consents, Carrier remains primarily liable to Shipper for the performance of any subcontracted carrier and ensures all subcontractors meet the insurance and compliance requirements of this Agreement.</p>`,
    tags: ['logistics', 'brokering', 'subcontract'], riskRating: 'favorable', isApproved: true,
  },
]

export const LOGISTICS_TEMPLATES: SeedTemplate[] = [
  {
    name: 'Transportation Services Agreement',
    description: 'Master agreement between a shipper and a motor carrier for over-the-road transportation services.',
    contractType: 'Transportation',
    isPublished: true,
    variables: [
      { key: 'shipperName',     label: 'Shipper Name',           type: 'string', required: true },
      { key: 'carrierName',     label: 'Carrier Name',           type: 'string', required: true },
      { key: 'effectiveDate',   label: 'Effective Date',         type: 'date',   required: true },
      { key: 'serviceLanes',    label: 'Service Lanes',          type: 'string', required: true, helpText: 'e.g., "Continental US, including Hawaii"' },
      { key: 'currency',        label: 'Currency',               type: 'string', required: true, defaultValue: 'USD' },
    ],
    sections: [
      { title: 'Services',          sortOrder: 10,  content: `<p>This Transportation Services Agreement is entered into as of {{effectiveDate}} between {{shipperName}} ("Shipper") and {{carrierName}} ("Carrier"). Carrier will provide motor carrier transportation services for Shipper within {{serviceLanes}}.</p>` },
      { title: 'Carrier Authority',  sortOrder: 20, content: `<p>Carrier represents that it is registered with the FMCSA with active operating authority and a satisfactory (or unrated, if newly registered) safety rating, complies with Hours-of-Service regulations, and maintains ELDs on all commercial motor vehicles.</p>` },
      { title: 'Rates and Surcharges', sortOrder: 30, content: `<p>Linehaul rates are set forth in Exhibit A. Fuel surcharge adjusts weekly based on the DOE national average diesel price. Accessorial charges per Exhibit B. All rates in {{currency}}, net 30.</p>` },
      { title: 'Service Levels',    sortOrder: 40,  content: `<p>Carrier will achieve 95% on-time pickup and delivery against the windows confirmed at booking. Shipments delayed &gt; 24 hours from the scheduled delivery time are subject to a 25% rate refund. Carrier will provide tracking visibility via EDI 214 or API.</p>` },
      { title: 'Free Time and Accessorials', sortOrder: 50, content: `<p>2 hours free time at each stop. Detention at $75/hour beyond free time. Demurrage at the published per-diem rate. Layover at $300/day if the driver is held overnight not at fault of Carrier.</p>` },
      { title: 'Cargo Liability',   sortOrder: 60,  content: `<p>Carrier's liability for Cargo loss or damage is the actual value at origin, capped at $5.00/lb. per package unless Shipper declares a higher released value. Claims must be filed within 9 months of delivery, with reasonable cooperation in investigation.</p>` },
      { title: 'Insurance',         sortOrder: 70,  content: `<p>Carrier maintains Auto Liability $1M CSL, Motor Truck Cargo $250K (no exclusions for Shipper's commodity), General Liability $1M, Workers' Comp at statutory. Shipper named additional insured on Auto Liability. COIs annually.</p>` },
      { title: 'Subcontracting',    sortOrder: 80,  content: `<p>No subcontracting or brokering without Shipper's written consent. Carrier remains primarily liable for any approved subcontractors.</p>` },
      { title: 'Term and Termination', sortOrder: 90, content: `<p>1-year initial term, renewing annually unless either party gives 60 days' non-renewal notice. Termination for material breach with 30-day cure. Either party may terminate for the other's loss of operating authority or insurance.</p>` },
      { title: 'Indemnification',   sortOrder: 100, content: `<p>Carrier will indemnify Shipper against claims arising from Carrier's negligence, breach, or violation of law in performing the services. Shipper will indemnify Carrier against claims arising from defective packaging or undeclared hazardous materials provided by Shipper.</p>` },
    ],
  },
]

export const LOGISTICS_PLAYBOOK: SeedPlaybookPosition[] = [
  { key: 'log-liability-actual',      categorySlug: 'liability',       positionType: 'preferred',  content: `<p>Carrier liability at actual value (Carmack default), no per-pound cap below $5/lb. Released value option for higher-value freight.</p>`,                                  notes: 'Default Carmack position.',                                                                 riskThreshold: 0.7, contractTypes: ['Transportation'], sortOrder: 5 },
  { key: 'log-otp-95',                categorySlug: 'service-levels',  positionType: 'preferred',  content: `<p>95%+ on-time pickup and delivery against confirmed windows. Late-delivery refunds (≥25%) for &gt;24-hour delays.</p>`,                                                      notes: 'Enterprise standard.',                                                                      riskThreshold: 0.7, contractTypes: ['Transportation'], sortOrder: 5 },
  { key: 'log-cargo-ins-250k',        categorySlug: 'insurance',       positionType: 'preferred',  content: `<p>Motor Truck Cargo $250K minimum with no commodity exclusions. Auto Liability $1M+. Shipper as additional insured on Auto.</p>`,                                              notes: 'Minimum for general freight.',                                                              riskThreshold: 0.7, contractTypes: ['Transportation'], sortOrder: 5 },
  { key: 'log-no-broker-consent',     categorySlug: 'scope-services',  positionType: 'preferred',  content: `<p>No brokering or subcontracting without Shipper's written consent. Carrier primarily liable for approved subcontractors.</p>`,                                                notes: 'Avoid loss of visibility/control.',                                                         riskThreshold: 0.7, contractTypes: ['Transportation'], sortOrder: 5 },
  { key: 'log-fuel-doe-weekly',       categorySlug: 'fees-payment',    positionType: 'acceptable', content: `<p>Fuel surcharge tied to weekly DOE national average diesel index, transparent calculation in Exhibit A.</p>`,                                                                  notes: 'Industry-standard pattern.',                                                                riskThreshold: 0.5, contractTypes: ['Transportation'], sortOrder: 5 },
  { key: 'log-cargo-ins-walkaway',    categorySlug: 'insurance',       positionType: 'walkaway',   content: `<p>Carrier refuses to name Shipper as additional insured, OR maintains cargo coverage &lt; $100K, OR has exclusions for Shipper's primary commodity.</p>`,                          notes: 'Reject — insufficient coverage.',                                                           riskThreshold: 0.1, contractTypes: ['Transportation'], sortOrder: 30 },
]
