# Where obligations hide in a logistics MSA

Extends `_base/sweep.md`. Family-specific locations only.

- **KPI articles use a repeating block**: `**Definition:** / **Target:** / **Measurement:** /
  **Exclusions:**`, then a band table, then a `**Penalty:**` or `**Penalty Structure:**` paragraph.
  Take the target from **Target**, never from a band's lower bound. The per-unit rate is in the
  penalty paragraph, not the table.
- **One KPI section yields several obligations**: the target, each band row, each per-unit rate, and
  any triggered remediation duty. Expect 3–6 records per KPI section, not one.
- **Pricing articles mix a fixed monthly fee with several `per <unit>` rates in one table** —
  compound pricing, one record per component.
- **Scope articles carry real duties**, not just description: approved-carrier share, safety-rating
  exclusions, appointment compliance, customs document checks, telemetry retention, reconciliation
  cadence.
- **Definitions carry operative thresholds**: the Material Service Failure money threshold, the
  Excursion Event duration, the Peak Season designation notice.
- **Termination articles are lists of independent triggers** — failure counts, performance floors,
  aggregate credit ceilings, uncured-breach periods. One record per trigger.
- **Reporting duties cluster with clock times and a timezone** (`by 8:00 AM Central Time`,
  `Every Monday by 12:00 PM`). Capture the cadence *and* the required content list.
