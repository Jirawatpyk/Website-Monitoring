import { defineConfig } from 'vitest/config';

// HTTP check + classification, tested against a local HTTP server.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text-summary', 'text', 'html'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
  },
});
