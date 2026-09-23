/**
 * Service-to-service authentication: the shared INTERNAL_SERVICE_SECRET.
 *
 * One comparison for every internal caller, so none of them can drift into a
 * plain `===` (which leaks the secret's prefix through response timing) or
 * into accepting an empty secret when the variable is unset.
 */
import crypto from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'

export function isInternalSecret(presented: unknown, expected = process.env.INTERNAL_SERVICE_SECRET): boolean {
  if (!expected || typeof presented !== 'string' || !presented) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** preHandler for routes only other services may call. */
export async function requireInternalSecret(req: FastifyRequest, reply: FastifyReply) {
  if (!isInternalSecret(req.headers['x-internal-secret'])) {
    return reply.status(401).send({ detail: 'Internal endpoint — bad secret' })
  }
}
