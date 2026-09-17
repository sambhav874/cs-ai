/**
 * SaaS industry pack — adds SaaS-specific clauses, templates, and playbook
 * positions on top of the universal library. Categorized into existing
 * universal categories (no new categories created by packs).
 */
import type { SeedClause }            from '../universal/clauses.js'
import type { SeedTemplate }          from '../universal/templates.js'
import type { SeedPlaybookPosition }  from '../universal/playbook.js'

export const SAAS_CLAUSES: SeedClause[] = [
  {
    categorySlug: 'service-levels', title: 'Multi-Region High Availability',
    content: `<p>Provider operates the Services across at least two geographically-separated regions in an active-active configuration designed to maintain availability in the event of a regional outage. Customer Data is replicated synchronously within a region and asynchronously across regions.</p>`,
    tags: ['saas', 'sla', 'ha', 'multi-region'], riskRating: 'favorable', isApproved: true,
  },
  {
    categorySlug: 'service-levels', title: 'Disaster Recovery — RPO/RTO Commitment',
    content: `<p>Provider will maintain a Recovery Point Objective (RPO) of no more than 1 hour and a Recovery Time Objective (RTO) of no more than 4 hours. Provider will test its DR procedures at least annually and provide a summary of test results to Customer upon request.</p>`,
    tags: ['saas', 'dr', 'rpo', 'rto'], riskRating: 'favorable', isApproved: true,
  },
  {
    categorySlug: 'ip-ownership', title: 'Customer Data Export',
    content: `<p>At any time during the Term and for up to 90 days after termination, Customer may export its Customer Data in a structured, commonly-used, machine-readable format (such as JSON or CSV) at no additional cost. Provider will provide reasonable assistance with the export process.</p>`,
    tags: ['saas', 'data-export', 'portability'], riskRating: 'favorable', isApproved: true,
  },
  {
    categorySlug: 'scope-services', title: 'API Rate Limits',
    content: `<p>Provider may apply commercially reasonable rate limits to API access to maintain service quality for all customers. Provider will publish current rate limits in its Documentation. Customer may purchase additional rate-limit capacity at then-current rates.</p>`,
    tags: ['saas', 'api', 'rate-limits'], riskRating: 'neutral', isApproved: true,
  },
  {
    categorySlug: 'security', title: 'Tenant Isolation',
    content: `<p>Provider will maintain logical isolation between tenant environments such that no tenant can access another tenant's Customer Data, including in shared infrastructure. Provider's tenant-isolation controls are validated annually as part of Provider's SOC 2 Type II audit.</p>`,
    tags: ['saas', 'security', 'multi-tenant'], riskRating: 'favorable', isApproved: true,
  },
  {
    categorySlug: 'service-levels', title: 'Scheduled Maintenance Window',
    content: `<p>Provider will perform Scheduled Maintenance during a designated maintenance window of no more than 4 hours per month, scheduled outside of Customer's primary business hours where reasonably practicable. Scheduled Maintenance does not count against the uptime commitment provided that Provider gives at least 72 hours' advance notice.</p>`,
    tags: ['saas', 'maintenance'], riskRating: 'standard', isApproved: true,
  },
  {
    categorySlug: 'fees-payment', title: 'True-Up / Overage Billing',
    content: `<p>If Customer's actual usage exceeds the licensed limits (e.g., authorized users, API calls, or storage), Customer will pay overage fees at the then-current published rates, billed monthly in arrears. Provider will provide Customer with usage reports and a 30-day window to reduce usage before overage charges apply.</p>`,
    tags: ['saas', 'overage', 'true-up'], riskRating: 'neutral', isApproved: true,
  },
  {
    categorySlug: 'data-privacy', title: 'Customer-Managed Encryption Keys (CMEK)',
    content: `<p>If Customer elects to use Customer-managed encryption keys for Customer Data at rest, Provider will support standard integrations with major key management services (AWS KMS, Google Cloud KMS, Azure Key Vault). Customer is responsible for key lifecycle management and any availability impact resulting from key access issues.</p>`,
    tags: ['saas', 'cmek', 'byok-key', 'encryption'], riskRating: 'favorable', isApproved: true,
  },
]

