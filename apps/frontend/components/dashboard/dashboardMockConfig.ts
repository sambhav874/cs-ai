/**
 * All editable numbers for the Project Dashboard mock data live in this file.
 * Nothing in here touches chart rendering — safe to tweak freely before the demo.
 *
 * Once real endpoints exist, `buildDataset()` in ProjectDashboard.tsx can be
 * swapped for an API call without needing to touch this file's shape much,
 * since the return type (DashboardDataset) stays the same either way.
 */

export type RangeKey = "today" | "week" | "month" | "quarter" | "year";

/* ------------------------------------------------------------------ */
/* 1. Category names — edit freely, order doesn't matter               */
/* ------------------------------------------------------------------ */

export const RULE_TYPES = [
  "Threshold",
  "Deadline",
  "Qualitative",
  "Tiered",
  "Composite",
  "Range",
] as const;

// Swap/rename sources here. Keep count consistent with RULE_TYPE_SPLIT length if you add rule types.
export const SOURCES = [
  "SAP Dispatch",
  "Salesforce",
  "ServiceNow",
  "CSV Upload",
  "Snowflake",
  "Rest endpoints",
] as const;

/* ------------------------------------------------------------------ */
/* 2. Date range labels + x-axis bucket labels                         */
/* ------------------------------------------------------------------ */

export const RANGE_META: Record<RangeKey, { label: string; buckets: string[] }> = {
  today: { label: "Today", buckets: ["9am", "12pm", "3pm", "6pm"] },
  week: { label: "This Week", buckets: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
  month: { label: "This Month", buckets: ["Wk 1", "Wk 2", "Wk 3", "Wk 4"] },
  quarter: { label: "This Quarter", buckets: ["Month 1", "Month 2", "Month 3"] },
  year: {
    label: "This Year",
    buckets: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  },
};

// How much bigger/smaller each range's numbers should look relative to "month" (=1).
// e.g. "year" data should look ~6x bigger in volume than "month" data.
export const RANGE_SCALE: Record<RangeKey, number> = {
  today: 0.15,
  week: 0.5,
  month: 1,
  quarter: 2.4,
  year: 6.2,
};

/* ------------------------------------------------------------------ */
/* 3. Base volumes — the "how big is this org's contract portfolio" knobs */
/* ------------------------------------------------------------------ */

export const BASE_VOLUMES = {
  // Total obligations extracted across the project (roughly stable, not range-scaled)
  totalObligations: 310,
  clientSideShare: 0.46, // remainder goes to supplier-side

  // Compliance trend: obligations evaluated per time bucket, before scaling
  evaluationsPerBucket: 28,
  breachRateMin: 0.05, // breach rate randomizes between these two per bucket
  breachRateMax: 0.14,

  // Breach-by-source: base breach count per source, before scaling
  breachesPerSource: 9,

  // Financial exposure: base $ at risk per time bucket, before scaling
  atRiskPerBucket: 18000,
  recoveredRateMin: 0.25, // recovered = atRisk * a rate randomized in this range
  recoveredRateMax: 0.6,
};

/* ------------------------------------------------------------------ */
/* 4. Rule-type split — must sum to 1, one value per entry in RULE_TYPES */
/* ------------------------------------------------------------------ */

export const RULE_TYPE_SPLIT = [0.28, 0.22, 0.18, 0.14, 0.1, 0.08];

/* ------------------------------------------------------------------ */
/* 5. Lifecycle funnel — each stage as a ratio of the previous stage    */
/* ------------------------------------------------------------------ */

export const LIFECYCLE_RATIOS = {
  detectedMultiplier: 1.4, // detected = activeBreaches * this
  notifiedOfDetected: 0.92,
  remediationOfNotified: 0.68,
  resolvedOfRemediation: 0.6,
  recoveredOfResolved: 0.7,
};
