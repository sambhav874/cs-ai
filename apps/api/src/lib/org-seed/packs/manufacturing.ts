/**
 * Manufacturing industry pack — supply-chain and goods-purchase clauses,
 * Master Supply Agreement template, playbook positions for buying physical
 * goods or contracting OEM manufacturing.
 */
import type { SeedClause }           from '../universal/clauses.js'
import type { SeedTemplate }         from '../universal/templates.js'
import type { SeedPlaybookPosition } from '../universal/playbook.js'

export const MANUFACTURING_CLAUSES: SeedClause[] = [
  {
    categorySlug: 'scope-services', title: 'Delivery Terms — FCA (Incoterms 2020)',
    content: `<p>Unless otherwise specified in a purchase order, all deliveries are FCA Seller's facility (Incoterms 2020). Title and risk of loss pass to Buyer upon delivery to Buyer's nominated carrier at Seller's facility.</p>`,
    tags: ['manufacturing', 'incoterms', 'fca', 'delivery'], riskRating: 'neutral', isApproved: true,
  },
  {
    categorySlug: 'scope-services', title: 'Inspection and Acceptance of Goods',
    content: `<p>Buyer may inspect Goods within 30 days of delivery. Buyer may reject Goods that fail to conform to the specifications in the applicable purchase order by giving written notice describing the non-conformity. Seller will, at Buyer's option, repair, replace, or refund the price of non-conforming Goods. Goods not rejected within 30 days are deemed accepted.</p>`,
    tags: ['manufacturing', 'inspection', 'acceptance'], riskRating: 'standard', isApproved: true,
  },
  {
    categorySlug: 'warranties', title: 'Product Warranty — 12 Months',
    content: `<p>Seller warrants that the Goods will be free from defects in material and workmanship and will conform to the specifications for a period of twelve (12) months from delivery. Seller's sole obligation under this warranty is to, at its option, repair, replace, or refund the purchase price of non-conforming Goods.</p>`,
    tags: ['manufacturing', 'product-warranty', 'workmanship'], riskRating: 'standard', isApproved: true,
  },
  {
    categorySlug: 'warranties', title: 'Recall Cooperation',
    content: `<p>If either party becomes aware of any defect or safety issue that may necessitate a recall, withdrawal, or corrective action with respect to any Goods, that party will notify the other party promptly. The parties will cooperate in good faith to investigate and, if necessary, implement a recall. Seller will bear the cost of any recall attributable to defects in the Goods.</p>`,
    tags: ['manufacturing', 'recall', 'safety'], riskRating: 'favorable', isApproved: true,
  },
  {
    categorySlug: 'force-majeure', title: 'Supply-Chain Force Majeure',
    content: `<p>Force Majeure includes, in addition to other events, the unavailability of components or raw materials from Seller's supply chain due to events beyond Seller's reasonable control, including export controls, tariffs, port closures, and shortages affecting the industry generally. Seller will use commercially reasonable efforts to source alternate supplies and to notify Buyer of allocation impacts.</p>`,
    tags: ['manufacturing', 'force-majeure', 'supply-chain'], riskRating: 'neutral', isApproved: true,
  },
  {
    categorySlug: 'compliance', title: 'Country of Origin and Tariff Compliance',
    content: `<p>Seller will, on each shipment, accurately declare the country of origin of the Goods and provide all documentation required for Buyer to claim applicable preferential tariff treatment (including USMCA certifications). Seller is responsible for the accuracy of country-of-origin declarations.</p>`,
    tags: ['manufacturing', 'tariffs', 'country-of-origin', 'usmca'], riskRating: 'favorable', isApproved: true,
  },
  {
    categorySlug: 'ip-ownership', title: 'OEM / Custom Tooling Ownership',
    content: `<p>If Buyer pays for custom tooling, molds, or fixtures, Buyer owns the tooling. Seller will maintain the tooling, use it solely to produce Goods for Buyer, and return or destroy it at Buyer's direction on termination of the supply relationship.</p>`,
    tags: ['manufacturing', 'oem', 'tooling'], riskRating: 'favorable', isApproved: true,
  },
  {
    categorySlug: 'fees-payment', title: 'Price Adjustment — Raw Materials',
    content: `<p>Seller may adjust prices on 60 days' written notice in response to material changes (greater than 10%) in the cost of key raw materials, supported by reasonable documentation. Buyer may, in lieu of accepting the price adjustment, terminate the affected orders without penalty.</p>`,
    tags: ['manufacturing', 'price-adjustment', 'raw-materials'], riskRating: 'neutral', isApproved: true,
  },
]

