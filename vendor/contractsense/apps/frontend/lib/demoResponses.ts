/**
 * Canned sales-demo answers for the contract agent quick actions.
 *
 * These are NOT model output. Nothing in this file has been retrieved from a
 * contract, verified against a document, or produced by the agent. It exists
 * only so the quick-action cards can be shown offline during a sales demo, and
 * it is reachable only when NEXT_PUBLIC_AGENT_DEMO_MODE === "1".
 *
 * Every citation here therefore carries `verified: false` and every message
 * built from it must render the demo badge. Do not import this module into any
 * code path that runs with the flag off.
 */

import type { CitationAnnotation } from "@/lib/agent";

export const AGENT_DEMO_MODE = process.env.NEXT_PUBLIC_AGENT_DEMO_MODE === "1";

const genericBriefing = `## Executive contract briefing

This agreement is Annex B to the 2018 IATA Standard Ground Handling Agreement (SGHA), prepared under the simplified procedure for ground handling services at Lycksele Airport. It applies from 1 January 2025 through 31 December 2025 and incorporates the Main Agreement and Annex A. [1]

### Key obligations

- The Carrier must pay all agreed airport and handling charges, including landing, passenger, infrastructure, parking, electricity, de-icing, passenger services, ramp handling, and any applicable disbursements. [1]
- The Carrier must settle invoices within 30 days and prepay a monthly deposit if requested by the Handling Company. [2]
- The Handling Company must provide the agreed ground-handling services in accordance with the Carrier's written operational instructions and applicable aviation regulations. [3]
- The Handling Company must ensure personnel are appropriately trained, particularly for Dangerous Goods handling, and maintain compliance with IATA, ICAO, EU OPS, JAR OPS, Live Animals Regulations, and other applicable legal requirements. [3]

### Deadlines and commercial mechanics

- Settlement is due 30 days net, excluding VAT. If requested, the Carrier prepays a deposit equal to the estimated invoice for the coming month. [2]
- Most charges are indexed to the Swedish Consumer Price Index using October 2022 (384.04) as the base, with adjustments beginning on 1 January 2024. De-icing fluid is excluded from indexation. [2]
- Disbursements are reimbursed at actual cost plus an 8% accounting surcharge. [1]

### Financial exposure

The largest financial exposure comes from airport and handling charges, variable charges based on aircraft size and passenger numbers, extra opening hours, de-icing services, electricity usage, and late cancellation fees. In addition, the agreement includes recoverable service credits for turnaround delays, missed handling services, baggage mishandling, de-icing delays, refuelling delays, regulatory breaches, and poor monthly on-time performance. [4]

### Operational risk

Operational risks include maintaining qualified personnel, complying with aviation safety regulations, meeting service-level targets, preventing delays, and ensuring all operational procedures follow the Carrier's written instructions. Failure to meet these obligations may result in contractual service credits recoverable by the Carrier. [3][4]

### Recommended next steps

1. Verify current airport and handling charges against the latest indexed pricing schedule.
2. Assign owners for invoicing, settlement, safety compliance, training, and operational performance.
3. Monitor turnaround performance, cancellation events, de-icing response times, baggage handling, and safety incidents against the contractual service-level requirements.
4. Maintain supporting evidence for every operational activity and review indexed pricing whenever CPI adjustments occur.`;

