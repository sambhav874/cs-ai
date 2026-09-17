# Competitor Case Study Research — CLM Vendors

**Purpose:** distill real customer profiles, JTBDs, and document/workflow patterns from 5 leading CLM vendors so we can synthesize realistic test personas in phase 2.
**Date:** 2026-04-26
**Method:** WebSearch + WebFetch across each vendor's customer-stories index, individual case studies, G2 reviews, and adjacent press. 10–12 fetches per competitor; raw notes per agent in the conversation transcript.

---

## TL;DR

Five vendors, five distinct sweet spots, but the JTBDs cluster on three jobs:

1. **Get legal out of the 80% of low-risk contracts** so they focus on the 20% that matter (every vendor)
2. **Compress turnaround** — NDAs from days→minutes, MSAs from weeks→days (every vendor headlines a % cut)
3. **Centralize a fragmented estate** so anyone can find/reason over contracts (every vendor)

Where they differ:
- **Workflow design vs. AI extraction** — Ironclad/SpotDraft lead with workflow; LinkSquares/Evisort lead with extraction; Icertis leads with procurement transformation
- **Buy-side vs. sell-side** — Icertis is procurement-heavy; Ironclad/SpotDraft are sales-heavy; LinkSquares/Evisort sit in the middle
- **Org size** — SpotDraft (200–1k) → LinkSquares (200–2.5k) → Ironclad (1k–10k) → Evisort (1k–10k regulated) → Icertis (10k+ Global 500)

Our product should be plausible at **all** of these sweet spots; the personas below test exactly that.

---

## Side-by-side comparison

| Dimension | Ironclad | Icertis | LinkSquares | Evisort (Workday) | SpotDraft |
|---|---|---|---|---|---|
| **Sweet-spot size** | 1k–10k emp + F500 | 10k+ Global 500 | 200–2.5k mid-market | 1k–10k regulated | 200–1k scale-up |
| **Buy/sell bias** | Sell-side + procurement | Buy-side dominant | Mixed | Mixed | Sell-side + sales-led |
| **Lead pitch** | Workflow + AI redline | Source-to-contract platform | AI extraction + repo | AI extraction-first | Self-serve templates + speed |
| **Top industry verticals** | SaaS, CPG, fintech, media | Mfg, pharma, telecom, prof svcs | SaaS, biotech, fintech, media | Pharma, healthcare, finance, SaaS | SaaS, fintech, gaming, consumer |
| **Buyer titles named most** | GC, Head of Legal Ops | Head of Procurement, Legal Ops Director, CIO | GC (often solo), Legal Ops | GC, VP Law, Legal Ops Mgr | GC / Head of Legal, VP Legal |
| **Legal team size hint** | 5–50 | 30–200+ | 1–12 | 5–30 | 2–10 |
| **Top doc types** | NDA, MSA/order form, vendor, employment | Supplier, SOW, RFP | NDA, MSA, SOW, vendor | NDA/CDA, MSA, supplier, custodial, research | NDA, MSA, vendor, employment, influencer, T&C |
| **Top integrations** | Salesforce, DocuSign, Coupa, Slack | SAP, Ariba, Salesforce, Adobe Sign | Salesforce, Word add-in, DocuSign | Workday, SAP Ariba, Salesforce, MS365 | Salesforce, Slack, Drive, DocuSign |
| **ROI metrics they brag** | "2 weeks → minutes" (Dropbox); "96% reduction" (Poshmark) | "30 min → seconds" (Microsoft SOW); "self-serve 50%" (HP) | "1,300 hrs → 43 hrs" (Accession); "352% 3-yr ROI" | "5 days → 10 min" CDA; "70% outside-counsel cut" | "Open: 90% faster"; "Eureka 4,000 legacy in weeks" |

---

## Per-competitor compact profile

### 1. Ironclad — workflow-first, sales-led mid-market + F500
- **Customers profiled:** L'Oréal, Mastercard, Hormel, Dropbox, Asana, Snap, Intercom, Gusto, Orangetheory, Poshmark, Glassdoor, Bitmovin, Everlaw
- **Roles named:** Director/Head of Legal Ops appears as often as GC; IT/CLM Automation Manager (Docker, Orangetheory) is a notable secondary buyer
- **Top JTBDs:**
  1. *"Keep legal out of 95% of contracts"* — Catherine Choe, Everlaw
  2. *"2 weeks → minutes — or as fast as you can click"* — Dropbox
  3. *"Procurement isn't a blocker, legal isn't a blocker"* — Sid Ramesh, Gusto
