# Security Policy

draftLegal handles contracts — among the most sensitive documents an
organization has. We take security seriously and appreciate responsible
disclosure from the community.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, report it privately through GitHub's security advisory flow:

➡️ **[Report a vulnerability](https://github.com/AniketTati/draft-legal/security/advisories/new)**

(Repo → **Security** tab → **Report a vulnerability**.)

This keeps the details private until a fix is available, protecting everyone
who self-hosts draftLegal.

If you can't use the advisory flow, email the maintainer (see the address on
the GitHub profile) with the subject line `SECURITY: draftLegal`.

### What to include

- A description of the vulnerability and its impact
- Steps to reproduce (a proof-of-concept is ideal)
- Affected version / commit, and your environment
- Any suggested remediation, if you have one

### What to expect

- **Acknowledgement** within 3 business days.
- An initial assessment and severity rating within 7 business days.
- Regular updates as we work on a fix.
- Credit in the advisory and release notes once it's resolved — unless you'd
  prefer to remain anonymous.

We ask that you give us a reasonable window to ship a fix before any public
disclosure. We will not pursue legal action against good-faith researchers who
follow this policy.

## Supported versions

draftLegal is pre-1.0 and moves fast. Security fixes land on the `main` branch.
Self-hosters should track `main` (or tagged releases once we begin tagging) to
stay current.

## Scope notes for self-hosters

Because draftLegal is self-hosted, **you operate your own deployment** — the
security of your instance depends on how you run it. A few things that are your
responsibility, not the project's:

- **Secrets.** Set strong values for `JWT_SECRET`, `PORTAL_JWT_SECRET`,
  `INTERNAL_SERVICE_SECRET`, and `AI_KEY_ENCRYPTION_KEY`. Never commit your
  `.env`. The defaults in `.env.example` are placeholders, not safe values.
- **Network exposure.** The default `docker compose` setup binds services for
  local development. Put a reverse proxy with TLS in front of anything
  internet-facing, and don't expose Postgres / Redis / Elasticsearch / MinIO
  ports publicly.
- **Provider keys.** Your LLM API keys live in your environment and your
  contracts are sent to whichever provider you configure. Choose accordingly
  for regulated data.

Vulnerabilities in the draftLegal code itself — auth bypass, injection,
broken access control, data leakage across orgs, etc. — are exactly what we
want to hear about via the advisory flow above.

Thank you for helping keep draftLegal and its users safe. 🔒
