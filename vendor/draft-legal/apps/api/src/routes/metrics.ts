import type { FastifyInstance } from 'fastify'

// Stub — real metrics routes were not committed in this snapshot.
// Registers no routes so the server can boot.
export async function metricsRoutes(_app: FastifyInstance): Promise<void> {
  // intentionally empty
}
