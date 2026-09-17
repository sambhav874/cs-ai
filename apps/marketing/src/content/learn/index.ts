export type LearnArticle = {
  slug: string
  title: string
  category: 'Concept' | 'Contract type' | 'Process'
  tldr: string
  sections: { heading: string; body: string }[]
  relatedSlugs: string[]
  productLink?: { label: string; href: string }
}

const placeholderTldr = (slug: string) =>
  `Quick overview of ${slug.replace(/-/g, ' ')} for legal, ops, and procurement teams. Full guide coming soon — meanwhile, see the related concepts below.`

const placeholderSections = (slug: string) => [
  {
    heading: `What is ${slug.replace(/-/g, ' ')}?`,
    body: `This article is being written. We're keeping the page live so the URL is stable, search engines can find it, and you can bookmark it. In the meantime, the related guides below cover overlapping ground.`,
  },
]

export const learnArticles: Record<string, LearnArticle> = {
  'contract-lifecycle-management': {
    slug: 'contract-lifecycle-management',
    title: 'What is Contract Lifecycle Management (CLM)?',
    category: 'Concept',
    tldr: 'Contract Lifecycle Management (CLM) is the systematic management of contracts from request through drafting, negotiation, approval, signature, and post-signature obligations. Modern CLM software replaces shared drives, email chains, and ad-hoc Word documents with a single platform that tracks every contract\'s state, stores executed copies, enforces approval policies, and surfaces obligations like renewals before they lapse.',
    sections: [
      {
        heading: 'What is Contract Lifecycle Management?',
        body: 'CLM covers six stages: (1) intake, where a request enters the system; (2) drafting, where a first version is created from templates; (3) negotiation, where redlines are exchanged with the counterparty; (4) approval, where stakeholders sign off; (5) signature, where the contract is executed; and (6) post-signature tracking, where obligations like renewals, payments, and audits are managed. CLM software ties these stages together with workflow, a searchable repository, and increasingly, AI agents that handle routine work.',
      },
      {
        heading: 'Why does CLM matter?',
        body: 'Most companies lose money on contracts they don\'t actively manage. Auto-renewals trigger because nobody saw them coming. Liability caps drift because templates aren\'t enforced. Approvals stall in email. CLM doesn\'t solve these by accident — it solves them by giving every contract a state machine, every clause a source of truth, and every obligation an owner.',
      },
      {
        heading: 'How does CLM work in practice?',
        body: 'A request comes in (a sales rep needs an MSA, a procurement manager needs a supplier agreement). The system classifies it, applies the right template and playbook, and routes it for review. The redline back from the counterparty triggers a deviation analysis. Approvals route by value or contract type. Signature happens in-platform. After signature, the system extracts renewal dates, payment milestones, and audit rights, and alerts owners as deadlines approach.',
      },
      {
        heading: 'CLM vs. eSignature vs. Contract Repository',
        body: 'Standalone eSignature tools only handle signing. Contract repositories store executed contracts but do not manage drafting or approvals. Full CLM covers the whole lifecycle. Modern AI-first platforms (like draftLegal) collapse these into one product: agents handle drafting and review, the repository indexes everything, and signature is built in.',
      },
      {
        heading: 'What to look for in a CLM platform in 2026',
        body: 'Agent-first AI (not bolted-on chatbots), full lifecycle coverage, transparent pricing, fast time-to-value (weeks, not quarters), and ideally open-source or single-tenant deployment so your contracts don\'t live in a black box.',
      },
    ],
    relatedSlugs: ['ai-contract-review', 'ai-contract-drafting', 'contract-repository', 'contract-approval-workflow', 'obligation-management'],
    productLink: { label: 'See how Draft Legal handles each lifecycle stage →', href: '/product' },
  },
  'ai-contract-review': {
    slug: 'ai-contract-review',
    title: 'What is AI Contract Review?',
    category: 'Concept',
    tldr: 'AI contract review uses large language models to read a contract, extract key terms (parties, value, dates, liability, IP, governing law), flag deviations from your standards, and rate risk. Done well, it cuts review time 25-50% (Deloitte 2024) while keeping a human in the loop for judgment calls. Done poorly, it hallucinates clauses that don\'t exist — which is why citations and confidence scores matter.',
    sections: [
      {
        heading: 'What is AI contract review?',
        body: 'AI contract review automates the first read of a contract: extracting structured data (counterparty, value, term, jurisdiction), summarizing key obligations, comparing against your template or fallback positions, and flagging anything unusual. The output is a structured analysis — not a vague chatbot response. Modern systems extract 14+ universal fields (across all contracts) plus 9-16 type-specific fields per contract type, with confidence scores and citations.',
      },
      {
        heading: 'How does AI contract review work?',
        body: 'A document is parsed (PDF/DOCX → text), split into clauses, and passed to an LLM with tightly scoped prompts. The agent extracts each field, validates it against expected formats and ranges, and scores confidence. For deviation analysis, the extracted clauses are compared against your playbook or fallback library. Risk is scored based on the size and direction of each deviation.',
      },
      {
        heading: 'What does good AI contract review look like?',
        body: 'Three signals: (1) every extracted value comes with a citation back to the exact contract quote, so you can verify; (2) confidence scores are surfaced (red / yellow / green), so reviewers know where to look; (3) the system flags what\'s missing, not just what\'s present — a missing liability cap is more dangerous than a high one.',
      },
      {
        heading: 'AI contract review accuracy',
        body: 'In published benchmarks, AI tools have hit 94% accuracy on NDA risk identification vs. ~85% for experienced lawyers (Lexis 2024). But accuracy varies wildly by contract type, prompt quality, and model. Always test on a representative sample of your own contracts before committing to a vendor.',
      },
      {
        heading: 'Common pitfalls',
        body: 'One-pass extraction without validation. No citations. Vague risk scoring with no rubric. Overconfidence on edge cases (regulatory exhibits, jurisdictional clauses). The fix: agents that show their work — plan, extract, validate, score — with humans gating destructive actions.',
      },
    ],
    relatedSlugs: ['ai-contract-drafting', 'contract-redlining', 'clause-library', 'contract-lifecycle-management'],
    productLink: { label: 'See the Draft Legal Review Agent →', href: '/product#draft' },
  },
  'ai-contract-drafting': {
    slug: 'ai-contract-drafting',
    title: 'AI Contract Drafting Explained',
    category: 'Concept',
    tldr: 'AI contract drafting generates first-draft contracts from your templates, clause library, and playbook positions — pulling counterparty data from your CRM and flagging every deviation from preferred terms. The good ones don\'t invent legal language; they assemble approved clauses. Done right, you go from "draft me an MSA for Ramp" to a polished first draft in under a minute.',
    sections: [
      {
        heading: 'What is AI contract drafting?',
        body: 'AI drafting takes a request (counterparty, deal type, key terms) and produces a complete first draft. The agent pulls the right template, applies your standard clauses, fills in counterparty and deal data, and flags every spot where it had to make a judgment call.',
      },
      {
        heading: 'How does AI drafting work without inventing language?',
        body: 'The good systems don\'t generate language from scratch — they assemble from a curated clause library. Your library is your moat: the standard liability cap, the approved governing-law options, the IP language you\'ve negotiated to death. The agent picks from these, applies playbook rules ("MSA liability cap = 12 months ARR, never less"), and flags the deviations a human should review.',
      },
      {
        heading: 'AI drafting vs. template assembly',
        body: 'Template assembly (the old way) means filling blanks in a Word template. AI drafting goes further: it picks the right template, applies multiple clause variants based on context, and produces something a human can review in 5 minutes instead of 30.',
      },
      {
        heading: 'What makes AI drafting actually useful',
        body: 'Three things: (1) playbook-aware — knows your fallback positions and won\'t silently violate them; (2) data-aware — pulls counterparty terms from CRM, not from the user\'s memory; (3) auditable — every clause links back to its source in your library, so legal can audit what the AI assembled.',
      },
    ],
    relatedSlugs: ['clause-library', 'ai-contract-review', 'contract-redlining', 'contract-lifecycle-management'],
    productLink: { label: 'See the Draft Agent in action →', href: '/product#draft' },
  },
  'contract-redlining': {
    slug: 'contract-redlining',
    title: 'What is Contract Redlining?',
    category: 'Process',
    tldr: 'Contract redlining is the negotiation process where parties exchange marked-up versions of a contract showing proposed changes. AI-powered redlining detects every deviation from your standard positions, ranks each change by deal-breaker risk, and suggests counter-language pulled from your fallback library. The goal: stay in control of negotiation without re-reading the entire contract every round.',
    sections: [
      {
        heading: 'What is contract redlining?',
        body: 'Redlining means showing edits to a contract — additions, deletions, replacements — typically with tracked changes in Word. Each side proposes language, the other side counter-proposes, and the contract converges through 2-5 rounds of edits. Modern CLM platforms make this less manual by auto-detecting deviations and proposing counter-language.',
      },
      {
        heading: 'How does AI-powered redlining work?',
        body: 'When a counterparty\'s redline arrives, the agent compares each modified clause against your standard, fallback, and playbook positions. Every change gets a risk rating ("OK to accept", "negotiate", "reject"), a category ("liability", "IP", "termination"), and a suggested counter — pulled from your fallback library, not invented. The negotiator stays in control.',
      },
      {
        heading: 'Redlining best practices',
        body: 'Maintain a clause library with 2-3 fallback positions per major term. Use playbooks to encode "non-negotiable" lines (e.g., "we never agree to unlimited liability"). Track every round in version-controlled storage so you can see the negotiation trail. Flag deal-breakers immediately so deals don\'t die at signature.',
      },
      {
        heading: 'Word-track-changes vs. CLM redlining',
        body: 'Track changes in Word works for one-off contracts. For volume, you need a system that compares to your standards, surfaces patterns ("Vertex always pushes back on the IP clause"), and gives non-lawyers a confident answer on what to accept.',
      },
    ],
    relatedSlugs: ['ai-contract-review', 'clause-library', 'ai-contract-drafting', 'contract-approval-workflow'],
    productLink: { label: 'See the Redline Agent →', href: '/product#negotiate' },
  },
  'clause-library': {
    slug: 'clause-library',
    title: 'What is a Clause Library?',
    category: 'Concept',
    tldr: 'A clause library is a curated, versioned repository of pre-approved contract language — your "always", "preferred", "fallback", and "must-not" positions on every major term. It\'s the backbone of consistent contracts, fast drafting, and disciplined negotiation. Without one, every contract is a fresh start; with one, your AI can assemble drafts and counter redlines using language you\'ve already vetted.',
    sections: [
      {
        heading: 'What is a clause library?',
        body: 'A clause library is a structured collection of contract language organized by topic (liability, IP, indemnification, governing law, ...). For each topic, you maintain multiple positions: your preferred language, fallback options when the counterparty pushes back, and red-line positions you won\'t cross.',
      },
      {
        heading: 'Why every legal team needs one',
        body: 'Without a library, every drafter starts from a different version, every negotiation reinvents the same arguments, and inconsistent terms creep into your portfolio. A library fixes all three: drafting becomes assembly, negotiation becomes reference, and your portfolio reflects deliberate choices instead of drift.',
      },
      {
        heading: 'How AI uses your clause library',
        body: 'The AI assembles drafts from your library — not from generic training data. The Redline Agent compares counterparty proposals to your library positions and suggests counter-language drawn from your fallbacks. This is the difference between "AI drafting" (sometimes hallucinated) and "AI assembly" (always traceable).',
      },
      {
        heading: 'Building a clause library that actually gets used',
        body: 'Start small: 5 topics, 3 positions each. Tag every clause with metadata (contract type, jurisdiction, deal stage). Version every change. Make it searchable in plain English ("show me my IP-ownership fallbacks"). Drafters and AI both pull from it.',
      },
    ],
    relatedSlugs: ['ai-contract-drafting', 'contract-redlining', 'contract-lifecycle-management'],
    productLink: { label: 'How Draft Legal manages your clause library →', href: '/product' },
  },
  'nda': {
    slug: 'nda',
    title: 'What is a Non-Disclosure Agreement (NDA)?',
    category: 'Contract type',
    tldr: 'A Non-Disclosure Agreement (NDA) is a contract where parties agree to keep specific information confidential. The two main flavors are mutual (both sides share confidential info) and one-way (only one side does). NDAs are usually the first contract signed in any business relationship — sales, partnerships, M&A, hiring — and they\'re the highest-volume contract type for most legal teams.',
    sections: [
      {
        heading: 'What is an NDA?',
        body: 'An NDA defines what information is confidential, who can see it, how long the obligation lasts, and what happens if it\'s breached. Standard NDAs are 2-5 pages; complex ones (M&A, deep technology disclosure) can stretch to 20+.',
      },
      {
        heading: 'Mutual NDA vs. one-way NDA',
        body: 'Mutual NDAs protect both sides — common when two companies are evaluating a partnership or both will share sensitive info. One-way (or "unilateral") NDAs protect a single discloser — common when one party shares confidential info with a vendor, contractor, or candidate.',
      },
      {
        heading: 'Key clauses in every NDA',
        body: '1) Definition of confidential information (broad enough to cover what you care about, narrow enough to be enforceable). 2) Permitted uses. 3) Term (typically 2-5 years). 4) Carve-outs (publicly available info, independently developed, legally required disclosures). 5) Return or destruction of info on termination. 6) Governing law and jurisdiction.',
      },
      {
        heading: 'Common NDA pitfalls',
        body: 'Overly broad confidentiality definitions that the counterparty won\'t sign. Term too long for the actual sensitivity of the info. Missing carve-outs that make compliance practically impossible. Vague remedies that make breach unenforceable. AI-assisted review catches these in seconds; manual review takes 30 minutes per NDA.',
      },
      {
        heading: 'AI for NDAs',
        body: 'NDAs are the perfect use case for agent-first CLM: high volume, predictable structure, low judgment per contract. A well-tuned system auto-extracts key terms, applies your fallbacks, and routes only the unusual ones to a human. Sales ops self-services 80%+ of NDAs without ever touching legal.',
      },
    ],
    relatedSlugs: ['msa', 'dpa', 'contract-redlining', 'ai-contract-review'],
    productLink: { label: 'Generate an NDA in 30 seconds →', href: '/templates/nda' },
  },
  'msa': {
    slug: 'msa',
    title: 'What is a Master Service Agreement (MSA)?',
    category: 'Contract type',
    tldr: 'A Master Service Agreement (MSA) is the umbrella contract between a service provider and a customer, covering the long-term commercial terms — pricing structure, liability, IP, payment, term and termination, governing law. Specific projects then attach as Statements of Work (SOWs) under the MSA. MSAs are negotiated once and govern many SOWs, which makes them the highest-leverage contract type for B2B SaaS, professional services, and procurement.',
    sections: [
      {
        heading: 'What is an MSA?',
        body: 'An MSA sets the rules of engagement between two companies. Once it\'s signed, individual projects (SOWs, Order Forms) reference the MSA for the boilerplate and add only project-specific terms — scope, deliverables, price, schedule. This separation lets you renegotiate the relationship once a year instead of every project.',
      },
      {
        heading: 'MSA vs. SOW',
        body: 'MSA = umbrella terms (one-time negotiation). SOW = project-specific work and price (negotiated each engagement). The SOW points back to the MSA: "this SOW is governed by the MSA dated X." If the MSA is well-drafted, SOWs are short and easy to close.',
      },
      {
        heading: 'Key clauses to negotiate',
        body: 'Liability cap (typically capped at 12 months of fees, with carve-outs). Indemnification (mutual, with cap-aligned exceptions). IP ownership (work-for-hire? licensed back?). Payment terms (NET 30 vs. NET 60 — material to cash flow). Term and termination (auto-renew? convenience termination?). Governing law and venue. Insurance requirements. Confidentiality.',
      },
      {
        heading: 'MSA negotiation strategy',
        body: 'Identify your "must-haves" upfront — typically the liability cap and IP terms. Maintain fallback positions for every key clause so negotiators don\'t reinvent positions. Use a clause library: when the counterparty proposes alternative language, pull from your pre-approved fallbacks instead of drafting fresh.',
      },
      {
        heading: 'AI for MSAs',
        body: 'MSAs are heavier than NDAs but follow predictable structure. AI extracts every key term in seconds, compares against your standards, and flags the ones that need human attention. The Draft Agent assembles a first draft from your template + customer data + playbook positions; the Review Agent reads the redline and ranks every change.',
      },
    ],
    relatedSlugs: ['nda', 'sow', 'dpa', 'contract-redlining', 'clause-library'],
    productLink: { label: 'Free MSA template →', href: '/templates/msa' },
  },
}

export const learnIndex = Object.values(learnArticles)

export const stubLearnEntry = (slug: string): LearnArticle => ({
  slug,
  title: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  category: 'Concept',
  tldr: placeholderTldr(slug),
  sections: placeholderSections(slug),
  relatedSlugs: ['contract-lifecycle-management', 'ai-contract-review'],
})
