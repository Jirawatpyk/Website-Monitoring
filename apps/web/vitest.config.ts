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
    coverage: {
      provider: 'v8',
      // Logic layers only. Routes and page UI are covered by e2e and spec-checker; the Supabase
      // client factories are thin adapters over @supabase/ssr and next/headers.
      include: ['src/lib/**', 'src/features/**', 'src/server/**', 'src/components/**'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/lib/supabase/client.ts', 'src/lib/supabase/server.ts'],
      reporter: ['text-summary', 'text', 'html'],
      // Ratchet: raise these as features land; never lower them to make a PR pass.
      thresholds: { lines: 80, statements: 80, functions: 70, branches: 75 },
    },
  },
});
