---
name: clm-permissions-rbac
description: How permissions and RBAC work in draftLegal — the p(A.X, R.Y) action/resource pattern in apps/api/src/lib/permissions.ts, the requirePermission middleware, the system-role refresh dance (apps/api/scripts/refresh-system-role-perms.ts) that syncs all 219 system roles, when to add a new action vs reuse existing (the sign vs configure split is the canonical case), org-scoped queries discipline, and cross-org isolation testing. Invoke when the user reports 403 errors, asks to add/change permissions, asks about adding a new role, or asks to test multi-tenant isolation.
---

# Permissions & RBAC

Permissions are silent failures. The user sees a generic 403, has no idea their role lacks the action, and assumes the feature is broken. Multi-tenant org scoping is the same — wrong `orgId` and queries return empty without an error. Both bugs hide.

This skill is the canonical answer for permissions, role management, and multi-tenant safety.

---

## The model: `p(A.action, R.resource)`

Permissions are tuples of (action, resource). One permission unlocks one action on one resource type.

```ts
// apps/api/src/lib/permissions.ts
import { A, R, p } from './permissions'

const LEGAL_COUNSEL_PERMS = [
  p(A.READ,      R.CONTRACT),
  p(A.UPDATE,    R.CONTRACT),
  p(A.SIGN,      R.CONTRACT),     // ← added 2026-05-01
  p(A.READ,      R.CLAUSE),
  p(A.CREATE,    R.CLAUSE),
  // …
]
```

**Actions (`A.*`):** `READ`, `CREATE`, `UPDATE`, `DELETE`, `APPROVE`, `SIGN`, `CONFIGURE`, `INVITE`, `ASSIGN`, …

**Resources (`R.*`):** `CONTRACT`, `CLAUSE`, `TEMPLATE`, `WORKFLOW`, `MATTER`, `USER`, `ROLE`, `ORG`, `SIGNATURE_REQUEST`, …

**Roles** map to a set of permissions. System roles are predefined: `OWNER`, `ADMIN`, `LEGAL_COUNSEL`, `LEGAL_OPS`, `CONTRACT_MANAGER`, `MEMBER`, `VIEWER`, plus org-defined custom roles.

---

## The `requirePermission` middleware

Every protected route gets one. The pattern:

```ts
fastify.post('/contracts/:id/send-for-signature', {
  preHandler: [requireAuth, requirePermission('sign', 'contract')],
}, async (request, reply) => {
  // ... handler body ...
})
```

**The middleware:**
1. Reads the user from the JWT (set by `requireAuth`).
2. Loads the user's role and its permissions for the request's `orgId`.
3. Checks if `(action, resource)` is in the role's permission set.
4. Returns 403 with a typed error if not.

**Lookup is cached** per (userId, orgId) for the request lifetime — don't worry about hitting the DB once per check.

---

## When to add a new action vs reuse existing — the canonical case

The decision: **separate concerns get separate actions**, even if the existing action *could* cover them.

The canonical case study is `sign:contract` vs `configure:contract`.

**Pre-fix state:** send-for-signature, remind, void were gated on `requirePermission('configure', 'contract')`.
**The bug:** `configure` originally meant "configure the contract" (metadata, structural fields). It got loaded with "act as signer admin" (send envelopes, void them) — but those are conceptually different actions:
- `configure` = "I shape this contract." Editor admin / template admin / contract manager need it.
- `sign` = "I drive the signature flow." Anyone who can send for signature needs it; not necessarily editor admin.

A user could legitimately be a signature admin without being a contract editor. The old conflation forced both or neither.

**The fix (2026-05-01):**
1. Added `A.SIGN` action.
2. Added `p(A.SIGN, R.CONTRACT)` to `LEGAL_COUNSEL`, `LEGAL_OPS`, `CONTRACT_MANAGER` (system roles).
3. Switched `apps/api/src/routes/signatures.ts` send/remind/void from `requirePermission('configure', 'contract')` → `requirePermission('sign', 'contract')`.
4. Ran the system-role refresh script to push the new permission to all 219 system roles in DB.

**The lesson:** when a permission keeps "growing" to cover unrelated actions, split it. Future engineers shouldn't have to reason about "does configure include signing? what about voiding?"

**When NOT to add a new action:** if it really is the same concern (e.g. "edit metadata" and "edit description" — both are `update:contract`). Don't proliferate near-duplicates.

---

## The system-role refresh dance — non-obvious but critical

System role permission sets are defined in code (`apps/api/src/lib/permissions.ts`) but persisted in the DB (`role_permissions` table). When you change the in-code definition, **you must sync DB rows** — otherwise:

- New orgs get the updated set (because seed runs the latest code).
- Existing orgs are stuck on the old set until a refresh.

The refresh script:
```bash
pnpm tsx apps/api/scripts/refresh-system-role-perms.ts
```

What it does:
1. For each system role (per org): load current DB permissions.
2. Diff against the in-code definition.
3. Insert new permissions, delete removed ones.
4. Log the diff per role.

