import { defineConfig, devices } from '@playwright/test';

const PORT = 3500;
const isCI = Boolean(process.env.CI);

/**
 * Browser flows (e2e/). Two projects match the design's canvas sizes: desktop 1440 and phone 390.
 * Locally Playwright starts `pnpm dev` (or reuses one already on :3500); in CI it runs the built app.
 * Placeholder Supabase values are enough for signed-out flows; signed-in flows need a local stack.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: isCI ? 'pnpm start' : 'pnpm dev',
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'e2e-placeholder',
    },
  },
});
