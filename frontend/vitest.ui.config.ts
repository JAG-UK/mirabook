import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Tier 2: interactive components, rendered into jsdom and driven the way a
// reader would. The API client is mocked per test; nothing here talks to a
// server.
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'ui',
    environment: 'jsdom',
    include: ['tests/ui/**/*.test.tsx'],
    setupFiles: ['tests/setup-ui.ts'],
    restoreMocks: true,
  },
})
