import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/browser/**'],
    environment: 'node',
    maxWorkers: 2,
    testTimeout: 30000,
  },
})
