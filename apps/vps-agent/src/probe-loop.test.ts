import { describe, expect, it, vi } from 'vitest';
import type { HttpCheckResult } from '@dxt/probe';
import type { Api } from './api';
import { runProbeRound, untilNextTick } from './probe-loop';

const result = (outcome: HttpCheckResult['outcome'], statusCode: number | null = 200): HttpCheckResult => ({
  outcome,
  statusCode,
  responseMs: 120,
  ttfbMs: 80,
  error: outcome === 'fail' && statusCode === null ? 'Timeout' : null,
  bodySample: '',
});
const monitors = [
  { id: 'm-ok', url: 'https://ok.example.test', method: 'GET' as const, timeoutMs: 10_000 },
  { id: 'm-down', url: 'https://down.example.test', method: 'HEAD' as const, timeoutMs: 30_000 },
];
const fakeApi = (due = monitors) => {
  const posted: unknown[][] = [];
  const api: Api = {
    dueMonitors: vi.fn(async () => due),
    postResults: vi.fn(async (r) => void posted.push(r)),
    leaseJobs: vi.fn(),
    completeJob: vi.fn(),
  };
  return { api, posted };
};

// Round starts at 03:01:01 (a second after the minute), like the systemd loop.
const START = Date.parse('2026-10-07T03:01:01Z');

describe('runProbeRound (Bangkok)', () => {
  it('checks every due monitor with the WAF header, posts attempt 1 at the round start, rechecks failures ~30 s later', async () => {
    let now = START;
    const { api, posted } = fakeApi();
    const check = vi.fn(async ({ url }: { url: string }) =>
      url.includes('down') ? result('fail', 503) : result('pass'),
    );
    const sleep = vi.fn(async (ms: number) => void (now += ms));
    const summary = await runProbeRound({
      api,
      secretHeader: { name: 'X-DxT-Monitor', value: 's3cret' },
      check,
      clock: () => now,
      sleep,
    });

    expect(summary).toEqual({ checked: 2, failed: 1, rechecked: 1 });
    expect(check).toHaveBeenCalledWith({
      url: 'https://ok.example.test',
      method: 'GET',
      timeoutMs: 10_000,
      headers: { 'X-DxT-Monitor': 's3cret' },
    });
    expect(sleep).toHaveBeenCalledWith(30_000);
    expect(posted[0]).toEqual([
      expect.objectContaining({
        monitorId: 'm-ok',
        outcome: 'pass',
        attempt: 1,
        checkedAt: '2026-10-07T03:01:01.000Z',
      }),
      expect.objectContaining({ monitorId: 'm-down', outcome: 'fail', statusCode: 503, attempt: 1 }),
    ]);
    expect(posted[1]).toEqual([
      expect.objectContaining({ monitorId: 'm-down', attempt: 2, checkedAt: '2026-10-07T03:01:31.000Z' }),
    ]);
    // The recheck's timeout fits what's left of the round (48 s budget).
    expect(check).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: 'https://down.example.test', timeoutMs: 18_000 }),
    );
  });

  it('posts nothing when nothing is due', async () => {
    const { api } = fakeApi([]);
    expect(await runProbeRound({ api, check: vi.fn() })).toEqual({ checked: 0, failed: 0, rechecked: 0 });
    expect(api.postResults).not.toHaveBeenCalled();
  });

  it('skips the recheck when the round has no time left', async () => {
    let now = START;
    const { api, posted } = fakeApi([monitors[1]!]);
    const summary = await runProbeRound({
      api,
      check: vi.fn(async () => {
        now += 56_000; // a check that took the whole round
        return result('fail', null);
      }),
      clock: () => now,
      sleep: vi.fn(async () => undefined),
    });
    expect(summary).toEqual({ checked: 1, failed: 1, rechecked: 0 });
    expect(posted).toHaveLength(1);
  });

  it('sends no secret header when none is configured', async () => {
    const { api } = fakeApi([monitors[0]!]);
    const check = vi.fn(async () => result('pass'));
    await runProbeRound({ api, check });
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ headers: undefined }));
  });

  it('a failed post fails the round (the loop pings /fail)', async () => {
    const { api } = fakeApi([monitors[0]!]);
    vi.mocked(api.postResults).mockRejectedValue(new Error('422'));
    await expect(runProbeRound({ api, check: vi.fn(async () => result('pass')) })).rejects.toThrow('422');
  });
});

describe('untilNextTick', () => {
  it('waits for the next UTC minute plus a second', () => {
    expect(untilNextTick(Date.parse('2026-10-07T03:00:59.500Z'), 60_000)).toBe(1_500);
    expect(untilNextTick(Date.parse('2026-10-07T03:01:00.000Z'), 60_000)).toBe(61_000);
  });
});
