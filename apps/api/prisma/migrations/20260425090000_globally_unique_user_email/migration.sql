-- P7.0.1 — Multi-tenant login routing fix (F-30 from docs/audit-2026-04-25.md).
--
-- BEFORE: Users were unique per (orgId, email). Two orgs could each have
-- a `legal@demo.com`. Login auth used `findFirst({ where: { email } })`
-- with no orgId scope → first match wins → user routed to the wrong org.
--
-- AFTER: Email is globally unique. One email = one user account. The
-- composite [orgId, email] unique is preserved so existing upsert paths
-- (org-seed, invite acceptance) continue to work.
--
-- Pre-flight: cleanup script already disambiguated all duplicate emails
-- by appending `-org-<slug>` to the older row's email. Verified zero
-- duplicates before applying.

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
