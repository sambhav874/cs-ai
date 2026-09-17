import { defineConfig } from 'vitest/config'

// Integration suite — boots the real Fastify app against a real Postgres
// (DATABASE_URL) + Redis (REDIS_URL) and exercises routes via app.inject().
// Serialized (single fork, no concurrency) so tests share one app + DB without
// racing on data. Run with `pnpm test:integration`.
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['src/test-support/setup.integration.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
