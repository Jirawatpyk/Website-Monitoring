import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Integration tests against the LOCAL Supabase stack (`pnpm db:start`): real tables, SQL functions
// and constraints. Run in the CI `db` job; never part of `pnpm test`.
export default defineConfig({
  resolve: {
    alias: { '@': here('./src'), 'server-only': here('./test/server-only.ts') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    testTimeout: 30_000,
  },
});