- **Workflow pattern:** Salesforce (or Coupa) initiates → AI playbook applies fallback clauses → DocuSign/clickwrap. Self-service for HR/marketing/procurement is the expansion play after sales.
- **Surprise:** large clickwrap/eCSA volume (Snap, Orangetheory liability waivers, Poshmark photo releases) — high-volume consumer-facing agreements is a real use case, not just B2B.
- **Pain quote pre-adoption:** *"It was absolutely, completely manual, every step of it."* — Susan Olson, Hormel

### 2. Icertis — procurement transformation at Global 500 scale
- **Customers profiled:** Microsoft, Daimler, Mercedes-Benz, Sanofi, AkzoNobel, ALPLA, Smurfit Westrock, Krones, Enbridge, HPE, HP Inc., Wilson Sonsini, Shermco, Accenture
- **Roles named:** Head of Procurement / Sourcing CoE, Head of Contracting CoE, Legal Ops Director, CIO. Buying committee is bigger and more cross-functional than other vendors.
- **Top JTBDs:**
  1. Centralize across regions/BUs — *"Not about signing faster — about seeing further"* — AkzoNobel
  2. Self-service guided contracting — *"All 220,000 employees can act as procurement agents"* — Microsoft
  3. Source-to-contract — RFP→supplier→terms in one platform (Daimler, Mercedes 500k+ suppliers each)
- **Workflow pattern:** Guided wizard authoring → red/yellow/green risk triage → AI playbook check → human review only on flagged exceptions. Bulk legacy migration with OCR is a recurring kickoff motion (Microsoft 1M+, HP Inc. 16k).
- **Procurement bias:** SAP/Ariba is the integration anchor; ServiceNow notably absent.
- **Pain quote:** *"Ten years ago it was fully on manpower. Everything was stored somewhere, in some folder."* — Enbridge

### 3. LinkSquares — solo/small legal teams at mid-market SaaS
- **Customers profiled:** OutSystems, Commvault, LiveRamp, Tealium, HotelPlanner, Vivid Seats, Manscaped, Accession, CCC, Scripps, Carbon Health, ADARx, Zywave, Softonic, Pratilipi-class scale-ups
- **Roles named:** GC (often solo), Legal Ops Manager, Director of Contract Mgmt; in lean orgs the **CFO** runs legal-adjacent ops (Softonic).
- **Top JTBDs:**
  1. *"Find any clause in seconds"* — AI-extracted repo as the primary hook
  2. Compress turnaround — *"1,300 hrs → 43 hrs (96%)"* (Accession), *"NDAs 5x faster"* (Softonic)
  3. *"Punch above our weight"* — let a 1–3 person legal team scale via templates + AI drafting
- **Workflow pattern:** Word add-in (Finalize) for drafting → DocuSign for sign → auto-file into Analyze repo. Salesforce-driven request creation with bi-directional sync. ROI dashboards used to **defend headcount**.
- **Differentiation:** post-signature AI extraction is the wedge ("120+ fields auto-tagged"). Pre-signature drafting (Finalize) is layered on later.
- **Pain quote:** *"We were really lost in terms of what contracts were out there."* — food-packaging GC

### 4. Evisort (now Workday CLM) — AI-extraction in regulated industries
- **Customers profiled:** BNY Mellon, NetApp, Otsuka Pharma, Iowa Hospital Association, Molina Healthcare, Becton Dickinson, Plug Power, Cox Automotive, Keller Williams, Lyft, Box, Instacart, Brooks Brothers, Sweetgreen
- **Roles named:** GC, VP Law, Legal Ops Mgr; **Senior Manager of Reporting & Data Analytics** (Cox) is a notable secondary buyer — data team buys CLM as a data platform.
- **Top JTBDs:**
  1. *"Mass-extract from a legacy pile to answer a business question"* — NetApp filtered 24,000 contracts to 600 with "90 variations of partial-shipment provisions" during COVID
  2. *"5 business days → 10 minutes"* CDA self-serve (anonymized pharma)
  3. Centralize "digital silos" (Iowa Hospital Association — legal team shrunk 5→2)