const genericPaymentBriefing = `## Key financial and payment obligations

The primary financial obligations under this agreement relate to payment of airport charges, ground-handling charges, settlement of invoices, reimbursement of disbursements, and management of variable operational costs. These obligations primarily sit with the Carrier. [1]

The Carrier is responsible for paying charges covering landing fees, passenger charges, infrastructure fees, parking, extra opening hours, passenger services, ramp handling, electricity, de-icing, refuelling tariffs, tow-in/pushback services, and any additional agreed handling services. Most charges vary depending on aircraft MTOW, passenger count, service type, operating hours, or usage. [1]

Invoices are payable within 30 days net and all prices exclude VAT. If requested by the Handling Company, the Carrier must prepay a deposit based on the estimated invoice for the following month. [2]

Additional commercial exposure includes reimbursement of third-party disbursements at actual cost plus an 8% accounting surcharge, late cancellation charges of 50% or 100% depending on notice provided, and CPI-based annual price adjustments for most service charges. [1][2]

Although the Carrier bears most payment obligations, the Handling Company may also become financially liable through contractual service credits if operational performance standards are not achieved, including turnaround delays, service failures, baggage mishandling, safety breaches, and missed service levels. [4]

### Recommended control

Match every invoice against the aircraft MTOW, passenger count, applicable service category, cancellation notice period, and current indexed rate schedule before approval. Retain invoices together with flight logs, operational records, and supporting documentation for any exceptions or service-credit claims.`;

const genericOperationsBriefing = `## Operational obligations and compliance requirements

The operational obligations focus on safe delivery of ground-handling services, regulatory compliance, personnel competence, and achievement of defined operational service levels. Most operational responsibilities belong to the Handling Company. [3]

The Handling Company must perform all technical, flight operations, and other safety-related services in accordance with the Carrier's written operating instructions. [3]

Personnel involved in ground handling must receive appropriate training, particularly for Dangerous Goods handling, and must remain competent to perform their assigned duties. Operations must comply with applicable IATA, ICAO, AHM, EU OPS, JAR OPS, Live Animals Regulations, and other applicable legal requirements. [3]

The agreement also establishes measurable operational performance requirements through service-level credits. The Handling Company is expected to:

- Deliver turnaround services within agreed timelines.
- Provide passenger and ramp services as scheduled.
- Prevent baggage and cargo mishandling.
- Commence de-icing within the required response time.
- Complete refuelling before scheduled departure.
- Maintain compliance with all applicable safety and regulatory requirements.
- Achieve at least 95% monthly on-time turnaround performance. [4]

Failure to meet these operational requirements may result in predefined contractual service credits payable to the Carrier. [4]

### Evidence to retain

- Written operating instructions received from the Carrier.
- Personnel training and Dangerous Goods certification records.
- Safety compliance documentation.
- Turnaround timing records.
- Refuelling completion records.
- De-icing request and response logs.
- Baggage and cargo incident reports.
- Monthly on-time performance reports.
- Regulatory inspection and audit records.

### Recommended control

Assign accountable owners for each operational obligation, continuously monitor the contractual KPIs, retain evidence supporting compliance before each flight operation, and investigate service failures immediately to minimise contractual service-credit exposure.`;

// Baltia Airlines / Swissport USA JFK GHA demo -- same quick-action wording as
// the generic cards above, but the answers and citations are grounded in the
// extracted obligations (demo_data/baltia_jfk_ground_truth.json) rather than
// the leftover Lycksele SGHA content the generic cards were written for.
const baltiaBriefing = `## Executive contract briefing — Baltia Airlines / Swissport USA JFK GHA

This is the JFK ground handling agreement between Baltia Airlines (Carrier) and Swissport USA, Inc. (Handling Company), covering ramp, passenger service, and flight operations/dispatch handling for B747-200 turnarounds at John F. Kennedy International Airport. [1]

### Key obligations

- Swissport must staff every turnaround per the agreed manning table: 1 supervisor, 1 centralized load control position, 8 check-in/gate agents, 3 arrivals agents, and 1 baggage service position. [2]
- Flights arriving or departing within 60 minutes of the scheduled ETA/ETD are handled at the standard turnaround rate. [3]
- Fixed per-turnaround charges apply for B747-200 aircraft: $2,395.00 ramp handling, $1,490.00 passenger service, $280.00 flight ops/dispatch — $4,165.00 combined.
- Rates escalate each contract anniversary by the greater of CPI or a contractual minimum of 3%. [4]

### Deadlines and commercial mechanics

- Baltia provides a monthly prepayment of anticipated charges, reconciled against actuals (Annex B P9.1).
- Late payments accrue interest at 1.5%/month; disputed invoice items get their payment deadline extended until resolved (Annex B P9.4).
- Persistent non-payment lets Swissport place Baltia on a cash-in-advance basis or suspend services.

### Operational risk

- A ramp return involving a load change is charged at the technical-landing rate, not the standard turnaround rate (Annex B P1.2.4).
- No surcharge applies for night, Sunday, or holiday service — Swissport absorbs that cost inside the standard rate (Annex B P1.2.5).
- Missing the manning commitment or the on-schedule handling window creates evidenced, escalatable non-compliance — both are tracked as open breach flags in the KPI register today.

### Recommended next steps

1. Reconcile monthly prepayments against actual turnaround counts and the fixed per-turnaround charges.
2. Verify Swissport's on-site headcount against the manning table at each B747-200 turnaround.
3. Track ETA/ETD variance against the 60-minute window — late arrivals shift the charging basis.
4. Confirm the next CPI anniversary date and audit the applied escalation percentage.`;

