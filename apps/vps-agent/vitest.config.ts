import { defineConfig } from 'vitest/config';

// VPS agent: src/index.ts is the process entry (loop + signals) and is exercised by running the bundle; everything else is measured.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      reporter: ['text-summary', 'text', 'html'],
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 60 },
    },
  },
});
