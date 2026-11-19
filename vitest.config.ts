import { defineConfig } from 'vitest/config'

// Kept apart from vite.config.ts: vitest ships its own Vite types, which clash with the app's Vite version.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