const baltiaPaymentBriefing = `## Key financial and payment obligations — Baltia / Swissport JFK GHA

The primary financial obligation sits with Baltia Airlines, who pays Swissport USA a fixed per-turnaround rate for every B747-200 ground handling cycle. [1]

Baltia pays three separate fixed charges per turnaround: $2,395.00 for ramp handling, $1,490.00 for passenger service, and $280.00 for flight operations/dispatch — $4,165.00 combined (Annex B P1.2.A-C).

Additional financial mechanics:

- Rates escalate annually on the contract anniversary date by the greater of CPI or a contractual minimum of 3%. [4]
- A ramp return involving a load change bills at the technical-landing rate instead of the standard turnaround rate (Annex B P1.2.4).
- No night/Sunday/holiday surcharge applies — service at any hour bills at the standard rate (Annex B P1.2.5).
- Baltia provides a monthly prepayment of anticipated charges, reconciled against actuals (Annex B P9.1).
- Late payments accrue interest at 1.5%/month; disputed invoice items get their payment deadline extended until resolved (Annex B P9.4).
- Persistent non-payment lets Swissport move Baltia to a cash-in-advance basis or suspend handling services.

### Recommended control

Reconcile every invoice against actual turnaround count, verify the applied CPI escalation on each contract anniversary, and flag any ramp-return or night/holiday charge that deviates from the fixed-rate terms above.`;

const baltiaOperationsBriefing = `## Operational obligations and compliance requirements — Baltia / Swissport JFK GHA

Most operational responsibility sits with Swissport USA as the ground handling company at JFK.

Swissport must staff every turnaround to the agreed manning table: 1 supervisor (8 man-hours), 1 centralized load control position, 8 check-in/gate agents for B747-200 service (4 man-hours each), 3 arrivals agents (4 man-hours each), and 1 centralized baggage service position. [2]

Flights are handled within a fixed schedule window — arrivals and departures within 60 minutes of the agreed ETA/ETD are covered at the standard rate. [3] Handling outside that window, or a ramp return involving a load change, shifts the charging basis to the technical-landing rate (Annex B P1.2.4).

### Evidence to retain

- On-site headcount records per turnaround, matched against the manning table.
- Actual ETA/ETD timestamps versus scheduled flight times.
- Ramp-return incident logs, noting whether a load change occurred.
- De-icing service records (Type I / Type IV fluid usage and rates).
- Invoice-level records for every fixed and variable charge applied.

### Recommended control

Track headcount and on-schedule performance per turnaround as the two leading indicators of Swissport's operational compliance — both drive the open breach flags already showing in the KPI register.`;