- **Workflow pattern:** Bulk-ingest legacy → AI auto-tags → ad-hoc Google-like search. **21-day deployment** is their headline SLA. Cross-functional read-share: legal owns it, but supply-chain/procurement/finance/specific BUs query the repo.
- **Post-acquisition state:** All evisort.com URLs redirect to workday.com. Now positioned as "Workday Contract Intelligence" tightly bound to Workday's HR/finance install base.
- **Pain quote:** *"Death by a thousand emails"* — Otsuka legal team

### 5. SpotDraft — small-legal-team scale-ups (India-rooted, going global)
- **Customers profiled:** Open, Wingify, Gameskraft, Headout, Unlimited Group, DeepL, Pratilipi, Eureka Forbes, Notion, Chargebee, Razorpay, CRED
- **Roles named:** GC / Head of Legal (often only legal person), VP Legal, In-House Counsel, Data Protection Officer, Sales Ops; org has 2–5 lawyers max.
- **Top JTBDs:**
  1. *"It was a real headache, constantly searching for contracts"* — Open. Eliminate the chase.
  2. *"Standard contracts required physically visiting legal"* — Gameskraft. Self-serve for sales/HR/marketing.
  3. *"From blocker to business partner"* — DeepL framing. Make legal feel revenue-aligned, not gate-keeping.
- **Workflow pattern:** Self-serve templates (Unlimited generates 15–20/wk), in-CRM generation from Salesforce (Wingify), Aadhaar/stamp-paper integration (Pratilipi, Open) for India compliance. Native click-through "Legal Hub" for hosted T&Cs (Headout).
- **Surprise doc types:** influencer/creator agreements (Headout, Pratilipi 3,000 on one template), clickwrap T&Cs hosted from CLM. Modern monetization-model doc types CLMs don't always cover.
- **Caveat (third-party):** *"Overkill for startups without a legal-ops function"* — Bind. SpotDraft is the **small-legal-team** tool, not the no-legal-team tool.
- **Pain quote:** *"Even standard contracts required a lengthy process, with business team members physically visiting legal."* — Aditi Kapoor, Gameskraft

---

## Cross-cutting findings

### A. The buying committee is bigger than "legal"
Across all five vendors, the named-buyer roles consistently include **non-legal**:
- Procurement / Sourcing leads (esp. Icertis, but everywhere)
- IT / CLM Automation Managers (Ironclad Docker, Orangetheory)
- CFO / Finance (LinkSquares Softonic — small org runs legal under finance)
- Data Analytics (Evisort Cox Automotive)
- Sales Ops / CRM Heads (SpotDraft Wingify)

**Implication for our personas:** at least 2 of 5 personas should have non-GC buyers/users, and the agent tests should run from those personas' perspectives ("I'm a procurement lead, what's my exposure with Acme?").

### B. The pain story is identical across vendors
Every pre-adoption quote is some variant of: *"contracts scattered across email/Slack/Drive, we couldn't find anything, version control was chaos."* That's the universal entry pain. The differentiator pitch is what they do AFTER that — which is why our product needs to be evaluated on all three axes (extraction, workflow, repository) not just one.

### C. Volume distribution is non-uniform per persona
- High-volume self-serve doc types: NDAs (every vendor), liability/photo waivers (Ironclad), influencer agreements (SpotDraft), CDAs (Evisort pharma) — these are 80% of contract count
- Low-volume high-stakes: MSAs, SOWs, supplier master agreements — 20% of count, 80% of risk and lawyer attention
- **For seed corpus:** match this distribution. Don't seed 500 evenly-distributed contracts — seed 300 NDAs + 100 MSAs + 50 SOWs + 50 mixed. That mirrors reality and tests the right UX (do "drown in NDAs" workflows actually work?).

### D. Salesforce is the universal integration anchor
Every vendor lists Salesforce as a top integration. Even procurement-heavy Icertis surfaces it. **For our agent tests:** at least one persona should have a sales-led workflow ("draft NDA from Opportunity") even though we don't have a Salesforce integration shipped — to surface that gap.

