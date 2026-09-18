import { defineConfig } from 'vitest/config'

// Default (unit) suite — fast, no database. Integration tests live in
// *.integration.test.ts and are excluded here; run them with `pnpm test:integration`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
  },
})
