import { describe, expect, it, vi } from 'vitest';
import { readEdgeConfigItem } from './edge-config';
import { handle, parseMode, SLOW_HOLD_MS, TIMEOUT_HOLD_MS } from './handler';

describe('handle', () => {
  it.each([
    ['ok', 200],
    ['error', 500],
    [undefined, 200],
    ['something else', 200],
  ])('mode %s → %i, never cached', async (mode, status) => {
    const res = await handle({ readMode: async () => mode });
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-target-mode')).toBe(parseMode(mode));
  });

  it.each([
    ['waf-partial', 'SG', 403, true],
    ['waf-partial', 'JP', 403, true],
    ['waf-partial', null, 403, true],
    ['waf-partial', 'TH', 200, false],
    ['waf-partial-down', 'SG', 403, true],
    ['waf-partial-down', 'TH', 503, false],
    ['waf-partial-slow', 'SG', 403, true],
    ['waf-partial-slow', 'TH', 200, false],
  ])('%s from %s → %i (S05b, D-027)', async (mode, country, status, challenged) => {
    const res = await handle({ readMode: async () => mode, userAgent: 'DxT-Monitor/1.0', country });
    expect(res.status).toBe(status);
    expect(res.headers.get('cf-mitigated')).toBe(challenged ? 'challenge' : null);
  });

  it('holds the request past any monitor timeout in timeout mode', async () => {
    const sleep = vi.fn(async () => {});
    const res = await handle({ readMode: async () => 'timeout', userAgent: 'DxT-Monitor/1.0', sleep });
    expect(sleep).toHaveBeenCalledWith(TIMEOUT_HOLD_MS);
    expect(TIMEOUT_HOLD_MS).toBeGreaterThan(30_000);
    expect(res.status).toBe(200);
  });

  it('waf-partial-slow holds a probe in Thailand past the slow limit (D-039)', async () => {
    const sleep = vi.fn(async () => {});
    const res = await handle({
      readMode: async () => 'waf-partial-slow',
      userAgent: 'DxT-Monitor/1.0',
      country: 'TH',
      sleep,
    });
    expect(sleep).toHaveBeenCalledWith(SLOW_HOLD_MS);
    expect(res.status).toBe(200);
  });

  it('answers anyone but a probe at once in timeout mode', async () => {
    const sleep = vi.fn(async () => {});
    const res = await handle({ readMode: async () => 'timeout', userAgent: 'curl/8', sleep });
    expect(sleep).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  const PROBE = 'DxT-Monitor/1.0';
  const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/140.0 Safari/537.36';
  it.each([
    ['challenge', PROBE, 403, true],
    ['challenge', BROWSER, 200, false],
    ['challenge-down', PROBE, 403, true],
    ['challenge-down', BROWSER, 503, false],
    ['challenge-all', PROBE, 403, true],
    ['challenge-all', BROWSER, 403, true],
  ])('%s: %s gets %i (S03, D-020)', async (mode, userAgent, status, challenged) => {
    const res = await handle({ readMode: async () => mode, userAgent });
    expect(res.status).toBe(status);
    expect(res.headers.get('cf-mitigated')).toBe(challenged ? 'challenge' : null);
    if (challenged) expect(await res.text()).toContain('Just a moment...');
  });

  it('the challenge mode page has the title a monitor keyword can look for', async () => {
    const res = await handle({ readMode: async () => 'challenge', userAgent: BROWSER });
    expect(await res.text()).toContain('<h1>Test target</h1>');
  });

  it('keyword-missing: 200, but no "Test target" anywhere on the page (PROBLEM · Keyword, S04a)', async () => {
    for (const userAgent of [PROBE, BROWSER]) {
      const res = await handle({ readMode: async () => 'keyword-missing', userAgent });
      expect(res.status).toBe(200);
      expect(await res.text()).not.toContain('Test target');
    }
  });

  it('slow: a probe waits over both tier limits and under the monitor timeout; a browser doesn’t', async () => {
    const sleep = vi.fn(async () => {});
    const res = await handle({ readMode: async () => 'slow', userAgent: PROBE, sleep });
    expect(sleep).toHaveBeenCalledWith(SLOW_HOLD_MS);
    expect(SLOW_HOLD_MS).toBeGreaterThan(5_000);
    expect(SLOW_HOLD_MS).toBeLessThan(10_000);
    expect(await res.text()).toContain('<h1>Test target</h1>');
    const quick = vi.fn(async () => {});
    await handle({ readMode: async () => 'slow', userAgent: BROWSER, sleep: quick });
    expect(quick).not.toHaveBeenCalled();
  });

  it('really waits with the default sleep', async () => {
    vi.useFakeTimers();
    const pending = handle({ readMode: async () => 'timeout', userAgent: 'DxT-Monitor/1.0' });
    await vi.advanceTimersByTimeAsync(TIMEOUT_HOLD_MS);
    expect((await pending).status).toBe(200);
    vi.useRealTimers();
  });
});

describe('readEdgeConfigItem', () => {
  const connection = 'https://edge-config.vercel.com/ecfg_abc?token=t0k';

  it('reads the item from the store URL with its token', async () => {
    const fetchImpl = vi.fn(async () => Response.json('error'));
    expect(await readEdgeConfigItem(connection, 'mode', fetchImpl)).toBe('error');
    const url = (fetchImpl.mock.calls[0] as unknown as [URL])[0];
    expect(url.toString()).toBe('https://edge-config.vercel.com/ecfg_abc/item/mode?token=t0k');
  });

  it('returns undefined when the store is missing, the item is absent or the call fails', async () => {
    expect(await readEdgeConfigItem(undefined, 'mode')).toBeUndefined();
    expect(
      await readEdgeConfigItem(connection, 'mode', async () => new Response('', { status: 404 })),
    ).toBeUndefined();
    expect(
      await readEdgeConfigItem(connection, 'mode', async () => {
        throw new Error('offline');
      }),
    ).toBeUndefined();
  });
});
