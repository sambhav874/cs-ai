import type { FastifyRequest, FastifyReply } from 'fastify'
import crypto from 'node:crypto'
import type { Permission } from '@clm/types'
import { verifyToken, type JwtPayload } from '../lib/jwt.js'
import { prisma } from '../lib/prisma.js'
import { resolveApiScopePermissions } from '../lib/permissions.js'

declare module 'fastify' {
  interface FastifyRequest {
    // `apiPermissions` is set only on public-API-key requests (Wave 1.2):
    // the key's scopes resolved to a concrete permission set. When present,
    // requirePermission evaluates it directly instead of role lookup.
    user: JwtPayload & { apiPermissions?: Permission[] }
  }
}

const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET

// API keys carry a `clm_` prefix so we can distinguish them from JWTs
// in the same Authorization: Bearer header.
const API_KEY_PREFIX = 'clm_'

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

export { API_KEY_PREFIX }

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  // Allow internal service-to-service calls (agents → api).
  // Trusted callers can pass `x-org-id` to scope queries to a real
  // org (e.g. the draft agent fetching templates for the requesting
  // org's user). When absent, we fall back to the legacy 'system'
  // sentinel which most route handlers special-case.
  if (
    INTERNAL_SECRET &&
    req.headers['x-internal-service'] === 'agents' &&
    req.headers['x-internal-secret'] === INTERNAL_SECRET
  ) {
    const orgIdHeader = (req.headers['x-org-id'] as string | undefined)?.trim()
    req.user = {
      sub: 'system',
      orgId: orgIdHeader || 'system',
      roles: ['ADMIN'],
      type: 'access',
    } as any
    return
  }

  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return reply.status(401).send({
      type: 'https://httpstatuses.com/401',
      title: 'Unauthorized',
      status: 401,
      detail: 'Missing or invalid Authorization header',
    })
  }
  const token = header.slice(7)

  // ── API key path (P10A) ──
  // Public-API customers send their key in the same Authorization: Bearer
  // header. We disambiguate by the `clm_` prefix.
  if (token.startsWith(API_KEY_PREFIX)) {
    try {
      const keyHash = hashApiKey(token)
      const key = await prisma.apiKey.findUnique({
        where: { keyHash },
        select: { id: true, orgId: true, scopes: true, expiresAt: true, revokedAt: true },
      })
      if (!key || key.revokedAt) {
        return reply.status(401).send({ title: 'Unauthorized', detail: 'API key invalid or revoked', status: 401 })
      }
      if (key.expiresAt && key.expiresAt < new Date()) {
        return reply.status(401).send({ title: 'Unauthorized', detail: 'API key expired', status: 401 })
      }
      // Best-effort lastUsedAt update.
      prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
        .catch(() => { /* ignore */ })

      // Wave 1.2 — resolve the key's scopes to concrete permissions. Empty
      // scopes → no permissions (previously this silently became org ADMIN).
      // Scope strings are NOT role names; they map via API_SCOPE_PERMISSIONS.
      req.user = {
        sub:   `apikey:${key.id}`,
        orgId: key.orgId,
        roles: [],
        type:  'access',
        apiPermissions: resolveApiScopePermissions(key.scopes),
      }
      return
    } catch {
      return reply.status(401).send({ title: 'Unauthorized', detail: 'API key auth failed', status: 401 })
    }
  }

  // ── JWT path (existing) ──
  try {
    const payload = verifyToken(token)
    if (payload.type !== 'access') throw new Error('Not an access token')
    req.user = payload
  } catch {
    return reply.status(401).send({
      type: 'https://httpstatuses.com/401',
      title: 'Unauthorized',
      status: 401,
      detail: 'Token invalid or expired',
    })
  }
}

export function requireRole(...roles: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(req, reply)
    if (reply.sent) return

    const hasRole = roles.some((r) => req.user.roles.includes(r))
    if (!hasRole) {
      return reply.status(403).send({
        type: 'https://httpstatuses.com/403',
        title: 'Forbidden',
        status: 403,
        detail: `Required role: ${roles.join(' or ')}`,
      })
    }
  }
}
