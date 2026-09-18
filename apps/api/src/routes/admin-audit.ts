import type { FastifyInstance } from 'fastify'

// Stub — real admin-audit routes were not committed in this snapshot.
// Registers no routes so the server can boot.
export async function adminAuditRoutes(_app: FastifyInstance): Promise<void> {
  // intentionally empty
}