export const SAAS_TEMPLATES: SeedTemplate[] = [
  {
    name: 'API Access Addendum',
    description: 'Addendum permitting programmatic API access to the SaaS Service with rate-limit and security terms.',
    contractType: 'Addendum',
    isPublished: true,
    variables: [
      { key: 'serviceName',     label: 'Service Name',           type: 'string', required: true },
      { key: 'customerName',    label: 'Customer Name',          type: 'string', required: true },
      { key: 'providerName',    label: 'Provider Name',          type: 'string', required: true },
      { key: 'effectiveDate',   label: 'Effective Date',         type: 'date',   required: true },
      { key: 'rateLimitDescription', label: 'Rate Limit',        type: 'string', required: true, defaultValue: '10,000 requests per minute per token' },
    ],
    sections: [
      { title: 'Scope',           sortOrder: 10, content: `<p>This API Access Addendum, effective {{effectiveDate}}, supplements the existing agreement between {{customerName}} and {{providerName}} for {{serviceName}} and authorizes Customer's programmatic API access.</p>` },
      { title: 'Authentication',  sortOrder: 20, content: `<p>API access requires authentication via OAuth 2.0 or signed API tokens. Customer is responsible for securely managing its tokens and for all activity performed using its tokens.</p>` },
      { title: 'Rate Limits',     sortOrder: 30, content: `<p>{{rateLimitDescription}}. Provider may modify rate limits with reasonable advance notice.</p>` },
      { title: 'Acceptable Use',  sortOrder: 40, content: `<p>Customer will not use the API to (a) scrape data of users other than Customer's own end users; (b) bypass security or rate-limit controls; or (c) build a service that competes with the Service.</p>` },
    ],
  },
]

export const SAAS_PLAYBOOK: SeedPlaybookPosition[] = [
  { key: 'saas-uptime-99.95',         categorySlug: 'service-levels',  positionType: 'preferred',  content: `<p>99.95% monthly uptime, multi-region HA, RPO 15min / RTO 1hr. Annual DR test.</p>`,                                  notes: 'Mission-critical SaaS.',                                                            riskThreshold: 0.8, contractTypes: ['SaaS', 'Subscription'], sortOrder: 5 },
  { key: 'saas-data-export',          categorySlug: 'ip-ownership',    positionType: 'preferred',  content: `<p>Customer can export all data at any time, no fee. 90-day post-termination access for export.</p>`,                  notes: 'Avoid vendor lock-in.',                                                             riskThreshold: 0.7, contractTypes: ['SaaS', 'Subscription'], sortOrder: 5 },
  { key: 'saas-api-rates',            categorySlug: 'scope-services',  positionType: 'acceptable', content: `<p>Published rate limits with reasonable headroom for normal usage; ability to purchase additional capacity.</p>`,         notes: 'Verify limits fit usage.',                                                          riskThreshold: 0.5, contractTypes: ['SaaS', 'Subscription'], sortOrder: 5 },
  { key: 'saas-tenant-isolation',     categorySlug: 'security',        positionType: 'preferred',  content: `<p>Logical tenant isolation validated in SOC 2 Type II. No customer access to other tenants under any circumstances.</p>`, notes: 'Critical for regulated industries.',                                                riskThreshold: 0.8, contractTypes: ['SaaS', 'Subscription'], sortOrder: 5 },
  { key: 'saas-cmek',                 categorySlug: 'data-privacy',    positionType: 'preferred',  content: `<p>Customer-managed encryption keys (CMEK) supported via standard KMS integration. Encryption at rest with key rotation.</p>`, notes: 'Required for some regulated industries.',                                       riskThreshold: 0.7, contractTypes: ['SaaS', 'Subscription'], sortOrder: 5 },
  { key: 'saas-overage-walkaway',     categorySlug: 'fees-payment',    positionType: 'walkaway',   content: `<p>Punitive overage rates (&gt; 2x list) with no notice period or grace.</p>`,                                                   notes: 'Reject — exposes customer to bill-shock.',                                          riskThreshold: 0.2, contractTypes: ['SaaS', 'Subscription'], sortOrder: 5 },
]
