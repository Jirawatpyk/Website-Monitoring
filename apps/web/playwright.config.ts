import { defineConfig, devices } from '@playwright/test';

const PORT = 3500;
const isCI = Boolean(process.env.CI);

/**
 * Browser flows (e2e/). Two projects match the design's canvas sizes: desktop 1440 and phone 390.
 * Locally Playwright starts `pnpm dev` (or reuses one already on :3500); in CI it runs the built app.
 * Signed-in specs locally: run `pnpm dev:e2e` first (the built app, as CI) — under parallel specs the
 * dev server drops the stream a server action returns (apps/web/CLAUDE.md → Testing).
 * Placeholder Supabase values are enough for signed-out flows; signed-in flows need a local stack.
 */
const DESKTOP = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
const MOBILE = {
  ...devices['Desktop Chrome'],
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
};
/** Specs that put the monitor into a fault (agent_heartbeats): run last, in their own projects. */
const FAULT_SPECS = /probes\.spec\.ts$/;

export default defineConfig({
  testDir: './e2e',
  // The monitor-fault specs' shared beats are cleared once, after every project (S12b).
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: true,
  // A laptop runs the database, the app and the browsers together: half its cores (the default; 6 on a
  // 12-core machine) streamed heavy pages past their waits (23 Nov 2026). CI keeps the default.
  workers: isCI ? undefined : 4,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // Fail the run instead of hanging a CI runner.
  // Under the db step's 10 min: every signed-in spec now runs there (S09 review), with a retry.
  globalTimeout: isCI ? 9 * 60_000 : 0,
  reporter: isCI ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
  // A laptop running every spec at once against `pnpm dev:e2e` streams a heavy page past 5 s now and
  // then (the audit log, 23 Nov 2026); CI's runner keeps the default.
  expect: { timeout: isCI ? 5_000 : 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  // The monitor-fault specs age the shared engine beats (a fault on every page): they run in their own
  // projects, after every other spec, so no page under test sees a fault it didn't ask for (S12b CI).
  projects: [
    { name: 'desktop', testIgnore: FAULT_SPECS, use: DESKTOP },
    { name: 'mobile', testIgnore: FAULT_SPECS, use: MOBILE },
    { name: 'fault-desktop', testMatch: FAULT_SPECS, dependencies: ['desktop', 'mobile'], use: DESKTOP },
    { name: 'fault-mobile', testMatch: FAULT_SPECS, dependencies: ['desktop', 'mobile'], use: MOBILE },
  ],
  webServer: {
    // In CI run Next directly: behind `pnpm start` the Next process didn't exit when Playwright stopped
    // the server on Linux, and the job hung after the tests.
    command: isCI ? `node node_modules/next/dist/bin/next start --port ${PORT}` : 'pnpm dev',
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'e2e-placeholder',
    },
  },
});
