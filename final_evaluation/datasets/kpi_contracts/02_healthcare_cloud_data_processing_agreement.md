# HEALTHCARE CLOUD ANALYTICS AND DATA PROCESSING AGREEMENT

**Agreement Number:** HCA-2027-DPA-9021
**Effective Date:** July 1, 2027
**Initial Term Expiration:** June 30, 2031
**Customer:** Meridian Health Network, a nonprofit integrated healthcare system
**Vendor:** Helix Cloud Analytics, Inc., a Delaware corporation
**Covered Data:** Protected Health Information, personally identifiable information, clinical operational data, claims extracts, patient engagement data, and de-identified analytics outputs
**Hosting Region:** United States only unless Meridian gives prior written approval
**Governing Law:** State of Washington and applicable federal healthcare privacy law

---

## ARTICLE I: PURPOSE AND REGULATORY CONTEXT

### Section 1.01: Purpose

Meridian engages Helix to provide a cloud analytics platform for care coordination, revenue cycle optimization, utilization management, population health reporting, prior authorization workflow, and clinical quality dashboards. Helix will host, process, transform, analyze, and return Covered Data under strict privacy, security, uptime, reporting, and audit requirements.

### Section 1.02: Business Associate Status

To the extent Helix creates, receives, maintains, or transmits Protected Health Information on behalf of Meridian, Helix acts as a business associate. The Parties incorporate the Business Associate Addendum in Exhibit A. If a term in this Agreement conflicts with the Business Associate Addendum, the stricter privacy or security requirement controls.

### Section 1.03: No Sale or Secondary Use

Helix shall not sell Covered Data, use Covered Data for advertising, use Covered Data for unrelated model training, combine Covered Data with third-party customer data, or create external benchmarks without Meridian's express written approval.

---

## ARTICLE II: PLATFORM SERVICES

### Section 2.01: Core Platform

Helix shall provide secure ingestion pipelines, data normalization, analytics dashboards, API access, role-based access controls, audit logging, data quality rules, configurable alerting, export tools, and managed support.

### Section 2.02: Implementation

Implementation begins July 15, 2027. Production go-live must occur no later than January 15, 2028. Helix shall complete data mapping, interface testing, security review, user acceptance testing, and administrator training before go-live.

### Section 2.03: Data Sources

Covered Data may include ADT feeds, claims extracts, encounter files, provider rosters, care gap files, referral data, lab result metadata, medication adherence feeds, quality measure extracts, authorization records, and patient outreach activity.

### Section 2.04: Support Tiers

| Severity | Definition | Response Time | Restoration Target |
|---|---|---:|---:|
| Severity 1 | Platform unavailable, PHI exposure suspected, or patient safety workflow blocked | 15 minutes | 4 hours |
| Severity 2 | Major function unavailable or data feed failure affecting more than one facility | 1 hour | 8 hours |
| Severity 3 | Minor function degraded or single facility affected | 4 business hours | 3 business days |
| Severity 4 | General question, cosmetic issue, enhancement request | 2 business days | Mutually scheduled |

---

## ARTICLE III: FEES AND PAYMENT

### Section 3.01: Subscription Fees

Meridian shall pay an annual subscription fee of $3,600,000 for the first contract year. Fees increase by 3% annually unless Helix misses the uptime KPI or data quality KPI in the prior contract year, in which case the annual increase is waived.

### Section 3.02: Implementation Fees

Implementation fees are fixed at $850,000 and payable in four milestones:

| Milestone | Due Date | Amount |
|---|---:|---:|
| Project kickoff and architecture approval | August 1, 2027 | $150,000 |
| Interface build complete | October 15, 2027 | $250,000 |
| Security review and UAT complete | December 15, 2027 | $250,000 |
| Production go-live | January 15, 2028 | $200,000 |

### Section 3.03: Invoices

Helix shall invoice annually in advance for subscription fees and monthly in arrears for approved professional services. Meridian shall pay undisputed invoices within forty-five days after receipt.

---

## ARTICLE IV: SERVICE LEVELS AND KPIS

### Section 4.01: KPI Framework

Helix will be measured monthly. Service Credits are applied to the next invoice. Repeated KPI failures may trigger Corrective Action Plans, enhanced audit rights, fee increase waiver, or termination.

