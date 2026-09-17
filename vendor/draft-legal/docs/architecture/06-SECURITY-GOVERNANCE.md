# 06 — Security & Governance

## Authentication

- **Provider**: Auth0 or Clerk (configurable per deployment)
- **Protocol**: OIDC / OAuth 2.0 with PKCE for SPAs
- **SSO**: SAML 2.0 and OIDC for enterprise directory integration (Okta, Azure AD, OneLogin)
- **MFA**: Required for all users. TOTP or WebAuthn/passkeys.
- **Session**: JWT access tokens (15 min expiry) + refresh tokens (7 day expiry, rotation). Tokens contain `user_id`, `org_id`, `roles[]`.
- **API keys**: For machine-to-machine integrations. Scoped per integration. Rotatable.
- **External portal access**: Time-limited signed URLs. No account required. Link expiry configurable (24h–30d).

## Authorization (RBAC)

### Permission Model

```
User ──has──► Role(s) ──grants──► Permission(s)

Permission = (action, resource_type, scope)
  action:        view | edit | create | delete | approve | sign | configure | export
  resource_type: contract | request | template | clause | playbook | workflow | report | user | integration
  scope:         own | team | department | org-wide
```

### Default System Roles

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| Admin | Full system access | All actions, all resources, org-wide |
| Legal Counsel | Legal team member | View/edit/create/approve contracts; manage clauses/playbook |
| Legal Ops | Legal operations manager | All legal permissions + workflows + integrations + analytics |
| Contract Manager | Manage contract lifecycle | View/edit/create contracts; manage templates |
| Sales Rep | Request and track contracts | Create requests; view own contracts; cannot edit legal terms |
| Procurement Manager | Vendor contract management | Full contract access for vendor/procurement types |
| Finance | Financial visibility | View contracts; view obligations; invoice reconciliation |
| Approver | Approve contracts | View + approve only (no edit) |
| External Guest | Counterparty access | View/redline specific shared contract only (portal access) |

### Enforcement Points

1. **API middleware**: Every request checked against RBAC before reaching business logic
2. **Agent boundary**: Agents inherit the invoking user's permissions. Agent cannot exceed user's access.
3. **UI rendering**: Navigation items and actions hidden for unauthorized users (defense in depth — API still enforces)
4. **Database RLS**: PostgreSQL row-level security as final safety net

```sql
-- Example RLS policy
CREATE POLICY org_isolation ON contracts
  USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE POLICY role_access ON contracts
  USING (
    current_setting('app.current_user_role') = 'admin'
    OR assigned_to = current_setting('app.current_user_id')::uuid
    OR current_setting('app.current_user_role') IN ('legal_counsel', 'legal_ops')
  );
```

## Audit Trail

### Immutable Audit Log

Every action in the system creates an audit event. The `audit_events` table is **append-only** — no UPDATE or DELETE operations are permitted. This is enforced at the database level with a trigger.

```sql
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit events cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER no_audit_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
```

### What Gets Logged

Every event includes: who (user or agent), what (action), when (timestamp), where (IP, session), why (agent reasoning/confidence), and the before/after state for data changes.

| Category | Events Logged |
|----------|---------------|
| Authentication | Login, logout, failed login, MFA challenge, password change |
| Contract lifecycle | Create, edit, version save, status change, delete, archive |
| Negotiation | Redline sent, counter-proposal generated, clause accepted/rejected |
| Approval | Request, approval, rejection, delegation, escalation, timeout |
| Signature | Sent, viewed, signed, declined, voided, reminder sent |
| Agent actions | Every agent invocation with input, output, confidence, model used, token count |
| Configuration | Template/clause/playbook/workflow changes, role/permission changes |
| Integration | Sync events, errors, data mapping changes |
| Access | Document viewed, downloaded, shared, exported |

## Encryption

| Data State | Method |
|------------|--------|
| In transit | TLS 1.3 for all connections (API, WebSocket, database, S3, external APIs) |
| At rest (database) | AES-256 via PostgreSQL TDE or AWS RDS encryption |
| At rest (documents) | AES-256 via S3 server-side encryption (SSE-S3 or SSE-KMS) |
| At rest (credentials) | Application-level encryption (AES-256-GCM) with per-org keys |
| Search indexes | Elasticsearch encryption at rest enabled |
| Backups | Encrypted with separate key from primary data |

### Key Management

- AWS KMS (or HashiCorp Vault for self-hosted) for master key management
- Per-org encryption keys for document storage (enterprise tier)
- Automatic key rotation every 90 days
- Key access logged in audit trail

## Compliance Features

| Standard | How We Support It |
|----------|-------------------|
| SOC 2 Type II | Audit trail, access controls, encryption, monitoring, incident response |
| GDPR | Data residency options, right to deletion, consent tracking, DPA management |
| CCPA | Data inventory, deletion requests, opt-out tracking |
| HIPAA | BAA support, PHI isolation, audit logs, encryption (enterprise tier) |
| FedRAMP | Planned for government tier — separate deployment |

### Data Residency

Enterprise customers can choose data region: US, EU, APAC. All data (database, documents, search indexes, vector embeddings) stored within chosen region. Agent LLM calls routed to region-appropriate endpoints where available.

### Data Retention

- Configurable per org: 1 year, 3 years, 7 years, indefinite
- Audit events: minimum 7 years (regulatory requirement for most industries)
- Deleted contracts: soft-deleted, purged after retention period
- Backups: retained for 90 days after deletion

## Security Monitoring

| What | Tool | Alert Threshold |
|------|------|-----------------|
| Failed logins | Auth0/Clerk + Sentry | 5 failed attempts in 10 min → account lock |
| API rate limiting | Fastify rate-limiter | 1000 req/min per org |
| Unusual agent activity | Custom monitoring | Agent actions outside normal patterns |
| Data exfiltration | API monitoring | Bulk export > 1000 contracts in 1 hour |
| Permission escalation | Audit log analysis | Role/permission changes flagged for review |
| Integration credential exposure | Vault monitoring | Credential access logged and alerted |
