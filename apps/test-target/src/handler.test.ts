import { describe, expect, it, vi } from 'vitest';
import { readEdgeConfigItem } from './edge-config';
import { handle, parseMode, TIMEOUT_HOLD_MS } from './handler';

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

  it('holds the request past any monitor timeout in timeout mode', async () => {
    const sleep = vi.fn(async () => {});
    const res = await handle({ readMode: async () => 'timeout', userAgent: 'DxT-Monitor/1.0', sleep });
    expect(sleep).toHaveBeenCalledWith(TIMEOUT_HOLD_MS);
    expect(TIMEOUT_HOLD_MS).toBeGreaterThan(30_000);
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
