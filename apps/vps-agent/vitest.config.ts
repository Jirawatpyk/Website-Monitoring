import { defineConfig } from 'vitest/config';

// VPS agent: src/index.ts (loops + signals) and src/browser.ts (Playwright glue) are exercised by running the
// bundle against a real browser; everything else is measured.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/browser.ts'],
      reporter: ['text-summary', 'text', 'html'],
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 60 },
    },
  },
});
