import type { CompareData } from './types'

// Comparison content principle: only assert what is publicly verifiable from
// the competitor's own documentation, marketing site, or open standards.
// No claims about price floors, implementation duration, or procurement
// experience — those vary by deal and we cannot verify them.

export const ironclad: CompareData = {
  slug: 'ironclad',
  competitorName: 'Ironclad',
  competitorOneLiner:
    'Established enterprise CLM with a mature workflow engine, broad lifecycle coverage, and an AI assistant called Jurist. A common choice for large legal-ops teams.',
  tldr:
    'draftLegal and Ironclad both cover the full contract lifecycle. The decision usually comes down to deployment posture: draftLegal is AGPL-3.0 licensed and self-hostable so your security team can read every line and your contracts can stay in your VPC. Ironclad is a mature managed product with a long track record. Pick whichever model fits your risk appetite.',
  pickDraftLegalIf: [
    'You need to read every line of code your CLM runs before deploying it',
    'Your security team requires self-host or single-tenant cloud',
    'You want to bring your own AI provider keys per agent',
    'You want a roadmap that emphasises procurement integration (POs, vendor onboarding, spend approvals — see /product)',
    'You are early in your CLM journey and want a free path to evaluate',
  ],
  pickCompetitorIf: [
    'You want a mature managed product with a long enterprise track record',
    'Your team is already standardised on the Ironclad workflow builder',
    'You need a vendor with established Gartner / analyst coverage for procurement-sign-off',
  ],
  migration:
    'Ironclad exports contract metadata and PDFs in standard formats. draftLegal\'s bulk import maps your records into our universal + type-specific schemas, and our team can help with templates and approval rules. Effort depends on your portfolio size.',
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
        { label: 'AI assistant for review / drafting', draftLegal: 'yes', competitor: 'yes', note: 'Jurist' },
      ],
    },
    {
      title: 'Lifecycle coverage (both products cover the lifecycle)',
      rows: [
        { label: 'Intake / request', draftLegal: 'yes', competitor: 'yes' },
        { label: 'Drafting from playbook + templates', draftLegal: 'yes', competitor: 'yes' },
        { label: 'Counterparty redline analysis', draftLegal: 'yes', competitor: 'yes' },
        { label: 'Approval workflows', draftLegal: 'yes', competitor: 'yes' },
        { label: 'eSignature', draftLegal: 'yes', competitor: 'partial', note: 'Ironclad integrates external e-sign vendors' },
        { label: 'Obligation / renewal tracking', draftLegal: 'yes', competitor: 'yes' },
      ],
    },
    {
      title: 'Pricing posture',
      rows: [
        { label: 'Pricing published on website', draftLegal: 'yes', competitor: 'no' },
      ],
    },
  ],
}
