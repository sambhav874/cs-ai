# Test Personas — 5 Realistic CLM Buyer Profiles

**Purpose:** five fully-specified orgs (people, contracts, counterparties, JTBDs, workflows) used to seed test data in phase 3 and stress-test the agent in phase 4.
**Date:** 2026-04-26
**Source:** synthesized from `competitor-cases.md` (5 vendor case-study deep-dives, 50+ named customers, 800+ data points).

---

## Cross-persona summary

| # | Org | Domain | Industry | Employees | Revenue | Legal team | Contracts seeded | Doc bias |
|---|---|---|---|---|---|---|---|---|
| 1 | **Vertex Cloud** | vertex.cloud | B2B SaaS (observability) | 800 | ~$80M ARR | 4 | 150 | NDA + MSA + DPA, sales-led |
| 2 | **Caldera Health** | calderahealth.com | Health SaaS (clinical ops) | 600 | ~$60M ARR | 3 | 120 | BAA + DPA + MSA, compliance-heavy |
| 3 | **Ironbridge Industrial** | ironbridge-ind.com | Industrial mfg (PE-backed) | 5,000 | ~$1.2B | 6 | 250 | Supplier + MSA + SOW, procurement-heavy |
| 4 | **Lumen Bio** | lumenbio.com | Biotech (pre-clinical, Series A) | 80 | $35M raised | 2 | 80 | Research + IP + MTA, science-heavy |
| 5 | **Beacon Logistics** | beaconlogistics.com | 3PL (mid-market) | 1,200 | ~$280M | 4 | 200 | Customer SLA + carrier, ops-heavy |
| **Total** | | | | | | **19 users** | **800 contracts** | |

**Coverage check (vs. phase 1 findings):**
- ✓ Sales-led (Ironclad/SpotDraft sweet spot): Vertex
- ✓ Procurement-led (Icertis): Ironbridge
- ✓ Solo/small legal (LinkSquares solo-GC, SpotDraft scale-up): Lumen
- ✓ Regulated AI-extraction (Evisort/Workday): Caldera
- ✓ Operations mid-market (Ironclad ops, LinkSquares industrial): Beacon
- ✓ Non-GC primary users: Sara (Vertex Sales Ops), Tom (Caldera Procurement), Olivia + Raj (Ironbridge Procurement), Chris/Hannah (Beacon Contracts Mgrs), Hideo (Lumen CSO occasional)
- ✓ Doc-type spread: NDA, MSA, SOW, DPA, BAA, supplier, vendor, employment, IP, MTA, license, customer SLA, carrier, lease, M&A — 15 types covered

---

## Persona 1 — Vertex Cloud

### Overview
**Industry:** B2B SaaS, observability + data infrastructure (Datadog/Honeycomb-shaped)
**Size:** 800 employees, ~$80M ARR, Series C ($120M raised total)
**Stage:** Mid-stage growth, ~70% sales-led + 30% PLG, customers split between mid-market SaaS and enterprise data teams
**Domain:** `vertex.cloud`

### Users (4)
| Name | Role | Email |
|---|---|---|
| Maya Chen | General Counsel | `maya.chen@vertex.cloud` |
| Priya Patel | Senior Counsel, Commercial | `priya.patel@vertex.cloud` |
| David Kim | Legal Operations Manager | `david.kim@vertex.cloud` |
| Sara Nguyen | Sales Ops Director (non-legal user) | `sara.nguyen@vertex.cloud` |

### Document mix (target: 150 contracts)
| Type | % | Count |
|---|---|---|
| NDA (mutual + sales) | 40% | 60 |
| MSA (customer master) | 20% | 30 |
| SOW / Order Form | 15% | 22 |
| DPA (customer + sub-processor) | 10% | 15 |
| Vendor agreement | 10% | 15 |
| Misc (partner, reseller, employment) | 5% | 8 |

