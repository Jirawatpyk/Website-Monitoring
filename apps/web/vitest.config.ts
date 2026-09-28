import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Unit and component tests for the web app (`src/**/*.test.ts(x)`). Browser flows live in e2e/ (Playwright).
export default defineConfig({
  resolve: {
    alias: {
      '@': here('./src'),
      // `server-only` throws outside React Server Components; tests import server modules directly.
      'server-only': here('./test/server-only.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
