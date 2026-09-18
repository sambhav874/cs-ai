# PAYMENT PROCESSING PLATFORM AND MERCHANT SERVICES AGREEMENT

**Agreement Number:** PAY-2028-PSP-7714
**Effective Date:** May 15, 2028
**Initial Term Expiration:** May 14, 2033
**Merchant:** RetailCo Marketplace Holdings, Inc.
**Processor:** NovaPay Processing Services LLC
**Payment Channels:** Web, mobile app, marketplace seller portal, in-store QR, subscription billing, and customer support payment links
**Supported Regions:** United States, Canada, United Kingdom, European Union, Australia, and Singapore
**Governing Law:** Delaware

---

## ARTICLE I: COMMERCIAL PURPOSE AND DEFINITIONS

### Section 1.01: Purpose

RetailCo operates a multi-seller marketplace and engages NovaPay to provide payment gateway, authorization, capture, tokenization, settlement, refund, chargeback, fraud screening, payout, reconciliation, reporting, and compliance services. The Parties intend this Agreement to provide precise service levels, risk allocation, operating rules, audit rights, data obligations, and remedies for payment failures.

### Section 1.02: Operating Rules

NovaPay shall comply with card network rules, NACHA rules, PCI DSS, applicable money transmission laws to the extent applicable to NovaPay, sanctions screening obligations, consumer protection laws, and RetailCo's approved payment operating procedures.

### Section 1.03: Defined Terms

**Authorization Latency:** Time between NovaPay receiving a valid authorization request and returning an authorization response to RetailCo.

**Chargeback Ratio:** Number of chargebacks received in a month divided by number of settled card transactions for the same month.

**Critical Payment Incident:** Any event causing payment acceptance outage, duplicate capture, unauthorized refund, settlement misdirection, card data exposure, sanctions control failure, or aggregate monetary error greater than $250,000.

**Net Settlement:** Gross captured amounts less refunds, chargebacks, processing fees, reserves, reversals, adjustments, and applicable pass-through fees.

**Token Vault:** NovaPay's system for storing and managing network tokens, processor tokens, and payment credentials.

---

## ARTICLE II: SERVICES

### Section 2.01: Gateway and Processing Services

NovaPay shall provide gateway routing, authorization, capture, void, reversal, refund, tokenization, account updater, 3-D Secure, fraud scoring, recurring billing, currency conversion, payout, reconciliation, chargeback handling, and reporting.

### Section 2.02: Marketplace Seller Services

NovaPay shall support onboarding of marketplace sellers, seller KYC workflow, payout account verification, seller reserve management, split payments, seller fee deductions, tax form data capture, and seller payout reporting.

### Section 2.03: Fraud Services

NovaPay shall provide rules engine, velocity checks, device fingerprinting, AVS, CVV, 3-D Secure orchestration, account takeover monitoring, bot detection signals, and fraud analyst review queues. RetailCo retains final business authority over fraud rules that affect customer acceptance.

### Section 2.04: Settlement Services

NovaPay shall calculate and initiate daily settlement on each business day. United States transactions must settle to RetailCo's designated account by T+1 business day. Cross-border transactions must settle by T+2 business days unless local banking rules require longer.

### Section 2.05: Tokenization and Portability

NovaPay shall tokenize payment credentials and support token portability at termination. Token export must include token reference, card brand, expiration month and year, last four digits, customer reference, billing agreement reference, and network token status when permitted by network rules.

---

## ARTICLE III: FEES, RESERVES, AND PAYMENT

### Section 3.01: Processing Fees

| Fee Type | Amount |
|---|---:|
| Gateway fee | $0.025 per authorization attempt |
| Processor markup | 18 basis points of captured volume |
| Marketplace payout fee | $0.08 per seller payout |
| Chargeback management fee | $7.50 per chargeback |
| Fraud review fee | $0.06 per manually reviewed transaction |
| Token account updater fee | $0.03 per updated credential |

### Section 3.02: Pass-Through Fees

Card network interchange, assessment fees, scheme fees, local payment method fees, bank fees, and taxes are passed through without markup unless expressly stated in Exhibit C.

### Section 3.03: Reserve

NovaPay may require a rolling reserve only if RetailCo's Chargeback Ratio exceeds 0.90% for two consecutive months, fraud losses exceed $1,000,000 in a month, or a regulator or card network requires reserve protection. Any reserve must be commercially reasonable and reviewed monthly.

### Section 3.04: Fee Disputes

RetailCo may dispute fees within ninety days after invoice receipt. NovaPay shall provide transaction-level fee backup within five business days after request.

---

## ARTICLE IV: SERVICE LEVELS AND KPIS

### Section 4.01: KPI Framework

NovaPay's performance is measured monthly. KPI failures trigger Service Credits, corrective action, executive review, card network remediation, or termination rights. Service Credits are calculated against monthly NovaPay processing fees, excluding pass-through card network fees.

### Section 4.02: KPI-1 Platform Availability

