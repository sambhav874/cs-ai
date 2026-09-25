"""What a key-term extraction asks for: the clause taxonomy, how to classify a
contract, and the extra fields each contract type carries.

Moved here from draftLegal's review agent (agents_service/agents/review_agent.py,
AGPL-3.0) when ContractSense's key-term extractor replaced it.
TODO(licence): the text below is draftLegal's; keep the attribution.

Data only. `services/key_terms.py` is the extractor that uses it.
"""
from __future__ import annotations

CONTRACT_TYPES = frozenset({
    "NDA", "MSA", "SOW", "SLA", "VENDOR_AGREEMENT", "EMPLOYMENT", "PARTNERSHIP",
    "LICENSE", "DATA_PROCESSING", "ORDER_FORM", "OTHER",
})

CLAUSE_TYPE_GUIDE = """Clause types (use the most specific type that applies):
  limitation_of_liability   — caps on total liability
  uncapped_liability        — provisions that exclude or override liability caps
  indemnification           — obligations to defend/compensate the other party
  liquidated_damages        — pre-agreed compensation amounts for specific breaches
  payment                   — payment obligations, amounts, timing, invoicing
  price_adjustment          — price escalation, CPI indexing, benchmarking, renegotiation rights
  minimum_commitment        — minimum purchase, revenue, or activity obligations
  volume_restriction        — caps on usage, quantity, or throughput
  ip_ownership              — ownership of intellectual property created under the contract
  ip_license_back           — license back to the licensor of improvements or derivatives
  license_grant             — scope of license granted (exclusive/non-exclusive, territory, field)
  joint_ip                  — jointly developed IP ownership and exploitation rights
  source_code_escrow        — escrow arrangements for source code access
  termination               — rights to terminate the contract and consequences
  post_termination_services — transition assistance, data return, wind-down obligations after termination
  confidentiality           — confidentiality and non-disclosure obligations
  confidential_info_definition — what information is and is not considered confidential
  non_compete               — restrictions on competing with the other party
  non_solicitation          — restrictions on soliciting employees or customers
  non_disparagement         — restrictions on making negative public statements
  covenant_not_to_sue       — agreement not to bring legal claims
  governing_law             — choice of governing law and jurisdiction
  dispute_resolution        — arbitration, mediation, or litigation procedures
  notice                    — how formal notices must be given (method, address, timing)
  auto_renewal              — automatic renewal provisions and opt-out requirements
  renewal_term              — renewal terms, conditions, and pricing
  exclusivity               — exclusive dealing or supply obligations
  warranty                  — representations and warranties about capabilities or condition
  warranty_duration         — explicit warranty period and post-warranty support terms
  representations_warranties — general reps and warranties about status, authority, compliance
  force_majeure             — relief from obligations due to unforeseeable events
  assignment                — restrictions on assigning the contract to a third party
  change_of_control         — rights triggered by ownership change of a party
  mfn                       — most favoured nation pricing or terms commitments
  audit_rights              — rights to audit records, compliance, or royalties
  rofr                      — right of first refusal, first offer, or first negotiation
  insurance                 — required insurance coverages and minimums
  acceptance                — acceptance criteria and procedures for deliverables
  data_protection           — data privacy, processing, and security obligations
  third_party_beneficiary   — rights granted to third parties not party to the contract
  general                   — important provisions not covered by any specific type above

Risk rating guidance:
  favorable   — benefits the uploading party: high liability caps, narrow indemnity, strong IP retention, long cure periods, easy termination rights
  unfavorable — burdens the uploading party: uncapped liability, broad indemnity, one-sided IP assignment, auto-renewal with short opt-out, short cure periods
  neutral     — standard boilerplate with balanced obligations
  unusual     — non-standard, unexpected, or bespoke clause for this contract type
"""