**Run it whenever:** you add/remove a permission to a system role. We've shipped this enough times that there's a one-shot script. It synced 219 system roles across our orgs after the `sign` split.

**Idempotent:** safe to run multiple times. Useful in CI / pre-deploy as a drift check.

**Custom (org-defined) roles are NOT touched** — the script only updates system roles. Org admins manage their custom roles via the admin UI.

---

## Multi-tenant org scoping — the silent killer

Every Prisma query that reads or writes org-owned data must include `orgId` in the WHERE clause. Without it:
- Cross-tenant data leak (worst case).
- Empty results when the user expects data (best case — caused by `orgId='system'` or wrong scope).

**The pattern:**
```ts
const contracts = await prisma.contract.findMany({
  where: { orgId: request.orgId, ... },  // ← always
})
```

**Where `request.orgId` comes from:**
- User JWT path: `requireAuth` decodes the JWT and sets `request.orgId` from the active org claim.
- System path (internal-service): `requireAuth` reads `x-org-id` header and sets `request.orgId` from it.

**Ensure both paths set `orgId`.** This was a real bug — internal calls passed `x-org-id` but the middleware ignored it for system-scoped requests, leaving `request.orgId === 'system'` and queries empty.

**Cross-org isolation testing (P34 pattern):**
```js
// Login as user in Org A
const authA = await login('user-a@orga.com')
// Try to read a contract from Org B
const r = await fetch(`${API_BASE}/api/v1/contracts/${orgB_contractId}`, {
  headers: { authorization: `Bearer ${authA.accessToken}` }
})
// Must be 404 (not 403, not 200) — the contract doesn't exist *for this user*.
expect(r.status).toBe(404)
```

`404` not `403` is intentional: returning 403 leaks the existence of a resource in the other org. Treat as "doesn't exist."

---

## Adding a new permission — checklist

Use this when introducing a new action or applying an existing one to a new resource.

1. **Decide: new action or reuse?** If the concern is genuinely separate (sign vs configure), add a new action. Otherwise reuse.
2. **Add the action constant** to `A` enum in `apps/api/src/lib/permissions.ts` (if new).
3. **Add the permission to system roles** that should have it. Use the `p(A.X, R.Y)` helper.
4. **Update the in-code role definitions** for `LEGAL_COUNSEL`, `LEGAL_OPS`, etc. Be conservative — start with fewer roles having it; expand if needed.
5. **Apply `requirePermission`** on the relevant route(s):
   ```ts
   preHandler: [requireAuth, requirePermission('<action>', '<resource>')],
   ```
6. **Run the refresh script:**
   ```bash
   pnpm tsx apps/api/scripts/refresh-system-role-perms.ts
   ```
7. **Update the seed** if the permission affects new-org defaults — `apps/api/prisma/seed.ts` and `apps/api/src/lib/org-seed.ts`.
8. **Probe it:** add or extend a probe that asserts:
   - User WITH the permission can hit the route (200).
   - User WITHOUT the permission gets 403.
   - The 403 has typed body so the UI can render a useful message.
9. **Tracker:** session log row in `BUILD_TRACKER.md`. ADL row if the action represents a new concept (rare).

---

## Adding a new role — checklist

If you're adding a new system role (rare — usually we extend custom roles instead):

1. **Decide: system or custom?** If it's something every org will have (e.g. "Auditor"), system. If it's org-specific ("Acme Approver"), let admins create it via the UI.
2. **Define the role constant** + permissions in `apps/api/src/lib/permissions.ts`.
3. **Add to `SYSTEM_ROLES` array** so the seed creates it for every org.
4. **Update `org-seed.ts`** to create the role on new-org registration.
5. **Run the refresh script** to backfill into existing orgs.
6. **Update the role-picker UI** in admin (`apps/web/src/pages/AdminRolesPage.tsx` or similar).
7. **Probe** — assign a user this role, hit allowed routes, hit blocked routes, confirm matrix.

---

## When the user gets a 403 — diagnosis order

1. **What action + resource?** Look at the route handler's `requirePermission(...)` call. That's the (action, resource) tuple being checked.
2. **What role does the user have for this org?** Query:
   ```sql
   SELECT r.name, r.slug
   FROM users u
   JOIN user_roles ur ON ur."userId" = u.id
   JOIN roles r ON r.id = ur."roleId"
   WHERE u.email = '<email>' AND ur."orgId" = '<orgId>';
   ```
3. **What permissions does that role have?**
   ```sql
   SELECT action, resource FROM role_permissions WHERE "roleId" = '<roleId>' ORDER BY action, resource;
   ```
4. **Is `(action, resource)` in the result?** If no — that's the bug. Either:
   - The role is wrong for this user (re-assign).
   - The role should have this permission (add it + run refresh).
   - The route is over-restrictive (lower the requirement; rare).
5. **If `(action, resource)` IS in the result but they still get 403:** the in-code permission set is out of sync with DB. Run the refresh script.

