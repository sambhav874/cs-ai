/**
 * conversations.mjs — 66 conversation specs across 5 personas.
 *
 * Each conversation has ONE turn (single-shot retrieval). Multi-turn variants
 * can be added in a follow-up pass once we know which single-turns work.
 *
 * Conversation shape:
 *   {
 *     id,                  // unique slug (persona-NN-shortname)
 *     persona,             // org slug
 *     user,                // email of persona user driving the convo
 *     jtbd,                // human-readable JTBD label
 *     ask,                 // verbatim user message
 *     expectedTools,       // [string] — at least one of these should be called (OR)
 *     mustMention,         // [string] — substrings expected in assistant text (case-insensitive AND)
 *     shouldNotMention,    // [string] — substrings that would indicate hallucination
 *     maxLatencyMs,        // typically 60000
 *   }
 *
 * Tools available (catalog from apps/agents/app/tools/):
 *   approval_list, clause_search, contract_cite, contract_get, contract_search,
 *   contract_summarize, contract_validate, counterparty_get, counterparty_memory,
 *   custom_field_list, obligations_list, org_memory, playbook_check,
 *   portfolio_search, redline_propose, renewal_advice, request_list
 *
 * Permissive expectedTools: we list multiple tool names per turn since
 * different reasonable agents might pick different but valid tools.
 */

const SEARCH_TOOLS = ['contract_search', 'portfolio_search']
const COUNTERPARTY_TOOLS = ['counterparty_get', 'counterparty_memory', ...SEARCH_TOOLS]
// Matter-domain queries — accept matter_list (added post-fix-1) plus search fallbacks.
const MATTER_TOOLS = ['matter_list', ...SEARCH_TOOLS]

// ──────────── Vertex Cloud (13 conversations) ────────────────────────────