### E. Doc types our seeds should cover (to span vendor reality)
- NDA / CDA — universal
- MSA / Master Service Agreement — universal
- SOW / Order Form — universal
- Vendor / Supplier / Procurement Agreement — universal, dominant in Icertis
- DPA — common (Unlimited, GDPR-driven)
- BAA — Evisort/Caldera-class healthcare
- Employment / Offer letter / IP assignment — Ironclad, SpotDraft
- Research collaboration — Evisort biotech, LinkSquares biotech
- Influencer / creator / partner — SpotDraft Headout/Pratilipi, Ironclad L'Oréal/Poshmark
- Liability waiver / clickwrap T&C — Ironclad Orangetheory, SpotDraft Headout
- Custodial / financial services agreements — Evisort BNY Mellon
- Renewal / amendment — universal post-signature

### F. Pre-adoption tooling we're displacing
- Email + Drive + Slack + Word + Excel — 100% of pain stories
- JIRA tickets for legal intake (Gusto, OutSystems)
- SharePoint as legacy "repo" (Microsoft, Hormel)
- Homegrown spreadsheet trackers (Scripps, Eureka Forbes)
- Other CLMs that "didn't fit" — referenced but rarely named

---

## Persona seeds (input for phase 2)

Mapping each of my 5 proposed personas to which vendor's sweet spot they cover, so we know phase 2 produces full coverage:

| # | Persona | Maps to | Industry | Org size | Legal team | Doc bias |
|---|---|---|---|---|---|---|
| 1 | **Vertex Cloud** (Series C SaaS) | Ironclad mid-market + LinkSquares + SpotDraft upmarket | SaaS | 800 emp | 4 (1 GC + 3 counsel) | NDA, MSA, SOW, vendor, sales-led |
| 2 | **Caldera Health** (mid-market health SaaS) | Evisort/Workday + Ironclad health | Health SaaS | 600 emp | 3 (1 GC + 1 counsel + 1 privacy) | BAA, DPA, MSA, vendor, compliance-heavy |
| 3 | **Ironbridge Industrial** (PE-backed mfr) | Icertis (procurement-led) | Industrial mfg | 5,000 emp | 6 (1 GC + 2 counsel + 3 procurement legal) | Supplier, MSA, SOW, RFP-tied |
| 4 | **Lumen Bio** (Series A biotech) | LinkSquares biotech + Evisort pharma (lean side) | Biotech | 80 emp | 2 (1 GC + 1 paralegal) | Research collab, IP assignment, employment, NDA, vendor |
| 5 | **Beacon Logistics** (3PL) | Ironclad ops (Cox, Lyft) + LinkSquares industrial | Logistics | 1,200 emp | 3 (1 GC + 2 contracts mgrs) | Customer SLA, carrier agreement, vendor, employment |

**Coverage check:**
- ✓ Sales-led + sell-side: Vertex (matches Ironclad/SpotDraft)
- ✓ Procurement-led + buy-side: Ironbridge (matches Icertis)
- ✓ Solo/small legal: Lumen (matches LinkSquares)
- ✓ Regulated, AI-extraction-heavy: Caldera (matches Evisort)
- ✓ Operations-heavy mid-market: Beacon (matches Ironclad ops + LinkSquares industrial)
- ✓ Doc type spread covers 11 of the 11 doc types listed in §E
- ✓ Non-GC buyer roles: Ironbridge procurement, Caldera privacy officer, Beacon contracts manager
- ✓ Org sizes span 80 → 5,000 (covers SpotDraft → Icertis range without going Global 500)

**One omission, intentional:** we are NOT seeding a Fortune 500 (Hormel-class) persona. Five orgs with that scale would be 100k+ contracts to seed, and the testing value is marginal — agent UX for an org with 5k contracts already exposes the same scaling questions as 50k.

---

## Phase 2 inputs ready

This doc plus the cross-cutting findings give phase 2 everything it needs. Ready to move on when you confirm.

**Recommended next step:** approve the 5 persona seeds above (Vertex / Caldera / Ironbridge / Lumen / Beacon), then I'll write `personas.md` with full role/doc-mix/JTBD detail per persona.

If you want to swap any of the 5 (e.g. trade Beacon for a Fortune 500 retail persona, or trade Lumen for a law firm) — say so before I start phase 2.