**Target:** 99.99% monthly availability for authorization, capture, tokenization, and refund APIs.
**Measurement:** Measured using NovaPay monitoring, RetailCo synthetic transactions, and independent uptime probes.
**Maintenance:** Scheduled maintenance must not exceed two hours per month and must not occur between 8:00 AM and 11:00 PM Eastern Time.

| Availability | Service Credit |
|---:|---:|
| 99.95% to 99.989% | 5% of monthly processing fees |
| 99.50% to 99.949% | 15% of monthly processing fees |
| 99.00% to 99.499% | 25% of monthly processing fees |
| Below 99.00% | 40% of monthly processing fees and Critical Payment Incident review |

### Section 4.03: KPI-2 Authorization Latency

**Target:** 95th percentile Authorization Latency below 450 milliseconds and 99th percentile below 1,200 milliseconds.
**Penalty:** $10,000 for each day in which 95th percentile latency exceeds 450 milliseconds for more than sixty cumulative minutes. If 99th percentile latency exceeds 1,200 milliseconds for two consecutive days, NovaPay must provide a latency remediation plan.

### Section 4.04: KPI-3 Settlement Timeliness

**Target:** 99.8% of United States Net Settlement delivered by T+1 business day and 99.0% of cross-border Net Settlement delivered by T+2 business days.
**Penalty:** $25,000 for each missed settlement file affecting more than $1,000,000. Interest accrues at 1.5% per month on amounts delayed more than two business days due to NovaPay fault.

### Section 4.05: KPI-4 Reconciliation Accuracy

**Target:** 99.95% transaction-level reconciliation accuracy between RetailCo orders, NovaPay captures, refunds, chargebacks, fees, and settlement.
**Penalty:** $5,000 per unreconciled variance over $10,000 open for more than three business days. Accuracy below 99.80% triggers a Corrective Action Plan.

### Section 4.06: KPI-5 Fraud Screening Effectiveness

**Target:** Fraud loss rate below 0.18% of captured volume, excluding transactions where RetailCo overrode NovaPay's decline recommendation.
**Penalty:** $50,000 if monthly fraud loss rate exceeds 0.18%; $150,000 if it exceeds 0.30%; executive review if it exceeds 0.45%.

### Section 4.07: KPI-6 Chargeback Ratio

**Target:** Chargeback Ratio below 0.65% each month.
**Penalty:** NovaPay shall provide chargeback remediation support at no additional charge if Chargeback Ratio exceeds 0.65%. If Chargeback Ratio exceeds 0.90% and NovaPay failed to apply agreed fraud rules, NovaPay shall credit $100,000.

### Section 4.08: KPI-7 Dispute Response Timeliness

**Target:** 98.0% of chargeback representment packages submitted at least twenty-four hours before network deadline.
**Penalty:** NovaPay is responsible for the full chargeback amount if a representment is lost solely because NovaPay missed the deadline despite RetailCo providing required evidence on time.

### Section 4.09: KPI-8 Security Control Timeliness

**Target:** Critical payment security vulnerabilities remediated within forty-eight hours, high vulnerabilities within seven days, and PCI evidence delivered within three business days after request.
**Penalty:** $25,000 per missed critical vulnerability deadline. A missed PCI evidence deadline during an active audit is a Material Compliance Failure.

---

## ARTICLE V: COMPLIANCE AND RISK CONTROLS

### Section 5.01: PCI DSS

NovaPay shall maintain PCI DSS Level 1 certification throughout the term. Attestation of Compliance and Responsibility Matrix must be provided annually and within five business days after request.

### Section 5.02: AML, KYC, and Sanctions

NovaPay shall conduct seller identity verification, sanctions screening, beneficial owner checks, risk scoring, ongoing monitoring, and suspicious activity escalation for sellers using payout services. NovaPay shall notify RetailCo within one business day after identifying a seller that fails KYC or sanctions screening.

### Section 5.03: Card Network Monitoring

NovaPay shall monitor card network fraud and chargeback programs. NovaPay shall notify RetailCo within twenty-four hours after any card network inquiry, warning, monitoring notice, or fine related to RetailCo activity.

### Section 5.04: Prohibited Activities

NovaPay shall not process transactions for prohibited goods, illegal services, sanctions targets, deceptive activity, or merchants not approved under RetailCo's seller policy.

### Section 5.05: Error Correction

Duplicate capture, unauthorized refund, settlement misdirection, incorrect fee deduction, or payment instruction error caused by NovaPay must be corrected within one business day. NovaPay shall reimburse direct losses, bank fees, network fees, and customer remediation costs caused by NovaPay error.

---

## ARTICLE VI: DATA, SECURITY, AND INCIDENT RESPONSE

### Section 6.01: Data Security Program

NovaPay shall maintain encryption at rest and in transit, HSM-backed key management, tokenization, network segmentation, least privilege access, MFA, production access approvals, tamper-evident logs, annual penetration testing, quarterly vulnerability scans, and employee background checks.

### Section 6.02: Incident Notice

