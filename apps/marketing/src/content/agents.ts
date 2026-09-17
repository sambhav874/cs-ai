export type Agent = {
  slug: string
  name: string
  blurb: string
  capability: string
  status: 'live' | 'planned'
}

export const agents: Agent[] = [
  {
    slug: 'intake',
    name: 'Intake Agent',
    blurb: 'Triages new contract requests',
    capability: 'Classifies type, priority, counterparty, value, and routes to the right queue.',
    status: 'live',
  },
  {
    slug: 'classify',
    name: 'Classify Agent',
    blurb: 'Identifies contract type & jurisdiction',
    capability: 'Detects 11+ contract types — NDA, MSA, DPA, BAA, SOW, MTA — with confidence scores.',
    status: 'live',
  },
  {
    slug: 'review',
    name: 'Review Agent',
    blurb: 'Extracts key terms with citations',
    capability: '14 universal + 9-16 type-specific fields. Every value cites the exact contract quote.',
    status: 'live',
  },
  {
    slug: 'ask',
    name: 'Ask Agent',
    blurb: 'Q&A across one or many contracts',
    capability: 'Hybrid BM25 + pgvector search returns answers with clause-level citations.',
    status: 'live',
  },
  {
    slug: 'portfolio',
    name: 'Portfolio Agent',
    blurb: 'Multi-document analysis',
    capability: '"What\'s our exposure with Snowflake?" — synthesizes across 150+ contracts.',
    status: 'live',
  },
  {
    slug: 'draft',
    name: 'Draft Agent',
    blurb: 'Generates contracts from playbooks',
    capability: 'Assembles from your clause library + playbook positions. Flags every deviation.',
    status: 'live',
  },
  {
    slug: 'redline',
    name: 'Redline Agent',
    blurb: 'Negotiates counterparty redlines',
    capability: 'Detects deviations from your fallbacks, generates counter-language, ranks risk.',
    status: 'live',
  },
  {
    slug: 'approval',
    name: 'Approval Agent',
    blurb: 'Routes contracts for sign-off',
    capability: 'Sequential or parallel approvals by value, type, jurisdiction. Auto-summary for approvers.',
    status: 'planned',
  },
  {
    slug: 'signature',
    name: 'Signature Agent',
    blurb: 'Self-hosted eSignature',
    capability: 'Tokenized links for external signers. JWT for internal. No external e-sign vendor required.',
    status: 'planned',
  },
  {
    slug: 'obligation',
    name: 'Obligation Agent',
    blurb: 'Tracks renewal & compliance dates',
    capability: 'Auto-extracts renewal, payment, audit, compliance deadlines and alerts the right owner.',
    status: 'planned',
  },
  {
    slug: 'invoice',
    name: 'Invoice Agent',
    blurb: 'Reconciles invoices to contracts',
    capability: "Reconciles invoices against a contract's payment obligations (vendor, amount, due date) and flags mismatches for review.",
    status: 'planned',
  },
  {
    slug: 'detect-binder',
    name: 'Binder Agent',
    blurb: 'Splits PDFs into individual contracts',
    capability: 'Multi-doc PDFs (M&A diligence rooms) auto-split into separate contracts with metadata.',
    status: 'live',
  },
]

export const agentStats = {
  total: agents.length,
  live: agents.filter((a) => a.status === 'live').length,
  planned: agents.filter((a) => a.status === 'planned').length,
}
