import { vi } from 'vitest';

/** A complete, valid server environment for tests. Values are fakes. */
export const TEST_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  CRON_SECRET: 'c'.repeat(32),
  INGEST_TOKEN: 'i'.repeat(32),
  ALLOWED_EMAIL_DOMAIN: 'dxt.example',
  NEXT_PUBLIC_APP_URL: 'https://monitor.dxt.example',
} as const;

export function stubServerEnv(overrides: Partial<Record<keyof typeof TEST_ENV, string>> = {}) {
  for (const [key, value] of Object.entries({ ...TEST_ENV, ...overrides })) vi.stubEnv(key, value);
}
