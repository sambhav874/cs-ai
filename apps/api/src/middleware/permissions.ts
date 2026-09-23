/**
 * Permission middleware — requirePermission(action, resource).
 * Replaces the unused requireRole() as the standard RBAC enforcement.
 * Per 06-SECURITY-GOVERNANCE.md: "Every request checked against RBAC before reaching business logic"
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import { requireAuth } from './auth.js'
import { getPermissionsForRoles, evaluatePermission } from '../lib/permissions.js'
import { prisma } from '../lib/prisma.js'

declare module 'fastify' {
  interface FastifyRequest {
    permissionScope?: string | null
  }
}

/**
 * Fastify preHandler that checks the current user has the required permission.
 * On success, attaches `req.permissionScope` for route handlers to use in query filtering.
 *
 * Usage:
 *   { preHandler: [requirePermission('view', 'contract')] }
 *   { preHandler: [requirePermission('configure', 'user')] }
 */
export function requirePermission(action: string, resource: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // First ensure user is authenticated
    await requireAuth(req, reply)
    if (reply.sent) return

    // System/internal calls (agents service) are always granted org scope
    if (req.user.sub === 'system') {
      req.permissionScope = 'org'
      return
    }

    // Wave 1.2 — public-API-key requests carry pre-resolved permissions from
    // their scopes; evaluate those directly (no role lookup). Empty scopes →
    // empty permissions → denied.
    const { orgId, roles } = req.user
    const permissions = req.user.apiPermissions ?? await getPermissionsForRoles(orgId, roles)
    const result = evaluatePermission(permissions, action, resource)

    if (!result.granted) {
      return reply.status(403).send({
        type: 'https://httpstatuses.com/403',
        title: 'Forbidden',
        status: 403,
        detail: `Missing permission: ${action}:${resource}`,
      })
    }

    // Attach scope so route handlers can filter queries accordingly
    req.permissionScope = result.scope
  }
}

/**
 * requirePermission for routes addressed by a contract id, plus ownership for
 * roles whose contract permission is scoped to their own (SALES_REP).
 *
 * The contracts LIST filtered an own-scoped user to their contracts, but every
 * route taking `:id` checked only the permission — so the same user could read
 * or act on any contract in the org by id. A contract outside their scope
 * answers 404, exactly like one that does not exist.
 */
export function requireContractPermission(action: string, param = 'id') {
  const base = requirePermission(action, 'contract')
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await base(req, reply)
    if (reply.sent || req.permissionScope !== 'own') return
    const contractId = (req.params as Record<string, string> | undefined)?.[param]
    if (!contractId) return
    const contract = await prisma.contract.findFirst({
      where:  { id: contractId, orgId: req.user.orgId },
      select: { ownerId: true },
    })
    if (contract && contract.ownerId !== req.user.sub) {
      return reply.status(404).send({ detail: 'Contract not found' })
    }
  }
}