### Section 4.02: KPI-1 Platform Availability

**Target:** 99.95% monthly availability, excluding pre-approved maintenance windows.
**Measurement:** Availability is measured from Meridian user locations and Helix synthetic monitoring.
**Maintenance:** Scheduled maintenance may not exceed four hours per month and must occur between 12:00 AM and 4:00 AM Pacific Time.

| Monthly Availability | Service Credit |
|---:|---:|
| 99.90% to 99.949% | 5% of monthly subscription equivalent |
| 99.50% to 99.899% | 10% of monthly subscription equivalent |
| 99.00% to 99.499% | 20% of monthly subscription equivalent |
| Below 99.00% | 35% of monthly subscription equivalent and executive review |

### Section 4.03: KPI-2 Data Pipeline Freshness

**Target:** 98.5% of scheduled inbound feeds processed and visible in the platform within two hours after receipt.
**Critical Feeds:** ADT, emergency department census, prior authorization, and care gap feeds must process within thirty minutes.
**Penalty:** $7,500 for each Critical Feed delay over thirty minutes after the first two delays in a month; $25,000 if total feed freshness falls below 95.0%.

### Section 4.04: KPI-3 Data Quality Accuracy

**Target:** 99.7% record-level transformation accuracy for mapped fields.
**Measurement:** Monthly sampling by Meridian data governance team and automated validation rules.
**Penalty:** $10,000 per 0.1% below 99.7%. Accuracy below 99.0% requires a Corrective Action Plan within five business days.

### Section 4.05: KPI-4 API Latency

**Target:** 95th percentile API response time below 700 milliseconds for standard queries and below 2,500 milliseconds for complex analytics queries.
**Penalty:** $5,000 for each business day in which standard API latency exceeds 700 milliseconds for more than sixty consecutive minutes.

### Section 4.06: KPI-5 Security Patch Timeliness

**Target:** Critical vulnerabilities patched within seventy-two hours, high vulnerabilities within seven days, medium vulnerabilities within thirty days.
**Penalty:** $15,000 per missed critical patch deadline and $5,000 per missed high patch deadline. Failure to patch a critical vulnerability within seven days is a Critical Security Breach.

### Section 4.07: KPI-6 Support Resolution

**Target:** 95% of Severity 1 tickets restored within four hours and 90% of Severity 2 tickets restored within eight hours.
**Penalty:** $10,000 for each Severity 1 ticket missing the restoration target and $3,000 for each Severity 2 ticket missing the restoration target.

### Section 4.08: KPI-7 Audit Log Completeness

**Target:** 100% of user access, export, delete, privilege change, failed login, API access, and administrative configuration events logged.
**Penalty:** Any material audit log gap lasting more than thirty minutes is a Critical Security Breach. Non-material gaps trigger a $20,000 credit per incident.

---

## ARTICLE V: PRIVACY AND SECURITY OBLIGATIONS

### Section 5.01: Safeguards

Helix shall maintain administrative, physical, and technical safeguards consistent with HIPAA Security Rule standards, SOC 2 Type II, HITRUST or equivalent certification, least privilege access, encryption at rest using AES-256 or stronger, TLS 1.2 or stronger in transit, MFA for all workforce users, and quarterly access reviews.

### Section 5.02: Security Incident Notice

Helix shall notify Meridian within four hours after discovering a suspected or confirmed Security Incident. Helix shall provide a preliminary written incident report within twenty-four hours and a final root cause report within ten business days after containment.

### Section 5.03: Breach Notification Support

If a Breach of Unsecured Protected Health Information occurs, Helix shall provide all information reasonably required for Meridian's legal notification obligations within twenty-four hours after request, including affected individuals, data elements, timeline, mitigation, and evidence preservation.

### Section 5.04: Subprocessors

Helix may use only subprocessors listed in Exhibit B. Helix must provide sixty days' notice before adding a subprocessor. Meridian may object on security, privacy, regulatory, or operational grounds.

### Section 5.05: Data Segregation

Helix shall logically segregate Meridian data from other customer data. Production data may not be copied to development or test environments unless masked, tokenized, or otherwise de-identified under Meridian-approved procedures.

