// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appBaseUrl } from './app-url';
import { runCronJob } from './cron-job';
import { pingHealthcheck } from './healthchecks';

const ping = 'https://hc-ping.com/uuid';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('pingHealthcheck (PRD §9)', () => {
  it('pings the check, or its /fail endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response('OK'));
    await pingHealthcheck(ping, 'ok', fetchImpl);
    await pingHealthcheck(`${ping}/`, 'fail', fetchImpl);
    expect(fetchImpl.mock.calls.map((c) => (c as unknown[])[0])).toEqual([ping, `${ping}/fail`]);
  });

  it('skips without a URL and never throws or logs the URL', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    await pingHealthcheck(undefined, 'ok', fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(pingHealthcheck(ping, 'ok', fetchImpl)).resolves.toBeUndefined();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('hc-ping');
  });
});

describe('runCronJob', () => {
  it('logs the region, pings ok and returns the summary', async () => {
    vi.stubEnv('VERCEL_REGION', 'sin1');
    const fetchMock = vi.fn(async () => new Response('OK'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await runCronJob('probe-sin', ping, async () => ({ ok: true, checked: 1 }));
    expect(await res.json()).toEqual({ job: 'probe-sin', region: 'sin1', ok: true, checked: 1 });
    expect(console.info).toHaveBeenCalledWith(
      JSON.stringify({ job: 'probe-sin', region: 'sin1', ok: true, checked: 1 }),
    );
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(ping);
  });

  it('pings /fail when the job reports it couldn’t work', async () => {
    const fetchMock = vi.fn(async () => new Response('OK'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await runCronJob('probe-sin', ping, async () => ({ ok: false, skipped: 'wrong_region' }));
    expect(res.status).toBe(200);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(`${ping}/fail`);
  });

  it('turns an exception into a 500 without leaking its message', async () => {
    const fetchMock = vi.fn(async () => new Response('OK'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await runCronJob('engine', ping, async () => {
      throw new Error('relation does not exist');
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ job: 'engine', region: 'local', ok: false });
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(`${ping}/fail`);
  });
});

describe('appBaseUrl', () => {
  it('prefers the configured URL, then the Vercel production domain, then local', () => {
    expect(appBaseUrl('https://monitor.dxt.example', 'x.vercel.app')).toBe('https://monitor.dxt.example');
    expect(appBaseUrl(undefined, 'monitor-staging.dxt.example')).toBe('https://monitor-staging.dxt.example');
    expect(appBaseUrl(undefined, undefined)).toBe('http://localhost:3500');
  });
});
