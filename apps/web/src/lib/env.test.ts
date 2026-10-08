import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnv, TEST_ENV } from '../../test/env';

// serverEnv() caches its first result, so each case loads a fresh module.
async function loadServerEnv() {
  vi.resetModules();
  return (await import('./env')).serverEnv;
}

afterEach(() => vi.unstubAllEnvs());

describe('serverEnv', () => {
  it('parses a complete environment and applies defaults', async () => {
    stubServerEnv();
    const env = (await loadServerEnv())();
    expect(env.CRON_SECRET).toBe(TEST_ENV.CRON_SECRET);
    expect(env.PROBE_SECRET_HEADER_NAME).toBe('X-DxT-Monitor');
  });

  it('names missing or invalid variables without echoing any value', async () => {
    stubServerEnv({ CRON_SECRET: 'too-short', NEXT_PUBLIC_SUPABASE_URL: 'not a url' });
    const serverEnv = await loadServerEnv();
    expect(() => serverEnv()).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL, CRON_SECRET|CRON_SECRET, NEXT_PUBLIC_SUPABASE_URL/,
    );
    expect(() => serverEnv()).not.toThrow(/too-short/);
  });

  it('returns the cached value on later calls', async () => {
    stubServerEnv();
    const serverEnv = await loadServerEnv();
    expect(serverEnv()).toBe(serverEnv());
  });
});

describe('probeAllowlistInfo', () => {
  it('reads only the VPS IP and the secret header name, without the other secrets (S05 CI)', async () => {
    vi.resetModules();
    const { probeAllowlistInfo } = await import('./env');
    vi.stubEnv('BKK_PROBE_IP', ' 203.0.113.7 ');
    vi.stubEnv('PROBE_SECRET_HEADER_NAME', '');
    expect(probeAllowlistInfo()).toEqual({ bkkIp: '203.0.113.7', secretHeaderName: 'X-DxT-Monitor' });
    vi.stubEnv('BKK_PROBE_IP', '');
    vi.stubEnv('PROBE_SECRET_HEADER_NAME', 'X-Probe');
    expect(probeAllowlistInfo()).toEqual({ bkkIp: null, secretHeaderName: 'X-Probe' });
  });
});