/**
 * Mirrors the backend filename gate (services/baltia_jfk_demo.py::is_baltia_jfk_demo)
 * so the Baltia script only swaps in for that one contract.
 */
function isBaltiaContractName(name: string | null | undefined): boolean {
  const lowered = (name || "").toLowerCase();
  const hints = ["baltia", "swissport", "jfk", "gha"];
  return hints.filter((hint) => lowered.includes(hint)).length >= 2;
}

function annotation(
  ref: number,
  contractId: string | null | undefined,
  filename: string,
  page: number,
  quote: string,
): CitationAnnotation {
  return {
    type: "citation_data",
    ref,
    document_id: contractId || undefined,
    filename,
    page,
    page_start: page,
    page_end: page,
    quote,
    // Canned, not retrieved. Never claim verification for demo content.
    verified: false,
  };
}

function baltiaAnnotations(
  contractId: string | null | undefined,
  contractName: string | null | undefined,
): CitationAnnotation[] {
  const filename = contractName || "BaltiaGHAContract";
  return [
    annotation(1, contractId, filename, 3, "B747-200 series aircraft $2,395.00/turnaround"),
    annotation(2, contractId, filename, 4, "Passenger Service Pricing is based upon the following mutually agreed manning"),
    annotation(3, contractId, filename, 4, "flights operating within sixty (60) minutes of scheduled arrival or departure"),
    annotation(4, contractId, filename, 8, "will be subject to an increase each anniversary date of the contract"),
  ];
}

function genericAnnotations(
  contractId: string | null | undefined,
  contractName: string | null | undefined,
): CitationAnnotation[] {
  const filename = contractName || "StandardGroundHandlingAgreement.pdf";
  return [
    annotation(
      1,
      contractId,
      filename,
      1,
      "PREAMBLE: Prepared under the simplified procedure; the terms of the Main Agreement and Annex A of the SGHA of January 2018 (IATA) apply as if repeated in full. All prices and fees are stated in SEK",
    ),
    annotation(
      2,
      contractId,
      filename,
      2,
      "8.1 Settlement 30 days net. All prices exclude VAT. ... 10.1 All prices above, except de-icing fluid, are index-linked to the October CPI (total index, 1980 base).",
    ),
    annotation(
      3,
      contractId,
      filename,
      2,
      "9.1 The Handling Company carries out technical/flight-operations and other safety-related services per the Carrier’s instructions, confirmed in writing. ... 9.4 Staff are trained to handle Dangerous Goods ... 9.5 The Handling Company complies with all applicable IATA, AHM, ICAO, EU OPS, JAR OPS",
    ),
    annotation(
      4,
      contractId,
      filename,
      2,
      "The following service credits are recoverable by the Carrier from the Handling Company where the Handling Company fails to meet the service and performance standards below.",
    ),
  ];
}

export type DemoQuickActionResponse = {
  answer: string;
  annotations: CitationAnnotation[];
};

/**
 * Resolve the canned response for a quick action, or null when demo mode is off.
 *
 * `quickActions` must be the same array the panel renders, in the same order —
 * the scripts are keyed positionally, not by text match.
 */
export function resolveDemoQuickAction(
  action: string,
  quickActions: readonly string[],
  contractId: string | null | undefined,
  contractName: string | null | undefined,
): DemoQuickActionResponse | null {
  if (!AGENT_DEMO_MODE) return null;

  const isBaltia = isBaltiaContractName(contractName);
  const scripts = isBaltia
    ? [baltiaBriefing, baltiaPaymentBriefing, baltiaOperationsBriefing]
    : [genericBriefing, genericPaymentBriefing, genericOperationsBriefing];

  const index = quickActions.indexOf(action);
  const answer = (index >= 0 ? scripts[index] : undefined) ?? scripts[0];

  return {
    answer,
    annotations: isBaltia
      ? baltiaAnnotations(contractId, contractName)
      : genericAnnotations(contractId, contractName),
  };
}
