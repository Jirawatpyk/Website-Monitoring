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
    // One queue for every file: a dispatch claims, and `onlyMine` cancels, other files' messages, so
    // the files run one after another (S09b: window messages share the queue with incidents).
    fileParallelism: false,
  },
});