CONTRACT_TYPE_GUIDE = """─── How to classify contractType ────────────────────────────────────────
Pick the MOST SPECIFIC type that fits. "OTHER" is a last resort — only use
it when none of the specific types apply. Look at the contract's PURPOSE,
not just its title. Use this decision tree:

NDA              — Purpose is SOLELY confidentiality obligations between parties
                   before/around a potential deal. No commercial exchange or
                   service delivery. Typical fields: term, mutual/unilateral,
                   permitted use, liquidated damages.

MSA              — A FRAMEWORK agreement. Governs multiple future engagements
                   (SOWs/Orders). Has general T&Cs (IP, liability, confidentiality,
                   termination, insurance) but no specific deliverables or
                   project scope. Title often includes "Master" / "Framework" /
                   "Master Services Agreement". Prefer MSA over OTHER when the
                   body clearly talks about "SOWs", "change orders", "future
                   engagements", or sets up rules for multiple projects.

SOW              — Tied to a SPECIFIC project with milestones, deliverables,
                   and a fixed fee or T&M cap. Often references a parent MSA.
                   Has dates, phases, named team. Treat multi-milestone
                   consulting engagements as SOW even when labelled
                   "Consulting Agreement" if milestones + deliverables exist.

SLA              — Service levels: uptime % + response/resolution times +
                   service credits. Usually attached to an MSA or Order Form.

VENDOR_AGREEMENT — Ongoing vendor-provided services with a subscription /
                   monthly fee and no specific project (cloud hosting, managed
                   services, data feeds). Different from MSA in that it's
                   SINGLE-SCOPE — there's one thing being delivered
                   repeatedly, not a framework for future projects.

EMPLOYMENT       — Individual PERSON as one party; includes base salary,
                   benefits, role description, at-will/termination terms.

PARTNERSHIP      — Two organizations jointly pursuing a venture: revenue share,
                   joint product development, co-marketing, exclusivity.
                   Prefer PARTNERSHIP over OTHER when there's an explicit
                   "Partners" relationship + mutual contributions.

LICENSE          — Grants usage rights to software, content, or IP in
                   exchange for fees. Has usage restrictions, reverse-
                   engineering prohibition, license scope (users / seats).

DATA_PROCESSING  — A DPA supplementing another agreement. Governs Controller/
                   Processor handling of personal data (GDPR/CCPA). References
                   SCCs, breach notification, sub-processors.

ORDER_FORM       — A specific subscription purchase under a master. Has seat
                   counts, term, total contract value, start/end dates. Often
                   references a governing MSA/MSSA.

OTHER            — Only when NO specific type fits. Examples: amendments (rare
                   — classify under the underlying agreement if clear),
                   settlement agreements, letters of intent, term sheets.

─── Risk factors ────────────────────────────────────────────────────────
Risk factors to consider: unlimited liability, no liability cap, broad
indemnification, IP assignment to counterparty, auto-renewal with short
opt-out window, long notice period, no audit rights, restrictive assignment,
MFN obligations.
"""