### Section 5.06: Access Controls

All Helix workforce access to Covered Data must be role-based, approved by a manager, logged, reviewed quarterly, and revoked within twenty-four hours after job change or termination.

---

## ARTICLE VI: REPORTING, AUDIT, AND GOVERNANCE

### Section 6.01: Daily Operational Report

By 9:00 AM Pacific Time each business day, Helix shall provide a report showing platform availability, feed status, failed feeds, open support incidents, security alerts, API latency exceptions, and unresolved data quality defects.

### Section 6.02: Monthly Service Review

By the tenth calendar day of each month, Helix shall provide a monthly service review containing KPI results, Service Credit calculations, support ticket metrics, patch status, access review exceptions, subprocessor changes, incident summaries, and roadmap risks.

### Section 6.03: Quarterly Compliance Review

Each quarter, Helix shall review HIPAA compliance, SOC 2 findings, penetration test remediation, vulnerability management, audit log completeness, disaster recovery testing, and privacy impact assessments.

### Section 6.04: Audit Rights

Meridian may audit Helix's controls once per year on thirty days' notice and after any Security Incident on five business days' notice. Helix shall retain logs, evidence, support records, and data processing records for ten years.

---

## ARTICLE VII: DISASTER RECOVERY AND BUSINESS CONTINUITY

### Section 7.01: Recovery Objectives

Helix shall maintain a recovery time objective of four hours and a recovery point objective of fifteen minutes for production services. Disaster recovery tests must be conducted twice per year and reported to Meridian within fifteen days.

### Section 7.02: Backup Requirements

Production data must be backed up at least every four hours, encrypted, integrity tested monthly, and stored in geographically separate facilities within the United States.

---

## ARTICLE VIII: WARRANTIES, INDEMNITY, AND LIABILITY

### Section 8.01: Warranties

Helix warrants that the platform will materially conform to documentation, process data in accordance with this Agreement, maintain required security controls, and not introduce malicious code.

### Section 8.02: Indemnity

Helix shall indemnify Meridian for third-party claims, regulatory penalties, patient notification costs, credit monitoring, forensic investigation, and reasonable attorneys' fees arising from Helix's breach of privacy or security obligations, negligence, willful misconduct, intellectual property infringement, or violation of law.

### Section 8.03: Liability Cap

The general liability cap is two times annual fees paid or payable. The cap is five times annual fees for privacy breach, security breach, confidentiality breach, regulatory fines caused by Helix, indemnity claims, and willful misconduct.

---

## ARTICLE IX: TERMINATION

### Section 9.01: Termination for Cause

Meridian may terminate for cause if any of the following occurs:

- Platform availability below 99.0% in two months during any rolling twelve-month period.
- Data Quality Accuracy below 99.0% for two consecutive months.
- A Critical Security Breach.
- Failure to meet RTO in a disaster recovery event.
- Unauthorized use or sale of Covered Data.
- Material breach uncured thirty days after written notice.

### Section 9.02: Termination Assistance

For up to twelve months after termination, Helix shall provide data export, transition support, interface documentation, schema mapping, audit logs, and cooperation with Meridian's successor vendor.

### Section 9.03: Data Return and Destruction

Within thirty days after termination assistance ends, Helix shall return all Covered Data in a mutually agreed format and destroy remaining copies, except legally required archival copies. Destruction certification is due within fifteen days after completion.

---

## EXHIBIT A: BUSINESS ASSOCIATE ADDENDUM SUMMARY

Helix shall use PHI only as permitted by Meridian, report breaches, ensure subcontractors agree to equivalent restrictions, make PHI available for access and amendment, support accounting of disclosures, make internal practices available to regulators, and return or destroy PHI at termination.

## EXHIBIT B: APPROVED SUBPROCESSORS

Approved subprocessors are limited to cloud infrastructure hosting, managed database monitoring, email notification delivery, security scanning, and support ticketing vendors listed in Meridian's vendor risk register.

## EXHIBIT C: REQUIRED INTEGRATIONS

Required integrations include HL7 ADT, FHIR API, SFTP claims extracts, SSO through SAML 2.0, SCIM user provisioning, SIEM log forwarding, and API gateway connectivity.
