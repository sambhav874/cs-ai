/**
 * Caldera Health — mid-market health SaaS. BAA + DPA + MSA heavy.
 * Compliance-driven, HIPAA Business Associate.
 * 11 multi-turn conversations across the 7-type taxonomy.
 */
import { TAXONOMY } from '../lib-multi.mjs'

const SEARCH = ['contract_search', 'portfolio_search']
const COUNTERPARTY = ['counterparty_get', 'counterparty_memory', ...SEARCH]
const ANY_RETRIEVAL = [...COUNTERPARTY, 'matter_list', 'approval_list']

export default {
  persona: 'caldera-health',
  primaryUser: 'lena.park@calderahealth.com',
  conversations: [
    // ── Single-shot ─────────────────────────────────────────────────
    {
      id: 'caldera-001-single-baa-current',
      type: TAXONOMY.SINGLE,
      user: 'lena.park@calderahealth.com',
      title: 'BAAs current with HIPAA',
      turns: [{
        ask: 'Are all our Business Associate Agreements current and compliant with HIPAA?',
        expect: {
          expectedTools: [...SEARCH, 'playbook_check'],
          mustMentionAny: ['baa', 'business associate', 'hipaa'],
          maxLatencyMs: 90_000,
        },
      }],
    },
    {
      id: 'caldera-002-single-mayo-status',
      type: TAXONOMY.SINGLE,
      user: 'marcus.hall@calderahealth.com',
      title: 'Most recent Ascension BAA status',
      turns: [{
        ask: 'Find the most-recent BAA we signed with Ascension and tell me its current status.',
        expect: {
          expectedTools: [...SEARCH, 'counterparty_memory'],
          mustMentionAny: ['ascension', 'baa', 'no baa', 'no contract'],
          maxLatencyMs: 60_000,
        },
      }],
    },

    // ── Multi-turn narrowing ──────────────────────────────────────
    {
      id: 'caldera-003-narrow-pfizer',
      type: TAXONOMY.NARROW,
      user: 'lena.park@calderahealth.com',
      title: 'Pfizer contracts → only DPAs → terms',
      turns: [
        {
          ask: 'Show me all our Pfizer contracts.',
          expect: {
            expectedTools: SEARCH,
            mustMentionAny: ['pfizer'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'Just the Data Processing ones.',
          expect: {
            mustMentionAny: ['data processing', 'dpa', 'no data processing'],
            contextWords: ['pfizer'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'What is the breach notification timeline in those?',
          expect: {
            mustMentionAny: ['breach', 'notif', 'days', 'no breach', 'not specified'],
            contextWords: ['pfizer', 'data processing', 'dpa'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
      ],
    },

    // ── Multi-turn drill-in ───────────────────────────────────────
    {
      id: 'caldera-004-drill-mayo-msa',
      type: TAXONOMY.DRILL,
      user: 'lena.park@calderahealth.com',
      title: 'Mayo Clinic MSA → terms → indemnification',
      turns: [
        {
          ask: 'Pull the latest Mayo Clinic MSA we have on file.',
          expect: {
            expectedTools: [...SEARCH, 'counterparty_memory'],
            mustMentionAny: ['mayo'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'What is the liability cap and governing law?',
          expect: {
            expectedTools: ['contract_get', ...SEARCH],
            cumulativeTools: true,
            mustMentionAny: ['liabil', 'cap', 'govern', 'law', 'no liabil', 'not specified'],
            contextWords: ['mayo'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'Does it require sub-processor disclosure?',
          expect: {
            mustMentionAny: ['sub-processor', 'sub processor', 'subcontractor', 'disclosure', 'no sub', 'not require'],
            contextWords: ['mayo'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
      ],
    },

    // ── Cross-entity aggregation ──────────────────────────────────
    {
      id: 'caldera-005-aggregate-subprocessors',
      type: TAXONOMY.AGGREGATE,
      user: 'marcus.hall@calderahealth.com',
      title: 'All sub-processors across DPAs',
      turns: [{
        ask: 'List every sub-processor that appears in any of our DPAs.',
        expect: {
          expectedTools: SEARCH,
          mustMentionAny: ['sub-processor', 'sub processor', 'aws', 'datavant', 'snowflake', 'no sub', 'not listed'],
          maxLatencyMs: 90_000,
          minReplyChars: 80,
        },
      }],
    },

    // ── Action-oriented (draft) ───────────────────────────────────
    {
      id: 'caldera-006-action-draft-baa',
      type: TAXONOMY.ACTION_DRAFT,
      user: 'aisha.yusuf@calderahealth.com',
      title: 'Draft BAA for Genentech',
      turns: [
        {
          ask: 'Draft a BAA for Genentech using our standard template.',
          expect: {
            // Caldera doesn't have a BAA template (only NDA/MSA/SOW seeded).
            // The agent should EITHER call contract_create_from_template AND
            // get NO_TEMPLATE_MATCH, OR honestly say "no BAA template yet".
            // What it must NOT do is hallucinate "I created the BAA".
            expectedTools: ['contract_create_from_template', ...SEARCH, 'counterparty_memory'],
            cumulativeTools: true,
            mustMentionAny: ['genentech', 'baa', 'business associate', 'template', 'no template'],
            notHallucinated: ['has been created', 'i have created', "i've created"],
            maxLatencyMs: 120_000,
          },
        },
      ],
    },

    // ── Action-oriented (compare) ─────────────────────────────────
    {
      id: 'caldera-007-action-compare-hospitals',
      type: TAXONOMY.ACTION_OTHER,
      user: 'lena.park@calderahealth.com',
      title: 'Compare Mayo vs Cleveland Clinic MSAs',
      turns: [
        {
          ask: 'Pull our most-recent MSA with Mayo Clinic and our most-recent MSA with Cleveland Clinic.',
          expect: {
            expectedTools: SEARCH,
            mustMentionAny: ['mayo', 'cleveland'],
            maxLatencyMs: 90_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'Compare them on liability cap and audit rights.',
          expect: {
            mustMentionAny: ['liabil', 'cap', 'audit', 'compare', 'difference', 'similar', 'cannot'],
            contextWords: ['mayo', 'cleveland'],
            maxLatencyMs: 90_000,
            gracefulEmptyOk: true,
            minReplyChars: 100,
          },
        },
      ],
    },

    // ── Approval-flow ─────────────────────────────────────────────
    {
      id: 'caldera-008-approval-marcus',
      type: TAXONOMY.APPROVAL,
      user: 'marcus.hall@calderahealth.com',
      title: 'Privacy queue → highest risk → recommendation',
      turns: [
        {
          ask: 'What is in my privacy approval queue?',
          expect: {
            expectedTools: ['approval_list'],
            mustMentionAny: ['approval', 'queue', 'pending', 'awaiting', 'nothing', 'no approval'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'Tell me about the highest-risk one in detail and what you recommend.',
          expect: {
            mustMentionAny: ['risk', 'recommend', 'approve', 'reject', 'review', 'nothing'],
            contextWords: ['approval', 'queue', 'pending'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
      ],
    },

    // ── Long-context ──────────────────────────────────────────────
    {
      id: 'caldera-009-longctx-pfizer-summary',
      type: TAXONOMY.LONG_CTX,
      user: 'lena.park@calderahealth.com',
      title: 'Pfizer relationship summary',
      turns: [{
        ask: 'Give me a full summary of our Pfizer relationship — every contract, key terms, risks, and total exposure.',
        expect: {
          expectedTools: COUNTERPARTY,
          mustMentionAny: ['pfizer'],
          maxLatencyMs: 120_000,
          minReplyChars: 200,
        },
      }],
    },

    // ── Ambiguous / failure ───────────────────────────────────────
    {
      id: 'caldera-010-ambiguous-bighospital',
      type: TAXONOMY.AMBIGUOUS,
      user: 'lena.park@calderahealth.com',
      title: 'Ambiguous reference — "the big hospital BAA"',
      turns: [{
        ask: 'Pull the BAA we signed last year with the big hospital.',
        expect: {
          expectedTools: SEARCH,
          // Acceptable: agent asks for clarification OR confidently picks a
          // specific BAA candidate from the org's portfolio. Either is good
          // behaviour. Reject only if it makes up a fake hospital name.
          mustMentionAny: [
            'which', 'clarify', 'specify',
            'mayo', 'cleveland', 'kaiser', 'ascension', 'pfizer',
            'business associate', 'baa', 'no baa',
          ],
          maxLatencyMs: 60_000,
        },
      }],
    },
    {
      id: 'caldera-011-failure-nohospital',
      type: TAXONOMY.AMBIGUOUS,
      user: 'lena.park@calderahealth.com',
      title: 'Failure mode — fake hospital',
      turns: [{
        ask: 'What contracts do we have with NoSuchHospital Health System?',
        expect: {
          acknowledgedEmpty: true,  // accept any 'we don't have / couldn't find' phrasing
          maxLatencyMs: 60_000,
        },
      }],
    },
  ],
}
