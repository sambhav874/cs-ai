/**
 * Ironbridge Industrial — PE-backed manufacturer. Procurement-heavy.
 * Supplier MSAs + SOWs + RFP-tied + M&A NDAs. 250 contracts seeded.
 * 11 multi-turn conversations across the 7-type taxonomy.
 */
import { TAXONOMY } from '../lib-multi.mjs'

const SEARCH = ['contract_search', 'portfolio_search']
const COUNTERPARTY = ['counterparty_get', 'counterparty_memory', ...SEARCH]
const MATTER = ['matter_list', ...SEARCH]

export default {
  persona: 'ironbridge-industrial',
  primaryUser: 'margaret.obrien@ironbridge-ind.com',
  conversations: [
    // ── Single-shot ──────────────────────────────────────────────
    {
      id: 'ironbridge-001-single-arcelor-exposure',
      type: TAXONOMY.SINGLE,
      user: 'margaret.obrien@ironbridge-ind.com',
      title: 'Total ArcelorMittal exposure',
      turns: [{
        ask: 'What is our total supplier exposure with ArcelorMittal across all contracts?',
        expect: {
          expectedTools: COUNTERPARTY,
          mustMentionAny: ['arcelormittal', 'arcelor'],
          maxLatencyMs: 90_000,
        },
      }],
    },
    {
      id: 'ironbridge-002-single-force-majeure',
      type: TAXONOMY.SINGLE,
      user: 'carla.mendez@ironbridge-ind.com',
      title: 'Suppliers with force-majeure tariff exclusions',
      turns: [{
        ask: 'Find all supplier agreements where force-majeure clauses exclude tariffs.',
        expect: {
          expectedTools: [...SEARCH, 'clause_search'],
          mustMentionAny: ['force majeure', 'tariff', 'no force', 'no clause'],
          maxLatencyMs: 90_000,
        },
      }],
    },

    // ── Multi-turn narrowing ────────────────────────────────────
    {
      id: 'ironbridge-003-narrow-akron',
      type: TAXONOMY.NARROW,
      user: 'olivia.brennan@ironbridge-ind.com',
      title: 'Akron contracts → vendor MSAs → expiring soon',
      turns: [
        {
          ask: 'Show me all contracts associated with the Akron plant.',
          expect: {
            expectedTools: SEARCH,
            mustMentionAny: ['akron', 'no contract', 'plant'],
            maxLatencyMs: 60_000,
          },
        },
        {
          ask: 'Of those, only the supplier agreements.',
          expect: {
            mustMentionAny: ['supplier', 'vendor', 'no supplier'],
            contextWords: ['akron'],
            maxLatencyMs: 60_000,
          },
        },
        {
          ask: 'Which expire in the next 90 days?',
          expect: {
            mustMentionAny: ['expir', '90', 'days', 'no expir', 'none'],
            contextWords: ['akron', 'supplier'],
            maxLatencyMs: 60_000,
          },
        },
      ],
    },

    // ── Multi-turn drill-in ─────────────────────────────────────
    {
      id: 'ironbridge-004-drill-acquisition',
      type: TAXONOMY.DRILL,
      user: 'james.wright@ironbridge-ind.com',
      title: 'Project Beacon acquisition matter → details',
      turns: [
        {
          ask: 'What is the status of the Project Beacon acquisition matter?',
          expect: {
            expectedTools: MATTER,
            mustMentionAny: ['beacon', 'project', 'acquisition', 'no matter', 'matter'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'List the contracts inside that matter.',
          expect: {
            expectedTools: [...MATTER, 'contract_search'],
            cumulativeTools: true,
            mustMentionAny: ['contract', 'beacon', 'loi', 'nda', 'no contract'],
            contextWords: ['beacon'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'What does the LOI say about the proposed transaction value?',
          expect: {
            mustMentionAny: ['transaction', 'value', '$', 'no loi', 'not specified', 'price', 'purchase'],
            // Accept "letter of intent" as same-meaning context retention.
            contextWords: ['beacon', 'loi', 'letter of intent', 'acquisition'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
      ],
    },

    // ── Cross-entity aggregation ────────────────────────────────
    {
      id: 'ironbridge-005-aggregate-concentration',
      type: TAXONOMY.AGGREGATE,
      user: 'raj.sharma@ironbridge-ind.com',
      title: 'Supplier concentration risk — top by spend',
      turns: [{
        ask: 'List our top 5 suppliers by total contract value with the dollar amount and contract count for each.',
        expect: {
          expectedTools: COUNTERPARTY,
          mustMentionAny: ['top', '$', 'supplier', 'arcelor', 'nucor', 'honeywell', 'eaton', 'no supplier'],
          maxLatencyMs: 90_000,
          minReplyChars: 100,
        },
      }],
    },

    // ── Action-oriented (draft) ─────────────────────────────────
    {
      id: 'ironbridge-006-action-draft-vendor',
      type: TAXONOMY.ACTION_DRAFT,
      user: 'carla.mendez@ironbridge-ind.com',
      title: 'Draft vendor agreement for Schneider Electric',
      turns: [
        {
          ask: 'Draft a vendor agreement for Schneider Electric. Net-30 payment, 1-year term.',
          expect: {
            expectedTools: ['contract_create_from_template', ...SEARCH, 'counterparty_memory'],
            cumulativeTools: true,
            mustMentionAny: ['schneider', 'vendor', 'draft'],
            notHallucinated: ['has been created', 'i have created', "i've created"],
            maxLatencyMs: 120_000,
          },
        },
      ],
    },

    // ── Action-oriented (compare) ───────────────────────────────
    {
      id: 'ironbridge-007-action-compare-steel',
      type: TAXONOMY.ACTION_OTHER,
      user: 'carla.mendez@ironbridge-ind.com',
      title: 'Compare ArcelorMittal vs Nucor on price escalation',
      turns: [
        {
          ask: 'Pull our most-recent supplier agreements with ArcelorMittal and Nucor.',
          expect: {
            // counterparty_memory is valid retrieval for "pull X with [counterparty]"
            expectedTools: [...SEARCH, 'counterparty_memory'],
            mustMentionAny: ['arcelor', 'nucor'],
            maxLatencyMs: 90_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'Compare them on price escalation and force-majeure terms.',
          expect: {
            mustMentionAny: ['price', 'escalat', 'force majeure', 'compar', 'similar', 'differ', 'cannot'],
            contextWords: ['arcelor', 'nucor'],
            maxLatencyMs: 90_000,
            gracefulEmptyOk: true,
            minReplyChars: 100,
          },
        },
      ],
    },

    // ── Approval-flow ───────────────────────────────────────────
    {
      id: 'ironbridge-008-approval-margaret',
      type: TAXONOMY.APPROVAL,
      user: 'margaret.obrien@ironbridge-ind.com',
      title: 'GC approval queue → details on top one',
      turns: [
        {
          ask: 'What is in my approval queue?',
          expect: {
            expectedTools: ['approval_list'],
            mustMentionAny: ['approval', 'queue', 'awaiting', 'pending', 'nothing', 'no approval'],
            maxLatencyMs: 60_000,
          },
        },
        {
          ask: 'Tell me about the highest-value one — counterparty, value, key risks.',
          expect: {
            mustMentionAny: ['counterparty', 'value', 'risk', '$', 'no approval'],
            contextWords: ['approval', 'queue', 'pending'],
            maxLatencyMs: 60_000,
          },
        },
      ],
    },

    // ── Long-context ────────────────────────────────────────────
    {
      id: 'ironbridge-009-longctx-arcelor-history',
      type: TAXONOMY.LONG_CTX,
      user: 'margaret.obrien@ironbridge-ind.com',
      title: 'ArcelorMittal full history',
      turns: [{
        ask: 'Give me a complete history of our ArcelorMittal relationship — every supplier agreement, MSA, NDA, with key terms across all of them and our total exposure.',
        expect: {
          expectedTools: COUNTERPARTY,
          mustMentionAny: ['arcelor'],
          maxLatencyMs: 120_000,
          minReplyChars: 200,
        },
      }],
    },

    // ── Ambiguous / failure ─────────────────────────────────────
    {
      id: 'ironbridge-010-ambiguous-steel',
      type: TAXONOMY.AMBIGUOUS,
      user: 'carla.mendez@ironbridge-ind.com',
      title: 'Ambiguous — "the steel one"',
      turns: [{
        ask: 'Pull up the steel one we did with the big mill last year.',
        expect: {
          expectedTools: SEARCH,
          mustMentionAny: ['which', 'specify', 'clarify', 'arcelor', 'nucor', 'us steel', 'steel dynamics', 'no steel'],
          maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
        },
      }],
    },
    {
      id: 'ironbridge-011-failure-nofake',
      type: TAXONOMY.AMBIGUOUS,
      user: 'olivia.brennan@ironbridge-ind.com',
      title: 'Failure mode — fake supplier',
      turns: [{
        ask: 'What contracts do we have with FictionalSupplier Inc?',
        expect: {
          acknowledgedEmpty: true,  // accept any 'we don't have / couldn't find' phrasing
          maxLatencyMs: 60_000,
        },
      }],
    },
  ],
}
