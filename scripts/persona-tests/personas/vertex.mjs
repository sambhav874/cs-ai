/**
 * Vertex Cloud — Series C SaaS, sales-led. 11 multi-turn conversations
 * spanning the 7-type taxonomy from the original plan §Phase 4.
 */
import { TAXONOMY } from '../lib-multi.mjs'

const SEARCH = ['contract_search', 'portfolio_search']
const COUNTERPARTY = ['counterparty_get', 'counterparty_memory', ...SEARCH]
const ANY_RETRIEVAL = [...COUNTERPARTY, 'matter_list', 'approval_list', 'renewal_advice']

export default {
  persona: 'vertex-cloud',
  primaryUser: 'maya.chen@vertex.cloud',
  conversations: [
    // ── Single-shot retrieval ─────────────────────────────────────────
    {
      id: 'vertex-001-single-expiring',
      type: TAXONOMY.SINGLE,
      user: 'maya.chen@vertex.cloud',
      title: 'NDAs expiring in next 30 days',
      turns: [{
        ask: 'Show me all NDAs expiring in the next 30 days.',
        expect: {
          expectedTools: [...SEARCH, 'renewal_advice'],
          mustMentionAny: ['nda', 'non-disclosure', 'expir', 'no contracts', 'no nda'],
          maxLatencyMs: 60_000,
          minReplyChars: 60,
        },
      }],
    },
    {
      id: 'vertex-002-single-snowflake',
      type: TAXONOMY.SINGLE,
      user: 'maya.chen@vertex.cloud',
      title: 'Total exposure with Snowflake',
      turns: [{
        ask: 'What is our total exposure with Snowflake across all contracts?',
        expect: {
          expectedTools: COUNTERPARTY,
          mustMentionAny: ['snowflake'],
          maxLatencyMs: 60_000,
        },
      }],
    },

    // ── Multi-turn narrowing ──────────────────────────────────────────
    {
      id: 'vertex-003-narrow-snowflake',
      type: TAXONOMY.NARROW,
      user: 'priya.patel@vertex.cloud',
      title: 'Snowflake → MSAs only → total value',
      turns: [
        {
          ask: 'Show me all our Snowflake contracts.',
          expect: {
            expectedTools: SEARCH,
            mustMentionAny: ['snowflake'],
            maxLatencyMs: 60_000,
          },
        },
        {
          ask: 'Of those, just the MSAs.',
          expect: {
            mustMentionAny: ['msa', 'master service'],
            contextWords: ['snowflake'],
            maxLatencyMs: 60_000,
          },
        },
        {
          ask: 'What is the total value of those MSAs?',
          expect: {
            mustMentionAny: ['$', 'total', 'value', 'no value', 'unknown'],
            contextWords: ['snowflake', 'msa'],
            maxLatencyMs: 60_000,
          },
        },
      ],
    },

    // ── Multi-turn drill-in ───────────────────────────────────────────
    {
      id: 'vertex-004-drill-dpa',
      type: TAXONOMY.DRILL,
      user: 'maya.chen@vertex.cloud',
      title: 'DPAs without sub-processor list → drill into top one',
      turns: [
        {
          ask: 'Find any Data Processing Addenda that do not list a sub-processor.',
          expect: {
            expectedTools: SEARCH,
            mustMentionAny: ['dpa', 'data processing'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'Tell me more about the first one — counterparty, governing law, term.',
          expect: {
            expectedTools: ['contract_get', ...SEARCH],
            cumulativeTools: true,
            mustMentionAny: ['governing', 'term', 'counterparty', 'data processing', 'dpa'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
            minReplyChars: 80,
          },
        },
        {
          ask: 'What does it say about breach notification timing?',
          expect: {
            mustMentionAny: ['breach', 'notification', 'days', 'no breach', 'not specified'],
            contextWords: ['dpa', 'data processing'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
      ],
    },

    // ── Cross-entity aggregation ──────────────────────────────────────
    {
      id: 'vertex-005-aggregate-vendors',
      type: TAXONOMY.AGGREGATE,
      user: 'david.kim@vertex.cloud',
      title: 'Top 5 vendors by spend',
      turns: [{
        ask: 'List our top 5 vendor counterparties by total contract value, with each one\'s contract count.',
        expect: {
          expectedTools: COUNTERPARTY,
          mustMentionAny: ['top', 'vendor', '$', 'total', 'no vendor'],
          maxLatencyMs: 90_000,
          minReplyChars: 100,
        },
      }],
    },

    // ── Action-oriented (draft) ───────────────────────────────────────
    {
      id: 'vertex-006-action-draft-nda',
      type: TAXONOMY.ACTION_DRAFT,
      user: 'priya.patel@vertex.cloud',
      title: 'Draft NDA for Plaid',
      turns: [
        {
          ask: 'Draft a mutual NDA for Plaid. 2-year term, California governing law.',
          expect: {
            expectedTools: ['contract_create_from_template', ...SEARCH, 'counterparty_memory'],
            cumulativeTools: true,
            mustMentionAny: ['plaid', 'draft', 'nda'],
            notHallucinated: ['i have created', "i've created", 'has been created'],
            maxLatencyMs: 120_000,
          },
        },
        {
          ask: 'Update the term to 3 years and tell me the title of the draft.',
          expect: {
            mustMentionAny: ['3 year', 'three year', 'term', 'plaid', '3-year'],
            // Context words include the action vocabulary too — when the agent
            // tries redline_propose, the reply talks about "Agreement" or
            // "redline" rather than re-stating the counterparty name.
            contextWords: ['plaid', 'nda', 'agreement', 'term', 'redline', 'draft'],
            maxLatencyMs: 60_000,
          },
        },
      ],
    },

    // ── Action-oriented (compare/other) ───────────────────────────────
    {
      id: 'vertex-007-action-compare-stripe',
      type: TAXONOMY.ACTION_OTHER,
      user: 'priya.patel@vertex.cloud',
      title: 'Compare last two Stripe order forms',
      turns: [
        {
          ask: 'Show me our most recent Stripe order forms.',
          expect: {
            expectedTools: SEARCH,
            mustMentionAny: ['stripe', 'no stripe', 'no order'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'Compare the top two on payment terms and liability cap.',
          expect: {
            mustMentionAny: ['payment', 'liabil', 'cap', 'comparison', 'compare', 'no order', 'cannot compare'],
            contextWords: ['stripe'],
            maxLatencyMs: 90_000,
            gracefulEmptyOk: true,
            minReplyChars: 80,
          },
        },
      ],
    },

    // ── Approval-flow ─────────────────────────────────────────────────
    {
      id: 'vertex-008-approval-queue',
      type: TAXONOMY.APPROVAL,
      user: 'maya.chen@vertex.cloud',
      title: 'My approval queue → highest risk → recommendation',
      turns: [
        {
          ask: 'What approvals are awaiting my decision?',
          expect: {
            expectedTools: ['approval_list'],
            mustMentionAny: ['approval', 'queue', 'awaiting', 'pending', 'nothing', 'no approval'],
            maxLatencyMs: 60_000,
          },
        },
        {
          ask: 'Which one has the highest risk? What\'s the recommendation?',
          expect: {
            mustMentionAny: ['risk', 'recommend', 'approve', 'reject', 'review', 'nothing'],
            contextWords: ['approval', 'queue', 'awaiting', 'pending'],
            maxLatencyMs: 60_000,
          },
        },
      ],
    },

    // ── Long-context ──────────────────────────────────────────────────
    {
      id: 'vertex-009-longctx-stripe-history',
      type: TAXONOMY.LONG_CTX,
      user: 'priya.patel@vertex.cloud',
      title: 'Stripe relationship summary',
      turns: [{
        ask: 'Give me a full summary of our Stripe relationship — all contracts, key terms across them, total exposure, and any open risks.',
        expect: {
          expectedTools: COUNTERPARTY,
          mustMentionAny: ['stripe'],
          maxLatencyMs: 120_000,
          minReplyChars: 200,
        },
      }],
    },

    // ── Ambiguous / failure mode ──────────────────────────────────────
    {
      id: 'vertex-010-ambiguous-bigone',
      type: TAXONOMY.AMBIGUOUS,
      user: 'maya.chen@vertex.cloud',
      title: 'Ambiguous reference — "the big one"',
      turns: [{
        ask: 'Find the big one we did with the bank last year.',
        expect: {
          // Either it asks for clarification OR runs a search and presents candidates.
          // Both are acceptable; what's NOT acceptable is hallucinating a result.
          expectedTools: SEARCH,
          mustMentionAny: ['which', 'clarif', 'specify', 'bank', 'no bank', 'first national', 'svb', 'mercury'],
          maxLatencyMs: 60_000,
        },
      }],
    },
    {
      id: 'vertex-011-failure-fakecp',
      type: TAXONOMY.AMBIGUOUS,
      user: 'maya.chen@vertex.cloud',
      title: 'Failure mode — fake counterparty',
      turns: [{
        ask: 'What contracts do we have with NoSuchVendor Inc?',
        expect: {
          // Match common "we don't have any X" / "no prior X" phrasings.
          // Substring match — substrings need to actually appear contiguous.
          acknowledgedEmpty: true,  // accept any 'we don't have / couldn't find' phrasing
          maxLatencyMs: 60_000,
        },
      }],
    },
  ],
}
