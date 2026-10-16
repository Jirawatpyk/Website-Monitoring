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
    await expect(pingHealthcheck(ping, 'ok', fetchImpl, 0)).resolves.toBeUndefined();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('hc-ping');
  });

  it('tries once more before giving up (16 Oct: a short blip from sin1 paged "engine is DOWN")', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }))
      .mockResolvedValueOnce(new Response('OK'));
    await pingHealthcheck(ping, 'ok', fetchImpl, 0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('an error status counts as a failed ping and is retried', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('OK'));
    await pingHealthcheck(ping, 'ok', fetchImpl, 0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('after the second failure logs once, with why — never the URL', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError(`fetch failed ${ping}`, { cause: { code: 'ENOTFOUND' } });
    });
    await pingHealthcheck(ping, 'fail', fetchImpl, 0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(vi.mocked(console.warn).mock.calls).toEqual([
      [
        JSON.stringify({
          event: 'healthcheck_ping_failed',
          result: 'fail',
          attempts: 2,
          reason: 'ENOTFOUND',
        }),
      ],
    ]);
  });

  it('names a timeout and an error status', async () => {
    const timeout = vi.fn<typeof fetch>(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    await pingHealthcheck(ping, 'ok', timeout, 0);
    const status = vi.fn<typeof fetch>(async () => new Response('', { status: 429 }));
    await pingHealthcheck(ping, 'ok', status, 0);
    expect(vi.mocked(console.warn).mock.calls.map((c) => JSON.parse(String(c[0])).reason)).toEqual([
      'timeout',
      'http_429',
    ]);
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
