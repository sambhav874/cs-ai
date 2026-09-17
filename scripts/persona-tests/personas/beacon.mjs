/**
 * Beacon Logistics — mid-market 3PL. 200 contracts: Customer SLA, Carrier
 * Agreement, Vendor MSA, Lease. Hub-clustered (Memphis/Atlanta/Dallas/etc.).
 * 11 multi-turn conversations across the 7-type taxonomy.
 */
import { TAXONOMY } from '../lib-multi.mjs'

const SEARCH = ['contract_search', 'portfolio_search']
const COUNTERPARTY = ['counterparty_get', 'counterparty_memory', ...SEARCH]
const MATTER = ['matter_list', ...SEARCH]

export default {
  persona: 'beacon-logistics',
  primaryUser: 'dean.whitfield@beaconlogistics.com',
  conversations: [
    // ── Single-shot ─────────────────────────────────────────────
    {
      id: 'beacon-001-single-fuel-surcharge',
      type: TAXONOMY.SINGLE,
      user: 'chris.park@beaconlogistics.com',
      title: 'Carrier agreements with fuel surcharge cap',
      turns: [{
        ask: 'Show all carrier agreements that include a fuel surcharge cap clause.',
        expect: {
          expectedTools: [...SEARCH, 'clause_search'],
          mustMentionAny: ['carrier', 'fuel', 'surcharge', 'no carrier', 'no clause'],
          maxLatencyMs: 90_000,
        },
      }],
    },
    {
      id: 'beacon-002-single-walmart-cap',
      type: TAXONOMY.SINGLE,
      user: 'hannah.rivera@beaconlogistics.com',
      title: 'Walmart liability cap',
      turns: [{
        ask: 'What is our liability cap on the Walmart agreement?',
        expect: {
          expectedTools: COUNTERPARTY,
          mustMentionAny: ['walmart', 'liabil', 'cap', '$', 'no walmart', 'not specified'],
          maxLatencyMs: 60_000,
        },
      }],
    },

    // ── Multi-turn narrowing ────────────────────────────────────
    {
      id: 'beacon-003-narrow-ocean',
      type: TAXONOMY.NARROW,
      user: 'chris.park@beaconlogistics.com',
      title: 'Ocean carriers → expiring → Maersk specifically',
      turns: [
        {
          ask: 'Show me all our ocean carrier agreements.',
          expect: {
            expectedTools: SEARCH,
            mustMentionAny: ['ocean', 'maersk', 'msc', 'cma cgm', 'zim', 'no ocean'],
            maxLatencyMs: 60_000,
          },
        },
        {
          ask: 'Which expire in the next 6 months?',
          expect: {
            mustMentionAny: ['expir', 'months', '6', 'six', 'no expir', 'none'],
            contextWords: ['ocean', 'carrier'],
            maxLatencyMs: 60_000,
          },
        },
        {
          ask: 'For Maersk specifically, what is the volume commitment?',
          expect: {
            mustMentionAny: ['maersk', 'volume', 'commit', 'no commit', 'not specified', 'no maersk'],
            // Maersk IS an ocean carrier; reply mentioning Maersk = context kept.
            contextWords: ['ocean', 'maersk', 'carrier', 'transportation'],
            maxLatencyMs: 60_000,
          },
        },
      ],
    },

    // ── Multi-turn drill-in ─────────────────────────────────────
    {
      id: 'beacon-004-drill-memphis-leases',
      type: TAXONOMY.DRILL,
      user: 'dean.whitfield@beaconlogistics.com',
      title: 'Memphis hub leases → expiring → renewal recommendation',
      turns: [
        {
          ask: 'Find all our warehouse leases at the Memphis hub.',
          expect: {
            expectedTools: SEARCH,
            mustMentionAny: ['memphis', 'lease', 'no memphis', 'no lease'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'Which expire in the next 12 months?',
          expect: {
            mustMentionAny: ['expir', 'month', 'no expir', '12'],
            contextWords: ['memphis', 'lease'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'For each, give me a renew/renegotiate recommendation.',
          expect: {
            expectedTools: ['renewal_advice', ...SEARCH],
            cumulativeTools: true,
            mustMentionAny: ['renew', 'renegot', 'expire', 'recommend'],
            contextWords: ['memphis', 'lease'],
            maxLatencyMs: 90_000,
            gracefulEmptyOk: true,
          },
        },
      ],
    },

    // ── Cross-entity aggregation ────────────────────────────────
    {
      id: 'beacon-005-aggregate-audit-rights',
      type: TAXONOMY.AGGREGATE,
      user: 'eli.tran@beaconlogistics.com',
      title: 'All contracts with audit rights',
      turns: [{
        ask: 'List every contract that grants the customer audit rights, with the audit-frequency limit if specified.',
        expect: {
          expectedTools: [...SEARCH, 'clause_search'],
          mustMentionAny: ['audit', 'right', 'no audit', 'frequency'],
          maxLatencyMs: 90_000,
        },
      }],
    },

    // ── Action-oriented (draft) ─────────────────────────────────
    {
      id: 'beacon-006-action-draft-carrier',
      type: TAXONOMY.ACTION_DRAFT,
      user: 'chris.park@beaconlogistics.com',
      title: 'Draft carrier agreement for Crowley Maritime',
      turns: [
        {
          ask: 'Draft a carrier agreement for Crowley Maritime. Cap fuel surcharge at 12%, 1-year term.',
          expect: {
            expectedTools: ['contract_create_from_template', ...SEARCH, 'counterparty_memory'],
            cumulativeTools: true,
            mustMentionAny: ['crowley', 'carrier', 'draft'],
            notHallucinated: ['has been created', 'i have created', "i've created"],
            maxLatencyMs: 120_000,
          },
        },
      ],
    },

    // ── Action-oriented (compare) ───────────────────────────────
    {
      id: 'beacon-007-action-compare-trucking',
      type: TAXONOMY.ACTION_OTHER,
      user: 'chris.park@beaconlogistics.com',
      title: 'Compare top truck carriers on cargo liability',
      turns: [
        {
          ask: 'Pull our most-recent agreements with J.B. Hunt and Schneider National.',
          expect: {
            // counterparty_memory is a perfectly valid retrieval choice for
            // "pull all our X with [counterparty]" — returns deals + summary.
            expectedTools: [...SEARCH, 'counterparty_memory'],
            mustMentionAny: ['j.b.', 'jb hunt', 'schneider', 'hunt'],
            maxLatencyMs: 90_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'Compare them on cargo liability and indemnification.',
          expect: {
            mustMentionAny: ['cargo', 'liabil', 'indemn', 'compar', 'similar', 'differ'],
            contextWords: ['hunt', 'schneider'],
            maxLatencyMs: 90_000,
            gracefulEmptyOk: true,
            minReplyChars: 100,
          },
        },
      ],
    },

    // ── Approval-flow ───────────────────────────────────────────
    {
      id: 'beacon-008-approval-team',
      type: TAXONOMY.APPROVAL,
      user: 'dean.whitfield@beaconlogistics.com',
      title: 'GC + customer-side queues',
      turns: [
        {
          ask: 'What approvals are awaiting my decision?',
          expect: {
            expectedTools: ['approval_list'],
            mustMentionAny: ['approval', 'queue', 'pending', 'nothing', 'no approval'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
        {
          ask: 'Which one has the highest dollar value? Tell me the key risks.',
          expect: {
            mustMentionAny: ['$', 'value', 'risk', 'highest', 'no approval'],
            // Reply naturally talks about "the contract with the highest dollar
            // value" — accept "contract" as context kept (the agent is still
            // answering about approval-queue items, just by their contract names).
            contextWords: ['approval', 'queue', 'pending', 'contract', 'highest', '$'],
            maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
          },
        },
      ],
    },

    // ── Long-context ────────────────────────────────────────────
    {
      id: 'beacon-009-longctx-walmart-history',
      type: TAXONOMY.LONG_CTX,
      user: 'hannah.rivera@beaconlogistics.com',
      title: 'Walmart relationship summary',
      turns: [{
        ask: 'Give me a full summary of our Walmart relationship — every SLA and carrier agreement, key terms across all of them, total annual contract value, peak-season commitments.',
        expect: {
          expectedTools: COUNTERPARTY,
          mustMentionAny: ['walmart'],
          maxLatencyMs: 120_000,
          minReplyChars: 200,
        },
      }],
    },

    // ── Ambiguous / failure ─────────────────────────────────────
    {
      id: 'beacon-010-ambiguous-trucking',
      type: TAXONOMY.AMBIGUOUS,
      user: 'chris.park@beaconlogistics.com',
      title: 'Ambiguous — "the trucking one with that big customer"',
      turns: [{
        ask: 'Pull up the trucking one we did with the big retail customer last quarter.',
        expect: {
          expectedTools: SEARCH,
          mustMentionAny: ['which', 'specify', 'clarify', 'walmart', 'target', 'amazon', 'costco', 'no trucking'],
          maxLatencyMs: 60_000,
            gracefulEmptyOk: true,
        },
      }],
    },
    {
      id: 'beacon-011-failure-fakecarrier',
      type: TAXONOMY.AMBIGUOUS,
      user: 'chris.park@beaconlogistics.com',
      title: 'Failure mode — fake carrier',
      turns: [{
        ask: 'What contracts do we have with NotARealCarrier Logistics?',
        expect: {
          acknowledgedEmpty: true,  // accept any 'we don't have / couldn't find' phrasing
          maxLatencyMs: 60_000,
        },
      }],
    },
  ],
}