NovaPay shall notify RetailCo within one hour after discovering a suspected or confirmed Critical Payment Incident and within four hours after discovering any other Security Incident. A preliminary incident report is due within twenty-four hours, and a final root cause report is due within ten business days.

### Section 6.03: Audit Logs

NovaPay shall maintain audit logs for all privileged access, payment credential access, refund configuration changes, fraud rule changes, settlement file changes, seller payout changes, API key changes, and failed login attempts. Logs must be retained for seven years.

### Section 6.04: Data Retention

Transaction records, settlement files, dispute records, KYC records, audit logs, and security evidence must be retained for seven years unless a longer legal requirement applies.

### Section 6.05: Data Portability

On request and at termination, NovaPay shall provide transaction history, seller payout history, token vault portability files, dispute history, fee records, and reconciliation records in a documented format.

---

## ARTICLE VII: REPORTING AND GOVERNANCE

### Section 7.01: Daily Payment Operations Report

By 7:00 AM Eastern Time each business day, NovaPay shall provide transaction volume, authorization approval rate, authorization latency, failed captures, settlement status, refund exceptions, chargeback alerts, fraud losses, and open incidents.

### Section 7.02: Weekly Risk Report

Every Tuesday by 12:00 PM Eastern Time, NovaPay shall provide fraud trends, top fraud rules, false positive estimates, chargeback trends, seller risk queue, KYC exceptions, sanctions screening hits, and network monitoring status.

### Section 7.03: Monthly Service Review

By the tenth calendar day of each month, NovaPay shall provide KPI performance, Service Credit calculations, incident summaries, settlement variances, fee disputes, security patch status, PCI status, and roadmap commitments.

### Section 7.04: Quarterly Executive Review

The Parties shall review payment strategy, approval rate optimization, fraud performance, network fee changes, international expansion, uptime trends, seller risk, and customer experience.

---

## ARTICLE VIII: REPRESENTATIONS, WARRANTIES, AND INDEMNITY

### Section 8.01: Processor Warranties

NovaPay warrants that services will comply with applicable payment laws, card network rules, PCI DSS, documentation, and this Agreement. NovaPay warrants that it has authority to provide payment services in supported regions.

### Section 8.02: Merchant Warranties

RetailCo warrants that it will not knowingly submit illegal transactions, will provide accurate seller and transaction information, and will comply with merchant obligations allocated to RetailCo.

### Section 8.03: Indemnity

NovaPay shall indemnify RetailCo against third-party claims, network fines, regulatory penalties, data breach costs, unauthorized transaction losses, and reasonable attorneys' fees caused by NovaPay's breach, negligence, willful misconduct, security failure, PCI failure, settlement error, or violation of law.

### Section 8.04: Liability Cap

The general liability cap is three times fees paid in the prior twelve months. No cap applies to data breach, PCI failure, confidentiality breach, fraud, willful misconduct, intentional settlement misdirection, or indemnity for third-party intellectual property claims.

---

## ARTICLE IX: TERMINATION

### Section 9.01: Termination for Cause

RetailCo may terminate if any of the following occurs:

- Platform availability below 99.00% in any two months during a rolling twelve-month period.
- A Critical Payment Incident causing monetary error over $1,000,000.
- PCI DSS certification lapses or is revoked.
- Unauthorized sale or misuse of payment data.
- Settlement Timeliness below 98.0% for two consecutive months.
- Material breach uncured thirty days after written notice.

### Section 9.02: Termination for Convenience

RetailCo may terminate for convenience after the first contract year on 180 days' written notice. NovaPay may terminate for convenience after the initial term on 365 days' written notice.

### Section 9.03: Wind-Down Assistance

NovaPay shall provide up to twelve months of wind-down assistance, including token portability, routing migration, data export, seller payout transition, chargeback file transfer, reconciliation support, and network registration cooperation.

---

## ARTICLE X: DISPUTES AND GENERAL TERMS

### Section 10.01: Dispute Escalation

Operational disputes escalate to payment operations leads within two business days, then vice presidents within five business days, then executive sponsors within ten business days. Payment security emergencies may bypass escalation.

### Section 10.02: Confidentiality

Payment data, security controls, pricing, fraud rules, seller risk scores, API documentation, and customer data are Confidential Information. Confidentiality obligations survive for five years, and payment credential security obligations survive indefinitely.

### Section 10.03: Force Majeure

Force Majeure does not excuse payment security, settlement of already captured funds, data breach notice, regulatory cooperation, or mitigation obligations.

## EXHIBIT A: REQUIRED REPORT FIELDS

Reports must include transaction counts, gross volume, authorization approval rate, decline reasons, latency percentiles, capture failures, refund failures, settlement file IDs, settlement amounts, chargeback counts, fraud loss amount, KYC exceptions, sanctions hits, and open incidents.

## EXHIBIT B: INTEGRATIONS

NovaPay shall support REST API, webhook events, SFTP settlement reports, SSO admin access, SIEM forwarding, seller onboarding API, dispute evidence API, fraud rule API, and token migration API.
