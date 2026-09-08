import { defineConfig } from 'vitest/config'

// Tier 1: pure logic. No DOM, no components, no network — just the functions
// that fail quietly. Runs in Node with a hand-rolled localStorage, so this
// suite stays fast and needs nothing beyond vitest itself.
export default defineConfig({
  test: {
    name: 'logic',
    environment: 'node',
    include: ['tests/logic/**/*.test.ts'],
    setupFiles: ['tests/setup-logic.ts'],
  },
})