---

## Anti-patterns

| Anti-pattern | Why it's a trap | Fix |
|--------------|-----------------|-----|
| Adding to a role without running refresh | Existing orgs don't see the change. | Always `pnpm tsx apps/api/scripts/refresh-system-role-perms.ts` after editing system role perms. |
| Hardcoding role names in handlers | `if (user.role === 'ADMIN')` couples logic to role names. | Use `requirePermission('action', 'resource')` — works for any role with the permission, including custom roles. |
| Missing `orgId` in WHERE clause | Empty results or cross-tenant leak. | Always `where: { orgId: request.orgId, ... }`. |
| Treating `request.orgId === 'system'` as "all orgs" | Internal-service calls get empty results because no contract has `orgId: 'system'`. | When system path needs to act on a real org, pass `x-org-id` header; middleware sets `request.orgId` from it. |
| 403 with no body | UI shows generic "forbidden"; user has no idea what to ask admin for. | Return `{ error: 'permission_denied', requiredAction: 'sign', requiredResource: 'contract' }` so the UI can render "Ask your admin to grant Sign permission for contracts." |
| Conflating actions ("configure" doing too much) | One permission grants way more than its name implies; security review nightmare. | Split actions when concerns diverge. The `sign` vs `configure` split is the template. |
| Permissions only checked client-side | Trivially bypassed by curl. | Always enforce server-side in `requirePermission`. Client-side is only for UX (hide buttons). |

---

## Cross-org safety probes (P34 pattern)

Every multi-tenant route should have a cross-org isolation probe. The shape:

```js
// scripts/feature-integrity/probes/PNN-<route>-isolation.mjs
const orgA = await login('user-a@orga.com')
const orgB = await login('user-b@orgb.com')

// Create resource in Org B
const created = await apiPost(orgB.accessToken, '/api/v1/<resource>', { ... })

// Try to read from Org A
const leak = await fetch(`${API_BASE}/api/v1/<resource>/${created.id}`, {
  headers: { authorization: `Bearer ${orgA.accessToken}` },
})

if (leak.status !== 404) {
  return result({ id: 'PNN-isolation', status: 'fail', severity: 'critical',
    evidence: `cross-org read returned ${leak.status} — leak risk` })
}
```

Severity: **critical** — cross-org leaks are unshippable.

We have one for contracts (P34), should have for: clauses, templates, workflows, signature requests, obligations, invoices, comments, attachments. If you add a new resource type, add the probe.

---

## File-path cheat sheet

| Need | File |
|------|------|
| Action / resource constants + role definitions | `apps/api/src/lib/permissions.ts` |
| `requirePermission` middleware | `apps/api/src/middleware/permissions.ts` (or wherever it's exported from) |
| `requireAuth` (sets `request.orgId`) | `apps/api/src/middleware/auth.ts` |
| System-role refresh (THE script) | `apps/api/scripts/refresh-system-role-perms.ts` |
| Per-org seed (new-org defaults) | `apps/api/src/lib/org-seed.ts` |
| Initial seed | `apps/api/prisma/seed.ts` |
| Admin role UI | `apps/web/src/pages/AdminRolesPage.tsx` (or similar — search for "RolePicker") |
| Custom role CRUD endpoints | `apps/api/src/routes/roles.ts` |
| Cross-org probe template | `scripts/feature-integrity/probes/P34-*.mjs` |

---

## Useful seeded roles + users

From `apps/api/prisma/seed.ts`:

| User | Role | Has |
|------|------|-----|
| `aniket.tatipamula@docsumo.com` | `OWNER` | Everything |
| `maya.chen@vertex.cloud` | `LEGAL_COUNSEL` | Most contract ops including `sign:contract` |
| `<seeded admin>` | `ADMIN` | Everything except org-level destructive ops |
| `<seeded ops>` | `LEGAL_OPS` | Operations + assignments + signature send |
| `<seeded manager>` | `CONTRACT_MANAGER` | Contract lifecycle + signature |
| `<seeded member>` | `MEMBER` | Read + comment, limited write |
| `<seeded viewer>` | `VIEWER` | Read-only |

(Run `pnpm seed` and check `users` table for current set.)

---

## When permissions get in the way of the agent

The agent acts on behalf of the user — its tool calls inherit the user's permissions. If the agent says "I can't do X," it might be:
1. Genuine permission denial (user lacks `(action, resource)`).
2. Routing rule mismatch (agent picked the wrong tool).
3. Refusal calibration miscalibrated (agent thinks it can't, but actually could).

For (1), the user needs role escalation — surface the permission name in the agent's message so they know what to ask admin for. For (2)+(3), see the `clm-debug-multilayer` skill (Layer 2).

The agent should NEVER bypass permission checks. Internal-service tool calls scope to the user's `orgId` and the user's permissions are enforced at the route layer. If a tool needs elevated access (e.g. `system_audit_export`), gate it on a separate `audit:export` permission.