# Extra fields per contract type, extracted when the type is known.
# Each entry: { key, label, type (text|number|boolean), hint }
TYPE_SCHEMAS: dict[str, list[dict]] = {

    "NDA": [
        {"key": "mutual",                  "label": "Mutual / Bilateral",                  "type": "boolean", "hint": "Is this a mutual (bilateral) NDA or one-way (unilateral)? Both parties bound = true."},
        {"key": "permitted_use",           "label": "Permitted Use",                       "type": "text",    "hint": "What specific purposes can the confidential information be used for?"},
        {"key": "carve_outs",              "label": "Confidentiality Carve-Outs",          "type": "text",    "hint": "What information is explicitly excluded from confidentiality obligations (public domain, independently developed, required by law, etc.)?"},
        {"key": "residual_clause",         "label": "Residual Knowledge Clause",           "type": "boolean", "hint": "Can the receiving party use knowledge retained in unaided memory (residuals) without restriction?"},
        {"key": "non_compete",             "label": "Non-Compete Restriction",             "type": "boolean", "hint": "Does the agreement include any non-competition obligations?"},
        {"key": "non_solicitation",        "label": "Non-Solicitation",                    "type": "boolean", "hint": "Does the agreement restrict soliciting or recruiting the other party's employees or customers?"},
        {"key": "return_of_information",   "label": "Return / Destruction of Information", "type": "boolean", "hint": "Must confidential information be returned or destroyed upon request or at contract termination?"},
        {"key": "injunctive_relief",       "label": "Injunctive Relief Available",         "type": "boolean", "hint": "Is equitable or injunctive relief explicitly available without bond or posting security?"},
        {"key": "standard_basis",          "label": "Agreement Basis / Standard Form",     "type": "text",    "hint": "Is this based on a recognised standard form (e.g. MNDA, BVCA, NVCA, or bespoke)?"},
    ],

    "MSA": [
        {"key": "sow_execution_process",   "label": "SOW Execution Process",              "type": "text",    "hint": "How are Statements of Work or project orders formally executed under this MSA?"},
        {"key": "change_order_process",    "label": "Change Order Process",               "type": "text",    "hint": "How are changes to agreed scope requested, approved, and priced?"},
        {"key": "warranty_period_days",    "label": "Warranty Period (Days)",             "type": "number",  "hint": "Length of warranty on delivered services, software, or deliverables in days."},
        {"key": "dispute_resolution",      "label": "Dispute Resolution Mechanism",       "type": "text",    "hint": "Is the primary dispute resolution mechanism arbitration, litigation, mediation, or expert determination?"},
        {"key": "acceptance_process",      "label": "Acceptance Process",                 "type": "text",    "hint": "How are deliverables formally accepted or rejected? Is there a deemed acceptance provision?"},
        {"key": "step_in_rights",          "label": "Step-In Rights",                     "type": "boolean", "hint": "Can the client take over service delivery themselves or appoint a third party if the vendor fails?"},
        {"key": "key_personnel",           "label": "Key Personnel Requirement",          "type": "text",    "hint": "Are specific named individuals required on the engagement? What approval is needed to replace them?"},
        {"key": "benchmarking_rights",     "label": "Benchmarking Rights",                "type": "boolean", "hint": "Can the client benchmark the vendor's pricing against comparable market rates?"},
        {"key": "source_code_escrow",      "label": "Source Code Escrow",                 "type": "boolean", "hint": "Is software source code placed in escrow with a third party for client access if vendor fails?"},
        {"key": "most_favored_nation",     "label": "Most Favoured Nation (MFN)",         "type": "boolean", "hint": "Does the vendor commit to pricing no worse than offered to any other client?"},
        {"key": "data_portability",        "label": "Data Portability on Exit",           "type": "text",    "hint": "How does the client extract and migrate their data at the end of the contract?"},
    ],

    "SOW": [
        {"key": "deliverables",            "label": "Deliverables",                       "type": "text",    "hint": "Specific work products, outputs, or artefacts to be delivered."},
        {"key": "milestones",              "label": "Milestones & Target Dates",          "type": "text",    "hint": "Key project milestones and their target completion dates."},
        {"key": "acceptance_criteria",     "label": "Acceptance Criteria",                "type": "text",    "hint": "Objective criteria used to determine whether deliverables meet requirements."},
        {"key": "payment_model",           "label": "Payment Model",                      "type": "text",    "hint": "Is payment fixed fee, milestone-based, time & materials, retainer, or capped T&M?"},
        {"key": "change_control",          "label": "Change Control Process",             "type": "text",    "hint": "How are scope changes formally requested, evaluated, and authorised?"},
        {"key": "project_manager",         "label": "Named Project Manager",              "type": "text",    "hint": "Named project manager or primary point of contact for delivery."},
        {"key": "work_location",           "label": "Work Location",                      "type": "text",    "hint": "Is work delivered on-site, remotely, or hybrid?"},
        {"key": "travel_expenses",         "label": "Travel Expenses Reimbursable",       "type": "boolean", "hint": "Are contractor travel and expenses reimbursable on top of fees?"},
        {"key": "assumptions",             "label": "Key Assumptions",                    "type": "text",    "hint": "Stated assumptions the SOW is predicated on — if wrong, scope or price may change."},
        {"key": "out_of_scope",            "label": "Out of Scope",                       "type": "text",    "hint": "Items explicitly excluded from this Statement of Work."},
        {"key": "governing_msa",           "label": "Governing MSA / Framework",         "type": "text",    "hint": "Reference to the master agreement or framework contract this SOW sits under."},
    ],

    "SLA": [
        {"key": "uptime_percentage",           "label": "Target Uptime (%)",                    "type": "number",  "hint": "Committed availability target as a percentage, e.g. 99.9 or 99.95."},
        {"key": "response_time_hours",         "label": "P1 Incident Response Time (Hours)",    "type": "number",  "hint": "Maximum time to acknowledge a critical / Priority 1 incident."},
        {"key": "resolution_time_hours",       "label": "P1 Incident Resolution Time (Hours)",  "type": "number",  "hint": "Maximum time to resolve / restore service after a critical incident."},
        {"key": "measurement_period",          "label": "Measurement Period",                   "type": "text",    "hint": "How SLA performance is measured and reported — monthly, quarterly, rolling 12 months?"},
        {"key": "maintenance_exclusions",      "label": "Planned Maintenance Exclusions",       "type": "text",    "hint": "Scheduled maintenance windows excluded from uptime calculations and SLA obligations."},
        {"key": "credit_formula",              "label": "Service Credit Formula",               "type": "text",    "hint": "How service credits are calculated for SLA breaches — percentage of monthly fees, sliding scale, etc."},
        {"key": "max_credit_percentage",       "label": "Maximum Credit Cap (%)",               "type": "number",  "hint": "Cap on total service credits payable as a percentage of monthly or annual fees."},
        {"key": "reporting_frequency",         "label": "SLA Reporting Frequency",              "type": "text",    "hint": "How often SLA performance data and reports are provided to the client."},
        {"key": "escalation_procedure",        "label": "Escalation Procedure",                 "type": "text",    "hint": "Escalation path and timelines for unresolved or repeated SLA failures."},
        {"key": "remediation_plan_required",   "label": "Remediation Plan Required",            "type": "boolean", "hint": "Must the vendor produce a remediation plan following repeated SLA failures?"},
        {"key": "termination_for_sla_failure", "label": "Termination Right for SLA Failure",    "type": "text",    "hint": "Under what SLA failure conditions (frequency, severity, credit cap) does the client have termination rights?"},
    ],

    "EMPLOYMENT": [
        {"key": "job_title",                      "label": "Job Title / Role",                    "type": "text",    "hint": "Official position title and reporting line."},
        {"key": "base_salary",                    "label": "Base Salary",                         "type": "number",  "hint": "Annual base compensation (numeric value only)."},
        {"key": "salary_currency",                "label": "Salary Currency",                     "type": "text",    "hint": "Currency of base salary, e.g. USD, GBP, EUR."},
        {"key": "employment_type",                "label": "Employment Type",                     "type": "text",    "hint": "Full-time, part-time, fixed-term contract, or zero-hours?"},
        {"key": "at_will",                        "label": "At-Will Employment",                  "type": "boolean", "hint": "Can either party terminate employment without cause and without notice beyond the minimum legal requirement?"},
        {"key": "probation_period_days",          "label": "Probation Period (Days)",             "type": "number",  "hint": "Length of the initial probationary period in days."},
        {"key": "bonus_structure",                "label": "Bonus / Commission Structure",        "type": "text",    "hint": "Target bonus percentage, commission plan, or performance-related pay structure."},
        {"key": "equity_grant",                   "label": "Equity / Stock Option Grant",        "type": "text",    "hint": "Share options, RSUs, phantom equity, or equity percentage offered."},
        {"key": "vesting_schedule",               "label": "Vesting Schedule",                    "type": "text",    "hint": "Equity vesting cliff and schedule, e.g. 4-year vest with 1-year cliff."},
        {"key": "non_compete_duration_months",    "label": "Non-Compete Duration (Months)",       "type": "number",  "hint": "Post-termination period during which the employee is restricted from competing."},
        {"key": "non_solicitation_duration_months","label": "Non-Solicitation Duration (Months)", "type": "number",  "hint": "Post-termination period restricting solicitation of employees or customers."},
        {"key": "severance_months",               "label": "Severance Pay (Months of Salary)",   "type": "number",  "hint": "Months of base salary payable on termination without cause."},
        {"key": "garden_leave",                   "label": "Garden Leave",                        "type": "boolean", "hint": "Is the employee placed on paid garden leave during their notice period?"},
        {"key": "ip_assignment",                  "label": "IP Assignment to Employer",           "type": "boolean", "hint": "Does the employee assign all work-related intellectual property to the employer?"},
        {"key": "remote_work_permitted",          "label": "Remote / Hybrid Work Permitted",      "type": "boolean", "hint": "Is the employee authorised to work remotely or on a hybrid basis?"},
        {"key": "relocation_required",            "label": "Relocation Required",                 "type": "boolean", "hint": "Is the employee required to relocate as a condition of employment?"},
    ],

    "VENDOR_AGREEMENT": [
        {"key": "payment_method",              "label": "Payment Method",                     "type": "text",    "hint": "How the vendor is paid — wire transfer, ACH, SWIFT, check, or platform payment."},
        {"key": "delivery_terms",              "label": "Delivery Terms (Incoterms)",         "type": "text",    "hint": "Incoterms or specific delivery conditions — FOB, DDP, CIF, DAP, Ex Works, etc."},
        {"key": "warranty_duration_days",      "label": "Warranty Duration (Days)",           "type": "number",  "hint": "Length of product or service warranty in days."},
        {"key": "return_policy",               "label": "Return & Refund Policy",             "type": "text",    "hint": "Conditions and process for returns, replacements, or refunds."},
        {"key": "quality_standards",           "label": "Quality Standards & Certifications", "type": "text",    "hint": "Required quality certifications (ISO 9001, SOC 2, etc.) or standards the vendor must meet."},
        {"key": "vendor_insurance_required",   "label": "Vendor Insurance Required",          "type": "boolean", "hint": "Is the vendor required to maintain specific insurance coverages?"},
        {"key": "minimum_insurance_coverage",  "label": "Minimum Insurance Coverage",         "type": "text",    "hint": "Required insurance types and minimum coverage amounts (e.g. $5M general liability, $2M E&O)."},
        {"key": "subcontracting_permitted",    "label": "Subcontracting Permitted",           "type": "boolean", "hint": "Can the vendor subcontract any part of the work to third parties?"},
        {"key": "background_check_required",   "label": "Background Checks Required",         "type": "boolean", "hint": "Must vendor personnel undergo background or security screening?"},
        {"key": "volume_discount",             "label": "Volume Discount Tiers",              "type": "text",    "hint": "Volume-based pricing tiers or discount schedule."},
        {"key": "minimum_purchase_commitment", "label": "Minimum Purchase Commitment",        "type": "number",  "hint": "Minimum annual or total contractual purchase obligation."},
        {"key": "price_adjustment_mechanism",  "label": "Price Adjustment Mechanism",         "type": "text",    "hint": "How and when prices can be adjusted — CPI indexation, annual review, benchmarking."},
        {"key": "preferred_supplier_status",   "label": "Preferred / Sole Supplier Status",   "type": "boolean", "hint": "Is this a preferred, approved, or sole-source supplier arrangement?"},
    ],

    "PARTNERSHIP": [
        {"key": "partnership_type",         "label": "Partnership Type",                    "type": "text",    "hint": "Joint venture, strategic alliance, reseller, referral, co-development, or distribution?"},
        {"key": "revenue_split",            "label": "Revenue / Profit Split",             "type": "text",    "hint": "How revenue, gross profit, or net profit is divided between the parties."},
        {"key": "capital_contributions",    "label": "Capital Contributions",              "type": "text",    "hint": "What each party contributes — cash, IP, technology, sales channels, customers, resources."},
        {"key": "decision_making",          "label": "Decision-Making Authority",          "type": "text",    "hint": "Unanimous consent, majority vote, designated lead party, or steering committee?"},
        {"key": "territory",                "label": "Territory / Market Scope",           "type": "text",    "hint": "Geographic regions or market segments covered by this partnership."},
        {"key": "exclusivity",              "label": "Exclusivity",                        "type": "boolean", "hint": "Is either party restricted from working with competitors or entering similar arrangements?"},
        {"key": "branding_rights",          "label": "Co-Branding Rights",                "type": "text",    "hint": "Rights and restrictions on using each other's logos, trademarks, and brand identity."},
        {"key": "jointly_developed_ip",     "label": "Jointly Developed IP Ownership",    "type": "text",    "hint": "Who owns intellectual property created in the course of the partnership?"},
        {"key": "exit_mechanism",           "label": "Exit Mechanism",                     "type": "text",    "hint": "How a party can exit the partnership, buy out the other, or dissolve the arrangement."},
        {"key": "non_compete",              "label": "Non-Compete Between Partners",       "type": "boolean", "hint": "Are partners restricted from competing with each other during or after the partnership?"},
        {"key": "governance_structure",     "label": "Governance Structure",               "type": "text",    "hint": "Steering committee, joint board, or other governance body — membership and voting rules."},
        {"key": "minimum_commitment",       "label": "Minimum Activity Commitment",        "type": "text",    "hint": "Minimum sales targets, referral volumes, marketing spend, or other performance commitments."},
    ],

    "LICENSE": [
        {"key": "license_type",          "label": "License Type",                      "type": "text",    "hint": "Exclusive, non-exclusive, sole, or co-exclusive?"},
        {"key": "license_duration",      "label": "License Duration",                  "type": "text",    "hint": "Perpetual, fixed-term, or subscription-based? Include renewal terms if any."},
        {"key": "territory",             "label": "Licensed Territory",                "type": "text",    "hint": "Geographic scope — worldwide, specific countries, or regions."},
        {"key": "permitted_uses",        "label": "Permitted Uses",                    "type": "text",    "hint": "What the licensee is specifically authorised to do with the licensed IP."},
        {"key": "field_of_use",          "label": "Field of Use Restriction",          "type": "text",    "hint": "Industry, application domain, or sector the license is restricted to."},
        {"key": "sublicensing_allowed",  "label": "Sublicensing Permitted",            "type": "boolean", "hint": "Can the licensee grant sublicenses to third parties?"},
        {"key": "royalty_structure",     "label": "Royalty Structure",                 "type": "text",    "hint": "Royalty rate, basis (% of revenue, per unit, per use, flat fee), and payment frequency."},
        {"key": "minimum_royalty",       "label": "Minimum Annual Royalty",            "type": "number",  "hint": "Minimum royalty payment per year regardless of actual usage or revenue."},
        {"key": "source_code_included",  "label": "Source Code Access",               "type": "boolean", "hint": "Does the license include access to source code?"},
        {"key": "modification_rights",   "label": "Modification / Derivative Works",  "type": "boolean", "hint": "Can the licensee modify the IP or create derivative works?"},
        {"key": "audit_rights",          "label": "Royalty Audit Rights",              "type": "boolean", "hint": "Can the licensor audit the licensee's records to verify royalty calculations?"},
        {"key": "reversion_rights",      "label": "Reversion of Rights",              "type": "text",    "hint": "Under what conditions (e.g. non-use, breach, insolvency) do rights revert to the licensor?"},
        {"key": "improvements_ownership","label": "Improvements Ownership",            "type": "text",    "hint": "Who owns improvements or enhancements made to the licensed technology?"},
    ],

    "DATA_PROCESSING": [
        {"key": "data_controller",             "label": "Data Controller",                        "type": "text",    "hint": "Name and role of the entity acting as data controller."},
        {"key": "data_processor",              "label": "Data Processor",                         "type": "text",    "hint": "Name and role of the entity acting as data processor."},
        {"key": "processing_purposes",         "label": "Processing Purposes & Legal Basis",      "type": "text",    "hint": "Specific lawful purposes for which personal data is processed and the legal basis (consent, contract, legitimate interest, etc.)."},
        {"key": "personal_data_categories",    "label": "Categories of Personal Data",            "type": "text",    "hint": "Types of personal data being processed — names, emails, financial, health, biometric, etc."},
        {"key": "data_subjects",               "label": "Data Subjects",                          "type": "text",    "hint": "Categories of individuals whose data is processed — employees, customers, prospects, etc."},
        {"key": "retention_period",            "label": "Data Retention Period",                  "type": "text",    "hint": "How long personal data is retained and the deletion or anonymisation process at end of retention."},
        {"key": "sub_processors_permitted",    "label": "Sub-Processors Permitted",               "type": "boolean", "hint": "Can the processor engage sub-processors? Is prior written consent required from the controller?"},
        {"key": "transfer_mechanism",          "label": "International Transfer Mechanism",       "type": "text",    "hint": "Mechanism for cross-border data transfers — SCCs, adequacy decision, BCRs, derogations."},
        {"key": "security_measures",           "label": "Required Security Measures",             "type": "text",    "hint": "Specific technical and organisational security measures the processor must implement."},
        {"key": "breach_notification_hours",   "label": "Breach Notification Deadline (Hours)",   "type": "number",  "hint": "Maximum hours within which the processor must notify the controller of a personal data breach."},
        {"key": "dpia_required",               "label": "DPIA Required",                          "type": "boolean", "hint": "Is a Data Protection Impact Assessment required before or during processing?"},
        {"key": "applicable_regulation",       "label": "Applicable Privacy Regulation",          "type": "text",    "hint": "Primary privacy regulation governing this agreement — GDPR, CCPA, LGPD, PIPEDA, etc."},
        {"key": "deletion_on_termination",     "label": "Data Deletion on Termination",           "type": "text",    "hint": "How and within what timeframe personal data is deleted or returned to the controller at contract end."},
    ],

    "ORDER_FORM": [
        {"key": "order_number",          "label": "Order / PO Reference Number",   "type": "text",   "hint": "Purchase order or sales order reference number."},
        {"key": "products_or_services",  "label": "Products / Services Ordered",   "type": "text",   "hint": "Specific items, SKUs, or services being procured."},
        {"key": "quantity",              "label": "Quantity / Licences",            "type": "number", "hint": "Number of units, seats, or licences ordered."},
        {"key": "unit_price",            "label": "Unit / Seat Price",              "type": "number", "hint": "Price per unit, seat, or licence."},
        {"key": "total_order_value",     "label": "Total Order Value",              "type": "number", "hint": "Aggregate value of this order before tax."},
        {"key": "delivery_date",         "label": "Expected Delivery Date",         "type": "text",   "hint": "When products should be delivered or services go live."},
        {"key": "payment_due_date",      "label": "Payment Due Date",               "type": "text",   "hint": "Date by which payment must be received."},
        {"key": "shipping_method",       "label": "Shipping / Delivery Method",     "type": "text",   "hint": "How goods are transported — courier, freight, digital download, or provisioned access."},
        {"key": "billing_contact",       "label": "Billing / AP Contact",           "type": "text",   "hint": "Accounts payable contact name or email for invoicing."},
        {"key": "discount_applied",      "label": "Discounts Applied",              "type": "text",   "hint": "Any negotiated discounts, promotional codes, or credits reflected in pricing."},
        {"key": "governing_agreement",   "label": "Governing Agreement / Terms",    "type": "text",   "hint": "Master agreement, framework, or standard terms this order is subject to."},
    ],
}
