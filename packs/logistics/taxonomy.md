# Obligation classes in a logistics MSA

Derived from 85 hand-labelled obligations in the reference fixture. Classes marked **no measurement**
carry no number and are invisible to quantitative coverage scoring — they are the ones most often
missed.

- **service_level_target** — a percentage or duration the provider must meet over a stated period.
  Supplier. Has a measurement.
- **banded_consequence_ladder** — a table mapping performance bands to credits, scores or
  escalations. Supplier. One record per row.
- **per_unit_credit_rate** — a credit expressed per unit of shortfall (per tenth of a percentage
  point, per shipment, per event, per message). Frequently stated in prose *beneath* its table.
- **performance_score_band** — a points score attached to a performance band, separate from the
  credit it triggers.
- **triggered_remediation_duty** — a corrective action plan, root cause analysis, progress cadence
  or executive call triggered by a band or an event count. Supplier. **Often no measurement of its
  own**, but carries its own deadlines.
- **recovery_cap** — an aggregate ceiling on credits, with carve-outs. Bounds every credit record.
- **bonus_entitlement** — an upside payment conditional on meeting all targets.
- **reporting_cadence** — a recurring submission with a clock deadline and a required content list.
- **billing_precondition** — a charge that may not be billed absent stated evidence. Negative,
  client-protective. **No measurement.**
- **benchmark_or_repricing_trigger** — a condition forcing renegotiation, plus its own frequency right.
- **carrier_or_subcontractor_control** — approved-carrier share, safety-rating exclusions,
  appointment compliance. Mixed; some carry a percentage, some do not.
- **records_retention** · **audit_right** · **insurance_floor** · **security_control** ·
  **data_use_restriction** · **termination_trigger** · **notice_mechanics** ·
  **force_majeure_carve_out** — standard, usually **no measurement**, routinely missed by
  number-hunting extraction.
