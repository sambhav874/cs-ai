import { defineConfig } from 'vitest/config'

// Default (unit) suite — fast, no database. Integration tests live in
// *.integration.test.ts and are excluded here; run them with `pnpm test:integration`.
export default defineConfig({
  test: {
    // scripts/ is included so one-shot migrations can have their decision
    // logic tested without a database.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
  },
})
