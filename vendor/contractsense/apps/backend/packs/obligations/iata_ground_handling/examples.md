# Worked shapes

- A row reading `GPU (GROUND POWER UNIT) | PER HOUR | 45.00 EUR | 3.6.1(a)` is one record: the
  service, the basis, the amount with its own currency, and a clause reference. The reference is not
  a quantity.
- A row whose price is `FREE` is still a record — a service owed at no charge. Recording only the
  priced rows loses every free service the handler committed to.
- A labour row `Ramp Agent | 28.00 | 42.00 | 56.00` under headers `Straight Time / Overtime (1.5x) /
  Holiday (2.0x)` is one rate with three components, not three unrelated numbers.
- "Technical landing billed at fifty percent (50%) of the standard turnaround rate for the aircraft
  type" is a conditional rule whose value is a percentage of another record, not a fixed amount.
- An SLA row `On-Time Ground Despatch | ≥ 99.2% departures | Monthly aggregated` and a credit row
  `Ground Handling Delay attributable to Handler (>15 min) | 350.00 EUR per flight` are two records
  that reference each other.
- "0 preventable incidents, calendar year" is a target. A zero threshold is a threshold.
