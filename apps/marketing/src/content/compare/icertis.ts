import type { CompareData } from './types'

export const icertis: CompareData = {
  slug: 'icertis',
  competitorName: 'Icertis',
  competitorOneLiner:
    'Enterprise-focused CLM with deep procurement, supplier-management, and obligation-tracking modules. A long-standing leader in the contract intelligence category for large organisations.',
  tldr:
    'Icertis is built for very large enterprises with mature procurement and contract operations functions. draftLegal is an open-source CLM you can self-host and audit. Pick Icertis if your scale and procurement maturity warrant their platform. Pick draftLegal if openness, code transparency, and freedom from vendor lock-in are higher priorities — and stay tuned for our procurement-focused roadmap.',
  pickDraftLegalIf: [
    'You want to read every line of code your CLM runs before adopting it',
    'You want to self-host on your own infrastructure',
    'You want procurement-focused features built openly with you (see our roadmap)',
    'You prefer one AGPL-3.0 licensed codebase to a multi-module enterprise suite',
  ],
  pickCompetitorIf: [
    'You are a very large enterprise with mature procurement and supplier-management needs',
    'You require deep, pre-built modules for supplier risk, obligation enforcement, and spend analytics today',
    'Your team needs Gartner / IDC Leader references for analyst-driven procurement',
  ],
  migration:
    'Icertis exports contract metadata and documents through their standard export tooling. draftLegal\'s bulk import maps your records into our universal + type-specific schemas. We can help reconstruct templates and approval rules.',
  groups: [
    {
      title: 'Openness & deployment',
      rows: [
        { label: 'Open source (AGPL-3.0)', draftLegal: 'yes', competitor: 'no' },
        { label: 'Self-host on your infra', draftLegal: 'yes', competitor: 'no' },
        { label: 'Code transparency (full repo)', draftLegal: 'yes', competitor: 'no' },
        { label: 'Free self-host tier', draftLegal: 'yes', competitor: 'no' },
      ],
    },
    {
      title: 'AI & extensibility',
      rows: [
        { label: 'Bring your own AI provider keys', draftLegal: 'yes', competitor: 'unknown' },
        { label: 'Switchable LLM provider per agent', draftLegal: 'yes', competitor: 'unknown' },
      ],
    },
    {
      title: 'Lifecycle coverage',
      rows: [
        { label: 'Intake / request', draftLegal: 'yes', competitor: 'yes' },
        { label: 'Drafting + templates + playbook', draftLegal: 'yes', competitor: 'yes' },
        { label: 'Counterparty redline analysis', draftLegal: 'yes', competitor: 'yes' },
        { label: 'Approval workflows', draftLegal: 'yes', competitor: 'yes' },
        { label: 'Obligation tracking', draftLegal: 'yes', competitor: 'yes' },
        { label: 'Supplier / vendor onboarding', draftLegal: 'partial', competitor: 'yes', note: 'On draftLegal\'s near-term roadmap' },
        { label: 'Spend analytics module', draftLegal: 'no', competitor: 'yes' },
      ],
    },
  ],
}
