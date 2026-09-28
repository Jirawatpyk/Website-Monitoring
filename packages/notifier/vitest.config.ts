import { defineConfig } from 'vitest/config';

// Chat / email message builders: pure code.
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
