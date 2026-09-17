/**
 * Lumen Bio — Series A biotech, 80 emp, solo legal team. IP-heavy.
 * 80 contracts: NDA/CDA + research collab + MTA + CRO MSA + IP assignment.
 * 11 multi-turn conversations across the 7-type taxonomy.
 */
import { TAXONOMY } from '../lib-multi.mjs'

const SEARCH = ['contract_search', 'portfolio_search']
const COUNTERPARTY = ['counterparty_get', 'counterparty_memory', ...SEARCH]
const MATTER = ['matter_list', ...SEARCH]

export default {
  persona: 'lumen-bio',
  primaryUser: 'aria.volkov@lumenbio.com',
  conversations: [
    // ── Single-shot ─────────────────────────────────────────────
    {
      id: 'lumen-001-single-research-ip',
      type: TAXONOMY.SINGLE,
      user: 'aria.volkov@lumenbio.com',
      title: 'Research agreements with university IP carve-outs',
      turns: [{
        ask: 'Show me all sponsored research agreements that have university IP carve-outs.',
        expect: {
          expectedTools: [...SEARCH, 'clause_search'],
          mustMentionAny: ['research', 'ip', 'university', 'no research', 'no ip'],
          maxLatencyMs: 90_000,
        },
      }],
    },
    {
      id: 'lumen-002-single-cda-pfizer',
      type: TAXONOMY.SINGLE,
      user: 'aria.volkov@lumenbio.com',
      title: 'CDA with Pfizer expiry',
      turns: [{
        ask: 'When does our CDA with Pfizer expire?',
        expect: {
          expectedTools: COUNTERPARTY,
          mustMentionAny: ['pfizer', 'cda', 'expir', 'no cda'],
          maxLatencyMs: 60_000,
        },
      }],
    },

    // ── Multi-turn narrowing ────────────────────────────────────
    {
      id: 'lumen-003-narrow-cro',
      type: TAXONOMY.NARROW,
      user: 'aria.volkov@lumenbio.com',
      title: 'CROs → Charles River → data ownership',
      turns: [
        {
          ask: 'Show me all our CRO agreements.',
          expect: {
            expectedTools: SEARCH,
            mustMentionAny: ['cro', 'charles river', 'icon', 'parexel', 'labcorp', 'no cro'],
            maxLatencyMs: 60_000,
          },
        },
        {
          ask: 'Just the Charles River ones.',
          expect: {
            mustMentionAny: ['charles river', 'no charles'],
            contextWords: ['cro'],
            maxLatencyMs: 60_000,
          },
        },
        {
          ask: 'What does the data ownership clause say in the most recent one?',
          expect: {
            mustMentionAny: ['data', 'ownership', 'own', 'no data', 'not specified'],
            contextWords: ['charles river'],
            maxLatencyMs: 60_000,
          },
        },
      ],
    },

    // ── Multi-turn drill-in ─────────────────────────────────────
    {
      id: 'lumen-004-drill-pfizer-collab',
      type: TAXONOMY.DRILL,
      user: 'aria.volkov@lumenbio.com',
      title: 'Pfizer collaboration matter → status → milestones',
      turns: [
        {
          ask: 'What is the status of the Pfizer Antibody Collaboration matter?',
          expect: {
            expectedTools: MATTER,
            mustMentionAny: ['pfizer', 'collaboration', 'antibody', 'matter', 'no matter'],
            maxLatencyMs: 60_000,
          },
        },
        {
          ask: 'List the contracts inside that matter.',
          expect: {
            cumulativeTools: true,
            expectedTools: [...MATTER, 'contract_search'],
            mustMentionAny: ['contract', 'cda', 'collab', 'no contract'],
            contextWords: ['pfizer', 'collab'],
            maxLatencyMs: 60_000,
          },
        },
        {
          ask: 'What financial milestones are in the term sheet?',
          expect: {
            mustMentionAny: ['milestone', 'payment', '$', 'no milestone', 'not specified', 'term sheet'],
            contextWords: ['pfizer'],
            maxLatencyMs: 60_000,
          },
        },
      ],
    },

    // ── Cross-entity aggregation ────────────────────────────────
    {
      id: 'lumen-005-aggregate-licenses',
      type: TAXONOMY.AGGREGATE,
      user: 'aria.volkov@lumenbio.com',
      title: 'Contracts where we granted exclusive license',
      turns: [{
        ask: 'List every contract where we granted exclusive license rights, with the counterparty and term length.',
        expect: {
          expectedTools: [...SEARCH, 'clause_search'],
          mustMentionAny: ['license', 'exclusive', 'no license', 'no exclusive'],
          maxLatencyMs: 90_000,
        },
      }],
    },

    // ── Action-oriented (draft) ─────────────────────────────────
    {
      id: 'lumen-006-action-draft-cda',
      type: TAXONOMY.ACTION_DRAFT,
      user: 'aria.volkov@lumenbio.com',
      title: 'Draft CDA for AstraZeneca',
      turns: [
        {
          ask: 'Draft a mutual CDA for AstraZeneca. Standard 2-year term, Massachusetts governing law.',
          expect: {
            expectedTools: ['contract_create_from_template', ...SEARCH, 'counterparty_memory'],
            cumulativeTools: true,
            mustMentionAny: ['astrazeneca', 'cda', 'confidential disclosure', 'draft'],
            notHallucinated: ['has been created', 'i have created', "i've created"],
            maxLatencyMs: 120_000,
          },
        },
      ],
    },

    // ── Action-oriented (compare) ───────────────────────────────
    {
      id: 'lumen-007-action-compare-cros',
      type: TAXONOMY.ACTION_OTHER,
      user: 'aria.volkov@lumenbio.com',
      title: 'Compare Charles River vs Labcorp on data ownership',
      turns: [
        {
          ask: 'Pull our most-recent MSA with Charles River and our most-recent MSA with Labcorp.',
          expect: {
            expectedTools: SEARCH,
            mustMentionAny: ['charles river', 'labcorp'],
            maxLatencyMs: 90_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'Compare them on data ownership and IP rights.',
          expect: {
            mustMentionAny: ['data', 'ownership', 'ip', 'compar', 'similar', 'differ'],
            contextWords: ['charles river', 'labcorp'],
            maxLatencyMs: 90_000,
            gracefulEmptyOk: true,
            minReplyChars: 100,
          },
        },
      ],
    },

    // ── Approval-flow ───────────────────────────────────────────
    {
      id: 'lumen-008-approval-aria-old',
      type: TAXONOMY.APPROVAL,
      user: 'aria.volkov@lumenbio.com',
      title: 'My queue + anything older than 5 days',
      turns: [
        {
          ask: 'What is in my approval queue?',
          expect: {
            expectedTools: ['approval_list'],
            mustMentionAny: ['approval', 'queue', 'pending', 'awaiting', 'nothing', 'no approval'],
            maxLatencyMs: 60_000,
          },
        },
        {
          ask: 'Anything in there older than 5 days I should escalate?',
          expect: {
            mustMentionAny: ['days', 'older', 'escalat', 'recent', 'no approval', 'nothing'],
            contextWords: ['approval', 'queue', 'pending'],
            maxLatencyMs: 60_000,
          },
        },
      ],
    },

    // ── Long-context ────────────────────────────────────────────
    {
      id: 'lumen-009-longctx-pfizer-all',
      type: TAXONOMY.LONG_CTX,
      user: 'aria.volkov@lumenbio.com',
      title: 'Full Pfizer-Lumen relationship summary',
      turns: [{
        ask: 'Give me a complete picture of our Pfizer relationship — every CDA, collaboration agreement, MTA, and amendment, plus any open obligations or risks.',
        expect: {
          expectedTools: COUNTERPARTY,
          mustMentionAny: ['pfizer'],
          maxLatencyMs: 120_000,
          minReplyChars: 200,
        },
      }],
    },

    // ── Ambiguous / failure ─────────────────────────────────────
    {
      id: 'lumen-010-ambiguous-academic',
      type: TAXONOMY.AMBIGUOUS,
      user: 'aria.volkov@lumenbio.com',
      title: 'Ambiguous — "the academic one"',
      turns: [{
        ask: 'Pull up the academic one we did with the university last year.',
        expect: {
          expectedTools: SEARCH,
          mustMentionAny: ['which', 'specify', 'clarify', 'stanford', 'mit', 'harvard', 'ucsf', 'no academic'],
          maxLatencyMs: 60_000,
        },
      }],
    },
    {
      id: 'lumen-011-failure-fakeacademic',
      type: TAXONOMY.AMBIGUOUS,
      user: 'aria.volkov@lumenbio.com',
      title: 'Failure mode — fake academic partner',
      turns: [{
        ask: 'What contracts do we have with FictionalU School of Medicine?',
        expect: {
          acknowledgedEmpty: true,  // accept any 'we don't have / couldn't find' phrasing
          maxLatencyMs: 60_000,
        },
      }],
    },
  ],
}