const VERTEX = [
  {
    id: 'vertex-01-expiring-30',
    user: 'maya.chen@vertex.cloud',
    jtbd: 'Find contracts expiring in next 30 days',
    ask: 'How many contracts do I have expiring in the next 30 days? List them.',
    expectedTools: ['renewal_advice', ...SEARCH_TOOLS],
    mustMentionAny: ['expir', 'renew', 'no contract', 'upcoming'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'vertex-02-snowflake-exposure',
    user: 'maya.chen@vertex.cloud',
    jtbd: 'Counterparty exposure roll-up',
    ask: 'What is our total exposure with Snowflake across all contracts?',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['snowflake'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'vertex-03-find-msa-template',
    user: 'priya.patel@vertex.cloud',
    jtbd: 'Find recent MSA template',
    ask: 'Show me our most recent Master Services Agreement so I can use it as a template for Ramp.',
    expectedTools: SEARCH_TOOLS,
    mustMention: ['msa'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'vertex-04-dpa-without-subprocessor',
    user: 'maya.chen@vertex.cloud',
    jtbd: 'Find DPAs missing sub-processor disclosure',
    ask: 'Find any Data Processing Addendum that does not list a sub-processor.',
    expectedTools: SEARCH_TOOLS,
    mustMentionAny: ['dpa', 'data processing'],   // agent often spells out the type
    maxLatencyMs: 60_000,
  },
  {
    id: 'vertex-05-approval-queue',
    user: 'priya.patel@vertex.cloud',
    jtbd: 'Pending approval queue',
    ask: "What's stuck in my approval queue right now?",
    expectedTools: ['approval_list', 'request_list'],
    mustMention: [],   // Priya may have an empty queue — accept either way
    maxLatencyMs: 60_000,
  },
  {
    id: 'vertex-06-playbook-check',
    user: 'priya.patel@vertex.cloud',
    jtbd: 'Playbook conformance for new NDA',
    ask: 'Sara on the sales team wants to send an NDA to Plaid. Does the standard NDA terms align with our sales playbook?',
    // org_memory is also valid — it's where playbook positions live for the
    // agent. The model legitimately picks org_memory + counterparty_memory
    // for "does X align with our playbook?" since that's about retrieving
    // policy positions, not running a clause-by-clause check.
    expectedTools: ['playbook_check', 'org_memory', ...SEARCH_TOOLS],
    mustMention: ['nda'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'vertex-07-auto-renew-q3',
    user: 'maya.chen@vertex.cloud',
    jtbd: 'Auto-renew clauses upcoming',
    ask: 'Which contracts have auto-renewal clauses with renewal in the next 90 days?',
    expectedTools: ['renewal_advice', ...SEARCH_TOOLS],
    mustMention: ['renew'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'vertex-08-stripe-history',
    user: 'priya.patel@vertex.cloud',
    jtbd: 'Counterparty contract history',
    ask: 'Show me all Stripe contracts in chronological order so I can see how the relationship has evolved.',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['stripe'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'vertex-09-high-indemnification',
    user: 'maya.chen@vertex.cloud',
    jtbd: 'High-risk indemnification scan',
    ask: 'Find any contract where we agreed to indemnification above $5M.',
    expectedTools: ['clause_search', ...SEARCH_TOOLS],
    mustMention: [],
    maxLatencyMs: 60_000,
  },
  {
    id: 'vertex-10-vendor-subprocessors',
    user: 'maya.chen@vertex.cloud',
    jtbd: 'Vendor sub-processor compliance',
    ask: 'Which of our vendor contracts are with companies that handle our customer data? List the vendors.',
    expectedTools: SEARCH_TOOLS,
    mustMention: ['vendor'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'vertex-11-david-load',
    user: 'david.kim@vertex.cloud',
    jtbd: 'My contract load',
    ask: 'How many contracts am I currently the owner of, and what statuses are they in?',
    expectedTools: SEARCH_TOOLS,
    mustMention: [],
    maxLatencyMs: 60_000,
  },
  {
    id: 'vertex-12-datadog-status',
    user: 'maya.chen@vertex.cloud',
    jtbd: 'Single-counterparty status check',
    ask: 'What is the current status of all our contracts with Datadog?',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['datadog'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'vertex-13-aws-exposure',
    user: 'maya.chen@vertex.cloud',
    jtbd: 'Cloud-vendor concentration risk',
    ask: 'How much do we spend with AWS across all active contracts?',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['aws'],
    maxLatencyMs: 60_000,
  },
]

// ──────────── Caldera Health (13 conversations) ──────────────────────────

const CALDERA = [
  {
    id: 'caldera-01-baa-current',
    user: 'lena.park@calderahealth.com',
    jtbd: 'BAA compliance scan',
    ask: 'Are all of our Business Associate Agreements current and compliant with HIPAA?',
    expectedTools: [...SEARCH_TOOLS, 'playbook_check'],
    mustMentionAny: ['baa', 'business associate', 'hipaa'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'caldera-02-subprocessor-mismatch',
    user: 'marcus.hall@calderahealth.com',
    jtbd: 'DPA sub-processor disclosure',
    ask: 'Show me sub-processors that we use but that are not yet listed in our customer DPA addendum.',
    expectedTools: SEARCH_TOOLS,
    mustMentionAny: ['sub-processor', 'subprocessor', 'dpa'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'caldera-03-missing-breach-clause',
    user: 'aisha.yusuf@calderahealth.com',
    jtbd: 'Missing breach-notification clause',
    ask: 'Which BAAs are missing a 30-day breach notification clause?',
    expectedTools: ['clause_search', ...SEARCH_TOOLS],
    mustMention: ['breach'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'caldera-04-q3-expiring',
    user: 'lena.park@calderahealth.com',
    jtbd: 'Quarterly expiry roll-up',
    ask: "What's expiring in the next 90 days, and what is the renewal playbook for each type?",
    expectedTools: ['renewal_advice', ...SEARCH_TOOLS],
    mustMention: ['expir'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'caldera-05-ascension-baa',
    user: 'lena.park@calderahealth.com',
    jtbd: 'Single counterparty BAA history',
    ask: 'Find the most recent BAA we signed with Ascension.',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['ascension'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'caldera-06-cigna-dpa-sig',
    user: 'marcus.hall@calderahealth.com',
    jtbd: 'Signature status check',
    ask: 'Has the DPA with Cigna been countersigned by them yet?',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['cigna'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'caldera-07-marcus-queue',
    user: 'marcus.hall@calderahealth.com',
    jtbd: 'My approval queue (privacy)',
    ask: 'What approvals are waiting on me as Privacy Officer?',
    expectedTools: ['approval_list'],
    mustMention: [],
    maxLatencyMs: 60_000,
  },
  {
    id: 'caldera-08-mayo-vs-cleveland',
    user: 'aisha.yusuf@calderahealth.com',
    jtbd: 'Cross-counterparty MSA compare',
    ask: 'Compare our master service agreement with Mayo Clinic vs the one with Cleveland Clinic. What are the key differences?',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['mayo', 'cleveland'],
    maxLatencyMs: 90_000,
  },
  {
    id: 'caldera-09-payer-renewals',
    user: 'lena.park@calderahealth.com',
    jtbd: 'Payer cohort renewals',
    ask: 'Show me all our payer (Anthem, Aetna, Cigna, UnitedHealthcare) contracts and which are up for renewal this year.',
    expectedTools: SEARCH_TOOLS,
    mustMention: [],   // any payer name acceptable
    maxLatencyMs: 60_000,
  },
  {
    id: 'caldera-10-research-contracts',
    user: 'aisha.yusuf@calderahealth.com',
    jtbd: 'De-identification + research clause',
    ask: 'Show all contracts that mention de-identification or research use of patient data.',
    expectedTools: ['clause_search', ...SEARCH_TOOLS],
    mustMention: [],
    maxLatencyMs: 60_000,
  },
  {
    id: 'caldera-11-tom-procurement',
    user: 'tom.reilly@calderahealth.com',
    jtbd: 'Procurement: vendor onboarding',
    ask: 'I need to onboard Datavant as a new sub-processor. What contracts do we have with them already, and what is the BAA status?',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['datavant'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'caldera-12-pfizer-pilot',
    user: 'lena.park@calderahealth.com',
    jtbd: 'Pilot/research stack visibility',
    ask: 'What is the status of the Pfizer real-world evidence pilot? List all related contracts.',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['pfizer'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'caldera-13-hipaa-update-impact',
    user: 'marcus.hall@calderahealth.com',
    jtbd: 'Compliance impact analysis',
    ask: 'If a new HIPAA Security Rule update changes breach notification to 24 hours, which of our BAAs would need to be updated?',
    expectedTools: ['clause_search', ...SEARCH_TOOLS],
    mustMention: ['baa', 'breach'],
    maxLatencyMs: 60_000,
  },
]

// ──────────── Ironbridge Industrial (15 conversations) ───────────────────

const IRONBRIDGE = [
  {
    id: 'ironbridge-01-arcelormittal-exposure',
    user: 'margaret.obrien@ironbridge-ind.com',
    jtbd: 'Supplier exposure roll-up',
    ask: 'What is our total supplier exposure with ArcelorMittal across all plants?',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['arcelormittal'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'ironbridge-02-akron-recent',
    user: 'olivia.brennan@ironbridge-ind.com',
    jtbd: 'Plant-level recent activity',
    ask: 'Show me all contracts I have created or signed in the last 90 days.',
    expectedTools: SEARCH_TOOLS,
    mustMention: [],
    maxLatencyMs: 60_000,
  },
  {
    id: 'ironbridge-03-force-majeure-tariffs',
    user: 'margaret.obrien@ironbridge-ind.com',
    jtbd: 'Tariff-resilience clause check',
    ask: 'Which supplier agreements have force-majeure clauses that exclude tariffs?',
    expectedTools: ['clause_search', ...SEARCH_TOOLS],
    mustMentionAny: ['tariff', 'force majeure', 'force-majeure'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'ironbridge-04-detroit-renewals',
    user: 'raj.sharma@ironbridge-ind.com',
    jtbd: 'Plant-specific upcoming renewals',
    ask: 'Show me all contracts due for renewal in the next 60 days.',
    expectedTools: ['renewal_advice', ...SEARCH_TOOLS],
    mustMentionAny: ['renew', 'expir', 'upcoming'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'ironbridge-05-orphan-pos',
    user: 'carla.mendez@ironbridge-ind.com',
    jtbd: 'POs without master agreement',
    ask: 'Are there any open purchase orders without a signed master supplier agreement?',
    expectedTools: SEARCH_TOOLS,
    mustMention: [],
    maxLatencyMs: 60_000,
  },
  {
    id: 'ironbridge-06-acquisition-status',
    user: 'james.wright@ironbridge-ind.com',
    jtbd: 'M&A deal docs status',
    ask: 'What is the status of the Project Beacon acquisition NDAs and LOI?',
    expectedTools: SEARCH_TOOLS,
    mustMention: ['beacon'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'ironbridge-07-supplier-msa-compare',
    user: 'raj.sharma@ironbridge-ind.com',
    jtbd: 'Supplier MSA price-escalation compare',
    ask: 'Compare our top 3 supplier master agreements on price escalation terms.',
    expectedTools: SEARCH_TOOLS,
    mustMention: ['supplier'],
    maxLatencyMs: 90_000,
  },
  {
    id: 'ironbridge-08-large-sows',
    user: 'margaret.obrien@ironbridge-ind.com',
    jtbd: 'High-value SOW review',
    ask: 'Find SOWs where the project value exceeds $250,000 — those need executive approval.',
    expectedTools: SEARCH_TOOLS,
    mustMention: ['sow'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'ironbridge-09-olivia-queue',
    user: 'olivia.brennan@ironbridge-ind.com',
    jtbd: 'Plant procurement queue',
    ask: "What's stuck in my queue and why?",
    expectedTools: ['approval_list', 'request_list'],
    mustMention: [],
    maxLatencyMs: 60_000,
  },
  {
    id: 'ironbridge-10-concentration-risk',
    user: 'margaret.obrien@ironbridge-ind.com',
    jtbd: 'Concentration risk surface',
    ask: 'Show me concentration risk: which suppliers have more than $5M total spend across all our plants?',
    expectedTools: ['org_memory', 'counterparty_memory', ...SEARCH_TOOLS],
    mustMention: [],
    maxLatencyMs: 60_000,
  },
  {
    id: 'ironbridge-11-steel-suppliers',
    user: 'carla.mendez@ironbridge-ind.com',
    jtbd: 'Cohort spend (steel suppliers)',
    ask: 'List all our steel suppliers (ArcelorMittal, Nucor, US Steel, Steel Dynamics) and our total spend with each.',
    expectedTools: COUNTERPARTY_TOOLS,   // counterparty_get/memory is the right tool composition for named-list spend roll-up
    mustMention: [],
    maxLatencyMs: 60_000,
  },
  {
    id: 'ironbridge-12-open-matters',
    user: 'margaret.obrien@ironbridge-ind.com',
    jtbd: 'Open matters list',
    ask: 'What matters do we have open right now?',
    expectedTools: MATTER_TOOLS,
    mustMention: ['matter'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'ironbridge-13-tariff-matter',
    user: 'raj.sharma@ironbridge-ind.com',
    jtbd: 'Matter status: tariff response',
    ask: 'What is the status of the 2026 Steel Tariff Response matter? Which contracts are affected?',
    expectedTools: SEARCH_TOOLS,
    mustMention: ['tariff'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'ironbridge-14-carla-load',
    user: 'carla.mendez@ironbridge-ind.com',
    jtbd: 'My contract load',
    ask: 'How many active contracts do I currently own?',
    expectedTools: SEARCH_TOOLS,
    mustMention: [],
    maxLatencyMs: 60_000,
  },
  {
    id: 'ironbridge-15-sap-relationship',
    user: 'margaret.obrien@ironbridge-ind.com',
    jtbd: 'Tech vendor relationship',
    ask: 'Show me all contracts we have with SAP — total value, expiry dates, and types.',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['sap'],
    maxLatencyMs: 60_000,
  },
]

// ──────────── Lumen Bio (12 conversations) ────────────────────────────────

const LUMEN = [
  {
    id: 'lumen-01-research-ip-carveouts',
    user: 'aria.volkov@lumenbio.com',
    jtbd: 'Research IP carve-out scan',
    ask: 'Show me all sponsored research agreements with university IP carve-out provisions.',
    expectedTools: ['clause_search', ...SEARCH_TOOLS],
    mustMention: ['research'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'lumen-02-cda-pre-pfizer',
    user: 'aria.volkov@lumenbio.com',
    jtbd: 'CDA expiry timing',
    ask: 'Which CDAs are expiring in the next 60 days, especially with Pfizer?',
    expectedTools: ['renewal_advice', ...SEARCH_TOOLS],
    mustMentionAny: ['cda', 'expir', 'nda', 'no contract'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'lumen-03-exclusive-license',
    user: 'aria.volkov@lumenbio.com',
    jtbd: 'License grant audit',
    ask: 'Find any contract where we have granted exclusive license rights.',
    expectedTools: ['clause_search', ...SEARCH_TOOLS],
    mustMention: ['license'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'lumen-04-stanford-mta',
    user: 'ben.foster@lumenbio.com',
    jtbd: 'MTA countersignature status',
    ask: 'Has the Material Transfer Agreement with Stanford University been countersigned?',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['stanford'],
    mustMentionAny: ['mta', 'material transfer'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'lumen-05-pfizer-collab',
    user: 'aria.volkov@lumenbio.com',
    jtbd: 'Collaboration term-sheet status',
    ask: 'What is the current status of the Pfizer antibody collaboration?',
    expectedTools: [...COUNTERPARTY_TOOLS, 'matter_list'],   // "collaboration" can be a matter name
    mustMention: ['pfizer'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'lumen-06-employment-ip',
    user: 'ben.foster@lumenbio.com',
    jtbd: 'Employment IP-assignment audit',
    ask: 'Which employment agreements are missing IP assignment language?',
    expectedTools: ['clause_search', ...SEARCH_TOOLS],
    mustMention: ['employment'],
    mustMentionAny: ['ip', 'assignment', 'intellectual property'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'lumen-07-cro-msa-compare',
    user: 'aria.volkov@lumenbio.com',
    jtbd: 'CRO MSA terms compare',
    ask: 'Compare our Charles River Laboratories MSA vs the Labcorp Drug Development MSA on data ownership terms.',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['charles river', 'labcorp'],
    maxLatencyMs: 90_000,
  },
  {
    id: 'lumen-08-aria-old-queue',
    user: 'aria.volkov@lumenbio.com',
    jtbd: 'Stale items in solo-GC queue',
    ask: "What's in my queue right now and how old is the oldest item?",
    expectedTools: ['approval_list', 'request_list'],
    mustMention: [],
    maxLatencyMs: 60_000,
  },
  {
    id: 'lumen-09-academic-cdas',
    user: 'ben.foster@lumenbio.com',
    jtbd: 'Academic CDA inventory',
    ask: 'List all CDAs we have with academic institutions and their expiry dates.',
    expectedTools: SEARCH_TOOLS,
    mustMention: [],
    maxLatencyMs: 60_000,
  },
  {
    id: 'lumen-10-glp-gmp',
    user: 'aria.volkov@lumenbio.com',
    jtbd: 'Regulatory standards mention',
    ask: 'Which contracts mention GLP or GMP regulatory standards?',
    expectedTools: ['clause_search', ...SEARCH_TOOLS],
    mustMention: [],
    maxLatencyMs: 60_000,
  },
  {
    id: 'lumen-11-aria-matters',
    user: 'aria.volkov@lumenbio.com',
    jtbd: 'My open matters',
    ask: 'What matters am I currently the owner of?',
    expectedTools: MATTER_TOOLS,
    mustMention: ['matter'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'lumen-12-pfizer-all',
    user: 'aria.volkov@lumenbio.com',
    jtbd: 'All-Pfizer roll-up',
    ask: 'Show me every document we have with Pfizer — CDAs, term sheets, anything.',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['pfizer'],
    maxLatencyMs: 60_000,
  },
]

// ──────────── Beacon Logistics (13 conversations) ────────────────────────

const BEACON = [
  {
    id: 'beacon-01-fuel-surcharge',
    user: 'chris.park@beaconlogistics.com',
    jtbd: 'Carrier fuel-surcharge cap audit',
    ask: 'Show all carrier agreements with a fuel surcharge cap clause.',
    expectedTools: ['clause_search', ...SEARCH_TOOLS],
    mustMention: ['fuel', 'surcharge'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'beacon-02-24hr-sla',
    user: 'hannah.rivera@beaconlogistics.com',
    jtbd: '24-hour SLA exposure',
    ask: 'Which customer SLAs commit to under-24-hour delivery? What is our exposure?',
    expectedTools: ['clause_search', ...SEARCH_TOOLS],
    mustMention: ['sla'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'beacon-03-warehouse-leases',
    user: 'dean.whitfield@beaconlogistics.com',
    jtbd: 'Lease expiry roll-up',
    ask: 'Find warehouse leases expiring in the next 12 months.',
    expectedTools: ['renewal_advice', ...SEARCH_TOOLS],
    mustMention: ['lease', 'warehouse'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'beacon-04-walmart-liability',
    user: 'hannah.rivera@beaconlogistics.com',
    jtbd: 'Liability cap on key customer',
    ask: "What is the liability cap on our Walmart customer SLA?",
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['walmart'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'beacon-05-cargo-indem',
    user: 'eli.tran@beaconlogistics.com',
    jtbd: 'Carrier indemnification gap',
    ask: 'Are there any carrier agreements without indemnification for cargo loss?',
    expectedTools: ['clause_search', ...SEARCH_TOOLS],
    mustMention: ['carrier', 'cargo'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'beacon-06-team-queues',
    user: 'dean.whitfield@beaconlogistics.com',
    jtbd: 'Team queue review',
    ask: 'What is in the contracts queues for Hannah and Chris combined?',
    expectedTools: ['approval_list', 'request_list', ...SEARCH_TOOLS],
    mustMention: [],
    maxLatencyMs: 60_000,
  },
  {
    id: 'beacon-07-ocean-compare',
    user: 'chris.park@beaconlogistics.com',
    jtbd: 'Ocean carrier rate compare',
    ask: 'Compare our top 3 ocean carrier agreements (Maersk, MSC, CMA CGM) on rates and terms.',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['maersk', 'msc', 'cma cgm'],
    maxLatencyMs: 90_000,
  },
  {
    id: 'beacon-08-peak-volume',
    user: 'hannah.rivera@beaconlogistics.com',
    jtbd: 'Peak-season commitment audit',
    ask: 'Which customer SLAs have peak-season volume commitments?',
    expectedTools: ['clause_search', ...SEARCH_TOOLS],
    mustMention: ['peak', 'sla'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'beacon-09-audit-rights',
    user: 'eli.tran@beaconlogistics.com',
    jtbd: 'Customer audit-rights inventory',
    ask: 'Which customer contracts grant the customer audit rights?',
    expectedTools: ['clause_search', ...SEARCH_TOOLS],
    mustMention: ['audit'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'beacon-10-amazon-status',
    user: 'hannah.rivera@beaconlogistics.com',
    jtbd: 'Single key-customer status',
    ask: 'What is the status of all our Amazon contracts?',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMention: ['amazon'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'beacon-11-walmart-rfp',
    user: 'dean.whitfield@beaconlogistics.com',
    jtbd: 'Active RFP matter status',
    ask: 'What is the status of the Walmart 2026 RFP Response matter?',
    expectedTools: MATTER_TOOLS,
    mustMention: ['walmart'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'beacon-12-jb-hunt-exposure',
    user: 'chris.park@beaconlogistics.com',
    jtbd: 'Top carrier concentration',
    ask: 'How many contracts do we have with J.B. Hunt and what is the total annual revenue?',
    expectedTools: COUNTERPARTY_TOOLS,
    mustMentionAny: ['j.b. hunt', 'jb hunt', 'hunt'],
    maxLatencyMs: 60_000,
  },
  {
    id: 'beacon-13-memphis-cohort',
    user: 'hannah.rivera@beaconlogistics.com',
    jtbd: 'Hub-level renewal cohort',
    ask: 'Show me all contracts associated with the Memphis hub renewal cohort.',
    expectedTools: SEARCH_TOOLS,
    mustMention: ['memphis'],
    maxLatencyMs: 60_000,
  },
]

// ──────────── Export ─────────────────────────────────────────────────────

export const PERSONAS = [
  { slug: 'vertex-cloud',          name: 'Vertex Cloud',          conversations: VERTEX },
  { slug: 'caldera-health',        name: 'Caldera Health',        conversations: CALDERA },
  { slug: 'ironbridge-industrial', name: 'Ironbridge Industrial', conversations: IRONBRIDGE },
  { slug: 'lumen-bio',             name: 'Lumen Bio',             conversations: LUMEN },
  { slug: 'beacon-logistics',      name: 'Beacon Logistics',      conversations: BEACON },
]

export const TOTAL_CONVERSATIONS = PERSONAS.reduce((s, p) => s + p.conversations.length, 0)
