/**
 * Integration-test setup — runs before any integration test module is imported,
 * so env is in place before prisma/jwt/queue read it. DATABASE_URL and REDIS_URL
 * come from the environment (CI service containers, or the local run command);
 * everything else gets a safe default.
 */
process.env.NODE_ENV ??= 'test'
// >=32 chars and not a denylisted placeholder (see lib/secrets.ts).
process.env.JWT_SECRET ??= 'integration-test-jwt-secret-32chars-minimum'
process.env.PORTAL_JWT_SECRET ??= 'integration-portal-secret-32chars-minimum'
process.env.INTERNAL_SERVICE_SECRET ??= 'integration-internal-service-secret'
// Don't start the collab WebSocket server or in-process workers during tests.
process.env.COLLAB_DISABLED ??= '1'
process.env.WORKERS_ENABLED ??= 'false'