export const MANUFACTURING_TEMPLATES: SeedTemplate[] = [
  {
    name: 'Master Supply Agreement',
    description: 'Long-term supply agreement for repetitive purchases of manufactured goods.',
    contractType: 'Supply',
    isPublished: true,
    variables: [
      { key: 'buyerName',       label: 'Buyer Name',             type: 'string', required: true },
      { key: 'sellerName',      label: 'Seller Name',            type: 'string', required: true },
      { key: 'effectiveDate',   label: 'Effective Date',         type: 'date',   required: true },
      { key: 'goodsCategory',   label: 'Category of Goods',      type: 'string', required: true },
      { key: 'currency',        label: 'Currency',               type: 'string', required: true, defaultValue: 'USD' },
      { key: 'incoterm',        label: 'Default Incoterm',       type: 'enum',   required: true, defaultValue: 'FCA Seller facility (Incoterms 2020)', options: ['FCA Seller facility (Incoterms 2020)', 'DAP Buyer facility (Incoterms 2020)', 'EXW Seller facility (Incoterms 2020)'] },
    ],
    sections: [
      { title: 'Scope',             sortOrder: 10, content: `<p>This Master Supply Agreement is entered into as of {{effectiveDate}} between {{buyerName}} ("Buyer") and {{sellerName}} ("Seller"). Seller will sell, and Buyer will buy, {{goodsCategory}} (the "Goods") under purchase orders Buyer issues under this Agreement.</p>` },
      { title: 'Purchase Orders',   sortOrder: 20, content: `<p>Each purchase order will specify the quantity, specifications, price, delivery date, and delivery location. This Agreement governs over any pre-printed terms on a purchase order or order acknowledgment. Seller's failure to object to a PO within 5 business days is deemed acceptance.</p>` },
      { title: 'Pricing and Payment', sortOrder: 30, content: `<p>Prices are set forth in the price schedule (Exhibit A) and are in {{currency}}. Net 60 payment terms. Seller may adjust prices on 60 days' notice for material raw-material cost changes (≥ 10%) with documentation; Buyer may cancel affected orders without penalty in lieu.</p>` },
      { title: 'Delivery',          sortOrder: 40, content: `<p>Default delivery term: {{incoterm}}. Time is of the essence. Seller is liable for actual, documented additional costs incurred by Buyer due to late delivery, up to the price of the delayed Goods.</p>` },
      { title: 'Inspection and Acceptance', sortOrder: 50, content: `<p>Buyer may inspect Goods within 30 days of delivery and reject non-conforming Goods. Seller will, at Buyer's option, repair, replace, or refund. Goods not rejected within 30 days are accepted.</p>` },
      { title: 'Warranty',          sortOrder: 60, content: `<p>12-month limited warranty against defects in material and workmanship, with conformance to specifications. Sole remedy is repair, replacement, or refund. ALL OTHER WARRANTIES DISCLAIMED.</p>` },
      { title: 'Recall',            sortOrder: 70, content: `<p>The parties will cooperate on recalls. Seller bears the cost of recalls attributable to defects.</p>` },
      { title: 'IP and Tooling',    sortOrder: 80, content: `<p>Buyer owns custom tooling it pays for. Seller retains its proprietary manufacturing processes and IP.</p>` },
      { title: 'Indemnification',   sortOrder: 90, content: `<p>Seller will indemnify Buyer against product liability and IP infringement claims regarding the Goods. Buyer will indemnify Seller against claims arising from Buyer's specifications or unauthorized modifications.</p>` },
      { title: 'Limitation of Liability', sortOrder: 100, content: `<p>Seller's aggregate liability is capped at the greater of 12 months' purchases under this Agreement or $1,000,000. No consequential damages. Standard carve-outs for IP indemnity, confidentiality, and gross negligence/willful misconduct.</p>` },
      { title: 'Term and Termination', sortOrder: 110, content: `<p>3-year initial term, renewing for 1-year terms unless either party gives 180 days' non-renewal notice. Termination for material breach with 30-day cure. Buyer may complete all in-flight POs at the time of termination.</p>` },
    ],
  },
]

export const MANUFACTURING_PLAYBOOK: SeedPlaybookPosition[] = [
  { key: 'mfg-warranty-12mo',         categorySlug: 'warranties',      positionType: 'preferred',  content: `<p>12-month warranty minimum on defects and conformance. Repair/replace/refund at Buyer's option.</p>`,                                                                  notes: 'Standard for industrial goods.',                                                            riskThreshold: 0.7, contractTypes: ['Supply'], sortOrder: 5 },
  { key: 'mfg-incoterm-fca-accept',   categorySlug: 'scope-services',  positionType: 'acceptable', content: `<p>FCA Seller facility (Incoterms 2020) default. Buyer to arrange carriage.</p>`,                                                                                          notes: 'Cost-efficient for high-volume.',                                                           riskThreshold: 0.5, contractTypes: ['Supply'], sortOrder: 5 },
  { key: 'mfg-recall-cooperation',    categorySlug: 'warranties',      positionType: 'preferred',  content: `<p>Mutual recall cooperation. Seller bears costs for defect-attributable recalls. Strict notification obligations.</p>`,                                                  notes: 'Critical for safety-sensitive goods.',                                                      riskThreshold: 0.8, contractTypes: ['Supply'], sortOrder: 5 },
  { key: 'mfg-tooling-buyer-owned',   categorySlug: 'ip-ownership',    positionType: 'preferred',  content: `<p>Buyer owns custom tooling it pays for. Seller maintains, exclusive use for Buyer, return on termination.</p>`,                                                          notes: 'Avoid lock-in.',                                                                            riskThreshold: 0.7, contractTypes: ['Supply'], sortOrder: 5 },
  { key: 'mfg-price-adjust-cap',      categorySlug: 'fees-payment',    positionType: 'acceptable', content: `<p>Price adjustments allowed only for ≥10% raw-material cost moves with documentation, 60-day notice, and Buyer's right to cancel in lieu.</p>`,                            notes: 'Common compromise.',                                                                        riskThreshold: 0.5, contractTypes: ['Supply'], sortOrder: 5 },
  { key: 'mfg-no-recall-cooperation', categorySlug: 'warranties',      positionType: 'walkaway',   content: `<p>Seller refuses recall cooperation or any cost-sharing for defect-attributable recalls.</p>`,                                                                              notes: 'Reject for any consumer-facing product.',                                                   riskThreshold: 0.2, contractTypes: ['Supply'], sortOrder: 30 },
]