**Status distribution:** 60% signed, 20% in-review, 10% draft, 10% expired
**Owner skew:** Maya 25% / Priya 35% (heaviest commercial) / David 30% / Sara 10%

### Counterparties (~80 distinct)
**Customers (large SaaS):** Snowflake, Stripe, Brex, Notion, Loom, Asana, Linear, Vercel, Plaid, Ramp, Mercury, Retool, Airtable, ClickUp, Monday, Lattice, Rippling, Front, Pitch, Sourcegraph
**Customers (mid-market):** First Republic Tech, Mercury Bank, scale-up SaaS B-list
**Vendors:** AWS, Google Cloud, Salesforce, HubSpot, Segment, Twilio, SendGrid, Stripe (vendor-side), Slack, Zoom, Okta, Datadog (yes, they're a customer of one), Snowflake (vendor-side), 1Password
**Partners:** Deloitte Digital, Accenture, Slalom (system integrators)

### Top 10 JTBDs (verbatim agent prompts to test)
1. *"Show me NDAs expiring in next 30 days that I should renew."*
2. *"What's our exposure with Snowflake across all contracts?"*
3. *"Find the most-recent MSA template — I need to draft for Ramp."*
4. *"Are there any DPAs without a sub-processor list?"*
5. *"What's stuck in my approval queue and why?"*
6. *"Sara wants to send an NDA to Plaid — does our sales playbook allow it?"*
7. *"Show all contracts with auto-renew clauses expiring in Q3."*
8. *"Compare our current Stripe order form to last year's."*
9. *"Find any contract where we agreed to indemnification > $5M."*
10. *"Which vendor contracts use sub-processors that aren't on our DPA list?"*

### Workflow seeds
**Templates:** Mutual NDA, Sales MSA, Order Form, DPA, Vendor MSA
**Playbooks:** "Sales MSA must-haves" (liability cap 12 months ARR, governing law DE, term 1yr auto-renew)
**Approval policy:**
- NDA: auto-approve if value=0 + no special terms
- Order Form: Priya only
- MSA: Priya + Maya if value <$500k; +CEO if ≥$500k
- DPA: Priya + Maya
**Matters:** "Q1 Enterprise Renewals", "Stripe Account Expansion", "Plaid Partnership"

### Product features they'd actively use
- **Repository / search** ✓ (heavy)
- **Templates + Drafting** ✓ (Sara generates from templates)
- **Approvals** ✓ (Priya queues, Maya escalations)
- **Counterparty pages** ✓ (Snowflake/Stripe exposure roll-up)
- **Agent** ✓ (Priya's daily standup tool)
- **Matters** ✓ (M&A and renewal cohorts)
- **Risks / OCR** ✓ (DPA sub-processor extraction)

---

## Persona 2 — Caldera Health

### Overview
**Industry:** Mid-market health SaaS — clinical ops + interoperability platform for hospitals, pharma, and payers
**Size:** 600 employees, ~$60M ARR, Series B+
**Stage:** Pre-IPO mid-market; HIPAA Business Associate; ISO 27001 + SOC 2; expanding into payer & life-sciences segments
**Domain:** `calderahealth.com`

### Users (4)
| Name | Role | Email |
|---|---|---|
| Dr. Lena Park | General Counsel | `lena.park@calderahealth.com` |
| Marcus Hall | Privacy Officer / DPO (non-attorney) | `marcus.hall@calderahealth.com` |
| Aisha Yusuf | Compliance Counsel | `aisha.yusuf@calderahealth.com` |
| Tom Reilly | Procurement Lead (non-legal) | `tom.reilly@calderahealth.com` |

### Document mix (target: 120 contracts)
| Type | % | Count |
|---|---|---|
| BAA | 30% | 36 |
| DPA (customer + sub-processor) | 25% | 30 |
| MSA (customer) | 20% | 24 |
| Vendor agreement | 10% | 12 |
| NDA (pre-deal) | 10% | 12 |
| Misc (pilot, research) | 5% | 6 |

**Status distribution:** 65% signed, 20% in-review, 10% draft, 5% expired
**Owner skew:** Lena 35% / Marcus 25% (privacy) / Aisha 30% / Tom 10%

### Counterparties (~70 distinct)
**Hospital systems (customers):** Mayo Clinic, Cleveland Clinic, Kaiser Permanente, Ascension, HCA Healthcare, NewYork-Presbyterian, Mass General Brigham, Northwell Health, Sutter Health, Geisinger, Intermountain, Banner Health
**Pharma (customers + pilots):** Pfizer, Moderna, Genentech, Lilly, AbbVie, Bristol Myers Squibb, Merck, Sanofi, Novartis
**Payers:** Anthem, Aetna, Cigna, UnitedHealthcare, Humana, Centene, Molina
**Vendors / sub-processors:** AWS (HIPAA workloads), Snowflake, Datavant, Komodo Health, Iron Mountain, Twilio, Okta, Slack, Zoom, Stripe (billing)

### Top 10 JTBDs
1. *"Are all BAAs current with the latest HIPAA Security Rule update?"*
2. *"Show me sub-processors not listed in our DPA addendum."*
3. *"Which contracts are missing a 30-day breach notification clause?"*
4. *"What's expiring in Q3 — and what's the renewal playbook for each?"*
5. *"Find the most-recent BAA we signed with Ascension."*
6. *"Has Cigna's DPA been signed by their CISO?"*
7. *"What approvals are stuck waiting on Marcus (privacy)?"*
8. *"Compare our Mayo Clinic MSA terms vs Cleveland Clinic."*
9. *"Tom wants to onboard Datavant as a sub-processor — what's the path?"*
10. *"Show all contracts mentioning de-identification + research use."*

### Workflow seeds
**Templates:** BAA (HIPAA-compliant), DPA, MSA, Vendor agreement, NDA, Pilot agreement
**Playbooks:** "BAA must-haves checklist", "DPA sub-processor disclosure flow", "Pharma pilot conversion path"
**Approval policy:**
- BAA: Marcus (privacy) + Lena (GC)
- DPA: Marcus + Aisha
- MSA: Lena + finance (any value)
- Vendor: Tom + Marcus (if data-sharing)
**Matters:** "Ascension Multi-Site Rollout", "Pfizer Real-World Evidence Pilot", "Q2 Privacy Compliance Review"

### Product features they'd actively use
- **Repository / search** ✓ (heavy — find clauses across BAAs)
- **Risks / OCR** ✓ (HIPAA clause extraction)
- **Approvals** ✓ (Marcus's privacy queue + Lena's GC queue)
- **Counterparty pages** ✓ (hospital system roll-up — clinical sites under one parent)
- **Agent** ✓ (Marcus's daily privacy review tool)
- **Templates** ✓ (BAA + DPA standard templates)
- **Matters** ✓ (compliance review cohorts, pilot programs)
- **Playbook** ✓ (BAA must-haves auto-check)

---

## Persona 3 — Ironbridge Industrial

### Overview
**Industry:** Industrial manufacturer (PE platform) — HVAC components + steel fabrication, with 6 acquired brands across US Midwest
**Size:** 5,000 employees, ~$1.2B revenue, owned by mid-cap PE firm (~$3B AUM)
**Stage:** PE-backed roll-up, 3 years into hold period, currently in M&A mode (1 deal pending)
**Domain:** `ironbridge-ind.com`

### Users (5)
| Name | Role | Email |
|---|---|---|
| Margaret O'Brien | General Counsel & VP Legal | `margaret.obrien@ironbridge-ind.com` |
| Raj Sharma | Director of Procurement | `raj.sharma@ironbridge-ind.com` |
| Carla Mendez | Senior Contracts Manager (procurement) | `carla.mendez@ironbridge-ind.com` |
| James Wright | M&A Counsel | `james.wright@ironbridge-ind.com` |
| Olivia Brennan | Plant Procurement Specialist (Akron) | `olivia.brennan@ironbridge-ind.com` |

### Document mix (target: 250 contracts — highest volume)
| Type | % | Count |
|---|---|---|
| Supplier / Vendor agreement | 35% | 87 |
| MSA (customer + supplier master) | 20% | 50 |
| SOW (project-based) | 15% | 37 |
| Distribution / Reseller agreement | 10% | 25 |
| NDA (vendor + acquisition) | 10% | 25 |
| M&A documents (LOI, APA) | 5% | 12 |
| Misc (lease, equipment, exec employment) | 5% | 14 |

**Status distribution:** 70% signed, 15% in-review, 5% draft, 10% expired (most-realistic for active mfr)
**Owner skew:** Margaret 15% / Raj 20% / Carla 35% / James 10% / Olivia 20% (highest plant-level volume)

### Counterparties (~150 distinct — highest count)
**Suppliers (raw materials + components):** ArcelorMittal, Nucor, US Steel, Steel Dynamics, Honeywell, Emerson Electric, Schneider Electric, Parker Hannifin, GE Industrial, Eaton, ABB, Rockwell Automation, Festo, Siemens Industrial
**Customers (large construction):** Bechtel, Turner Construction, Skanska, AECOM, Fluor, Kiewit, Whiting-Turner, Suffolk, McCarthy, Mortenson
**Distributors:** W.W. Grainger, Fastenal, MSC Industrial, McMaster-Carr, Motion Industries
**Vendors (corporate):** SAP, Oracle, Workday, Coupa, ServiceNow, Microsoft, ADP
**Logistics:** XPO Logistics, Schneider National, J.B. Hunt, FedEx Freight, Old Dominion Freight Line, YRC
**Real estate:** Prologis, Duke Realty (warehouse/plant landlords)
**Acquisition targets (NDA stage):** "Acme Industrial" (codename), "Project Beacon" target

### Top 10 JTBDs
1. *"What's our total supplier exposure with ArcelorMittal across all plants?"*
2. *"Find all contracts at the Akron plant signed by Olivia in the last 90 days."*
3. *"Which suppliers have force-majeure clauses that exclude tariffs?"*
4. *"Show me all contracts due for renewal in next 60 days at the Detroit facility."*
5. *"Are there any open POs without a signed master supplier agreement?"*
6. *"What's the status of the Acme Industrial acquisition NDAs and LOI?"*
7. *"Compare our top 3 supplier MSAs side-by-side on price escalation terms."*
8. *"Find SOWs where the project value exceeds $250k — those need exec approval."*
9. *"Olivia's queue — what's stuck and why?"*
10. *"Show me concentration risk: which suppliers >$5M total spend?"*

### Workflow seeds
**Templates:** Supplier MSA (large + small format), SOW, NDA (vendor + M&A), Distributor Agreement, LOI
**Playbooks:** "Supplier risk triage" (red/yellow/green by spend tier), "M&A NDA + LOI flow", "Tariff pass-through clauses"
**Approval policy:**
- Supplier <$50k: Carla
- Supplier $50k–$250k: Carla + Margaret
- Supplier >$250k: Margaret + CFO + division head
- M&A: James + Margaret + CEO + Board
**Matters:** "Akron Plant Annual Renewals", "Project Beacon Acquisition", "2026 Steel Tariff Response", "Detroit Plant Expansion"

### Product features they'd actively use
- **Repository / search** ✓ (very heavy — 250 contracts across 6 plant locations)
- **Counterparty pages** ✓ (supplier exposure roll-up — critical)
- **Approvals** ✓ (multi-tier by value, Margaret's exec queue)
- **Risks** ✓ (supplier risk triage)
- **Matters** ✓ (M&A workspaces, plant-level cohorts)
- **Playbook** ✓ (supplier risk + M&A standard templates)
- **Agent** ✓ (Carla's contract-discovery tool, Olivia's plant-specific queries)

---

## Persona 4 — Lumen Bio

### Overview
**Industry:** Pre-clinical biotech — antibody discovery for oncology + autoimmune
**Size:** 80 employees, $35M Series A raised, ~$28M cash on hand
**Stage:** Series A, pre-IND filing; working with academic collaborators + 1 pharma collaboration in negotiation
**Domain:** `lumenbio.com`

### Users (3)
| Name | Role | Email |
|---|---|---|
| Dr. Aria Volkov | General Counsel + Compliance | `aria.volkov@lumenbio.com` |
| Ben Foster | Senior Paralegal | `ben.foster@lumenbio.com` |
| Dr. Hideo Yamamoto | Chief Scientific Officer (occasional initiator) | `hideo.yamamoto@lumenbio.com` |

### Document mix (target: 80 contracts — lowest volume)
| Type | % | Count |
|---|---|---|
| NDA / CDA | 25% | 20 |
| Research Collaboration / Sponsored Research | 20% | 16 |
| MSA (CRO/CDMO/lab vendors) | 15% | 12 |
| Employment / Consulting / IP Assignment | 15% | 12 |
| Material Transfer Agreement (MTA) | 10% | 8 |
| Vendor / SOW (software, lab consumables) | 10% | 8 |
| License / Option agreement | 5% | 4 |

**Status distribution:** 55% signed, 25% in-review, 10% draft, 10% expired
**Owner skew:** Aria 70% (solo GC) / Ben 25% / Hideo 5%

### Counterparties (~50 distinct)
**Academic:** Stanford, MIT, Harvard, UCSF, Johns Hopkins, MD Anderson, Memorial Sloan Kettering, Dana-Farber, Scripps Research, Salk Institute
**Big pharma (collab targets):** Pfizer, Merck, Roche, Genentech, Bristol Myers Squibb, AstraZeneca, Vertex Pharmaceuticals, Regeneron
**CROs:** Charles River Laboratories, Labcorp Drug Development, ICON, Parexel, IQVIA
**CDMOs:** Lonza, Catalent, Samsung Biologics, WuXi Biologics
**Lab vendors:** Thermo Fisher, Sartorius, Bio-Rad, MilliporeSigma, GenScript, Twist Bioscience
**Software:** Benchling, AWS, Snowflake (small contract)
**Consultants:** independent regulatory consultants, contract scientists

### Top 10 JTBDs
1. *"Show me all sponsored research agreements with university IP carve-outs."*
2. *"Which CDA is expiring before our Pfizer meeting on June 15?"*
3. *"Find any contract where we granted exclusive license rights."*
4. *"Has the MTA with Stanford been countersigned?"*
5. *"What's the status of the Pfizer collaboration term sheet?"*
6. *"Show me all employment agreements missing IP assignment language."*
7. *"Compare our Charles River vs Labcorp MSA on data ownership."*
8. *"Aria's queue — anything older than 5 days?"*
9. *"Find all NDAs with academic partners — what are the expiry dates?"*
10. *"Which contracts mention GLP/GMP standards?"*

### Workflow seeds
**Templates:** Mutual CDA, Sponsored Research Agreement, MTA, CRO MSA, IP Assignment (employment + consulting)
**Playbooks:** "Pharma collaboration NDA must-haves", "Academic collaboration boilerplate", "IP assignment for new hires"
**Approval policy:**
- CDA: Aria
- Research collab: Aria + Hideo (CSO)
- License (in or out): Aria + CEO + Board
- MTA: Aria
**Matters:** "Pfizer Antibody Collaboration", "Stanford CD20 Research Program", "IND-Enabling Studies (CRO Selection)"

### Product features they'd actively use
- **Templates** ✓ (Aria leans on CDA + IP Assignment templates heavily)
- **Counterparty pages** ✓ (Pfizer rolls up CDA + collab + future license)
- **Approvals** ✓ (lightweight — Aria + Board for big stuff)
- **Risks** ✓ (IP assignment clause check)
- **Matters** ✓ (per-collaboration workspaces)
- **Agent** ✓ (Aria's daily tool — solo GC needs leverage)
- **Repository / search** ✓ (small corpus, but high precision needed)

---

## Persona 5 — Beacon Logistics

### Overview
**Industry:** Mid-market 3PL (third-party logistics) — warehousing, freight forwarding, last-mile e-commerce fulfillment
**Size:** 1,200 employees, ~$280M revenue, family-owned for 60 years, recently took growth equity
**Stage:** Mid-market, ops-heavy, operating 8 warehouse hubs (Memphis, Atlanta, Dallas, LA, NJ, Chicago, Indianapolis, Phoenix)
**Domain:** `beaconlogistics.com`

### Users (4)
| Name | Role | Email |
|---|---|---|
| Dean Whitfield | General Counsel | `dean.whitfield@beaconlogistics.com` |
| Hannah Rivera | Senior Contracts Manager (customer side) | `hannah.rivera@beaconlogistics.com` |
| Chris Park | Senior Contracts Manager (carrier side) | `chris.park@beaconlogistics.com` |
| Eli Tran | Operations Compliance Counsel | `eli.tran@beaconlogistics.com` |

### Document mix (target: 200 contracts)
| Type | % | Count |
|---|---|---|
| Customer SLA / Service Agreement | 30% | 60 |
| Carrier Agreement (truck/ocean/rail) | 25% | 50 |
| Vendor / Tech Vendor (TMS/WMS/equip) | 15% | 30 |
| Lease (warehouse + truck) | 10% | 20 |
| NDA (RFP-stage, partner) | 10% | 20 |
| Insurance / Bond | 5% | 10 |
| Employment / Consultant | 5% | 10 |

**Status distribution:** 65% signed, 15% in-review, 10% draft, 10% expired
**Owner skew:** Dean 15% / Hannah 35% (customers) / Chris 30% (carriers) / Eli 20%

### Counterparties (~120 distinct)
**Customers (shippers):** Walmart, Target, Amazon, Costco, Home Depot, Lowe's, Ulta Beauty, Wayfair, Best Buy, Macy's, Kroger, Albertsons, CVS Health, Walgreens, Dollar General
**E-comm partners:** Shopify (referral), ShipStation, ShipBob (occasional), Returnly
**Truck carriers:** J.B. Hunt, Schneider National, Werner Enterprises, Knight-Swift, FedEx Ground, UPS Freight, Old Dominion, Saia, XPO, Estes Express
**Ocean carriers:** Maersk, MSC, CMA CGM, ZIM, Hapag-Lloyd, Evergreen
**Rail:** BNSF, Union Pacific, CSX, Norfolk Southern
**Tech vendors:** Project44, FourKites, Manhattan Associates, Blue Yonder, Oracle Transportation Management, SAP TM, Descartes
**Real estate:** Prologis, Duke Realty, EQT Exeter (warehouses)
**Insurance:** AIG, Travelers, Liberty Mutual, Chubb (cargo + GL)

### Top 10 JTBDs
1. *"Show all carrier agreements with fuel surcharge cap clauses."*
2. *"Which customer SLAs commit to <24hr delivery? What's our exposure?"*
3. *"Find expiring warehouse leases in next 12 months."*
4. *"What's our liability cap on the Walmart MSA?"*
5. *"Are there carrier agreements without indemnification for cargo loss?"*
6. *"Show me Hannah's queue + Chris's queue."*
7. *"Compare our top 3 ocean carrier rates and terms."*
8. *"Find all SLAs with peak-season volume commitments."*
9. *"Which contracts have audit rights — and when did we last audit?"*
10. *"Show contracts at the Memphis hub with expiring insurance riders."*

### Workflow seeds
**Templates:** Customer SLA (standard + enterprise), Carrier Agreement (truck/ocean/rail variants), Vendor MSA, NDA, Warehouse Lease addendum
**Playbooks:** "Customer SLA must-haves" (liability cap, force majeure, peak-season terms), "Carrier selection criteria" (insurance, safety rating, capacity), "Hub-level renewals"
**Approval policy:**
- Customer SLA <$1M ARR: Hannah
- Customer SLA ≥$1M: Hannah + Dean + CFO
- Carrier (truck/rail): Chris + Eli (compliance)
- Carrier (ocean, longer-term): Chris + Eli + Dean
- Lease: Dean + CFO
**Matters:** "Walmart 2026 RFP Response", "Memphis Hub Renewal Cohort", "Ocean Capacity Diversification 2026", "Peak Season Volume Reviews"

### Product features they'd actively use
- **Repository / search** ✓ (heavy — hub-specific queries)
- **Counterparty pages** ✓ (Walmart, Amazon roll-up across SLA + ad-hoc)
- **Approvals** ✓ (multi-tier — Hannah + Dean + CFO)
- **Matters** ✓ (RFP cohorts, hub-level renewals)
- **Risks** ✓ (cargo liability extraction, indemnification check)
- **Agent** ✓ (Hannah's daily tool, Eli's compliance scans)

---

## Cross-persona patterns

### Patterns we MUST test (all 5 personas hit them)
1. **"Show my approval queue"** — every persona has multi-user approvals
2. **"What's expiring in next 30/60/90 days?"** — universal renewal management
3. **"Find contracts with [clause type]"** — universal clause search
4. **"What's my exposure with [counterparty]?"** — universal counterparty roll-up
5. **"Compare [contract A] vs [contract B]"** — universal version/diff need

### Patterns by persona archetype
| Pattern | Vertex | Caldera | Ironbridge | Lumen | Beacon |
|---|---|---|---|---|---|
| Sales-led NDA from CRM | ✓ heavy | — | — | — | — |
| BAA / DPA compliance scan | — | ✓ heavy | — | — | — |
| Procurement risk triage | — | ✓ light | ✓ heavy | — | ✓ light |
| Multi-site (plant/hub/clinic) queries | — | ✓ med | ✓ heavy | — | ✓ heavy |
| M&A NDA + LOI flow | — | — | ✓ med | — | — |
| IP assignment / academic carve-outs | — | — | — | ✓ heavy | — |
| Solo-GC self-serve templates | — | — | — | ✓ heavy | — |
| Customer SLA peak-season terms | — | — | — | — | ✓ heavy |

### Test-conversation budget per persona (preview of phase 4)
- Vertex: 13 conversations (6 universal + 4 sales-led + 3 DPA/sub-processor)
- Caldera: 13 (6 universal + 7 BAA/DPA-heavy)
- Ironbridge: 15 (6 universal + 9 procurement/multi-plant — most complex)
- Lumen: 12 (6 universal + 6 IP/academic-heavy)
- Beacon: 13 (6 universal + 7 ops/multi-hub)
**Total: ~66 conversations**, fits the 50–75 range from the original plan.

---

## Phase 3 inputs ready

This doc fully specifies:
- **5 orgs** with names, domains, sizes, revenues
- **19 users** with names, roles, emails
- **800 contracts** with type-mix percentages and counts
- **~470 unique counterparties** with named lists per persona
- **Status + owner distributions** for realistic seeding
- **Templates, playbooks, approval policies, matters** per persona
- **66 test conversations** queued for phase 4

**Ready for phase 3** — building `scripts/seed-personas.ts` to translate this into a runnable seed.

If you want to swap anything (different counterparty names, different doc-mix percentages, more or fewer users per persona) — flag it now before I start the seed code.
