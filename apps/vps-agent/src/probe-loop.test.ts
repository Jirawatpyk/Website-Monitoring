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
  finalUrl: statusCode === null ? null : 'https://ok.example.test/',
  keywordMissing: outcome === 'pass' ? ['Welcome'] : null,
  keywordForbidden: outcome === 'pass' ? [] : null,
  waf: null,
});
const monitors = [
  {
    id: 'm-ok',
    url: 'https://ok.example.test',
    method: 'GET' as const,
    timeoutMs: 10_000,
    mustContain: ['Welcome'],
    mustNotContain: ['Index of /'],
    headers: [] as { name: string; value: string }[],
  },
  {
    id: 'm-down',
    url: 'https://down.example.test',
    method: 'HEAD' as const,
    timeoutMs: 30_000,
    mustContain: [] as string[],
    mustNotContain: [] as string[],
    headers: [{ name: 'Accept-Language', value: 'th' }],
  },
];
const fakeApi = (due = monitors) => {
  const posted: unknown[][] = [];
  const controls: unknown[] = [];
  const api: Api = {
    dueMonitors: vi.fn(async () => due),
    postResults: vi.fn(async (r, control) => {
      posted.push(r);
      controls.push(control);
    }),
    leaseJobs: vi.fn(),
    completeJob: vi.fn(),
  };
  return { api, posted, controls };
};

// Round starts at 03:01:01 (a second after the minute), like the systemd loop.
const START = Date.parse('2026-10-07T03:01:01Z');

describe('runProbeRound — control check (D-027)', () => {
  const CONTROLS = ['https://www.gstatic.com/generate_204', 'https://www.cloudflare.com/cdn-cgi/trace'];
  const roundWith = async (controlDown: (url: string, call: number) => boolean) => {
    let now = START;
    let call = 0;
    const { api, controls } = fakeApi();
    const check = vi.fn(async ({ url }: { url: string }) => {
      if (CONTROLS.includes(url))
        return controlDown(url, call++) ? result('fail', null) : result('pass', 204);
      return url.includes('down') ? result('fail', 503) : result('pass');
    });
    const summary = await runProbeRound({
      api,
      controlUrls: CONTROLS,
      check,
      clock: () => now,
      sleep: async (ms) => void (now += ms),
    });
    return { summary, controls, check };
  };

  it('both control URLs down → ok: false, on both posts (scheduled and recheck)', async () => {
    const { summary, controls } = await roundWith(() => true);
    expect(summary.controlOk).toBe(false);
    expect(controls).toEqual([{ ok: false }, { ok: false }]);
  });

  it('the recheck gets its own control check: a network blip at the round start doesn’t follow it', async () => {
    // Calls 0 and 1 are the round start's two control URLs; the recheck's come after.
    const { controls } = await roundWith((_url, call) => call < 2);
    expect(controls).toEqual([{ ok: false }, { ok: true }]);
  });

  it('reports the Akamai control beside the two controls (D-027 rule 2b)', async () => {
    const AKAMAI = 'https://www.ibm.com/robots.txt';
    for (const akamaiDown of [true, false]) {
      const { api, controls } = fakeApi();
      const check = vi.fn(async ({ url }: { url: string }) =>
        url === AKAMAI && akamaiDown
          ? result('fail', null)
          : url.includes('down')
            ? result('fail', 503)
            : result('pass'),
      );
      let now = START;
      await runProbeRound({
        api,
        controlUrls: CONTROLS,
        akamaiControlUrl: AKAMAI,
        check,
        clock: () => now,
        sleep: async (ms) => void (now += ms),
      });
      expect(controls[0]).toEqual({ ok: true, akamaiOk: !akamaiDown });
      expect(controls[1]).toEqual({ ok: true, akamaiOk: !akamaiDown });
    }
  });

  it('no monitors due → no control check either', async () => {
    const { api } = fakeApi([]);
    const check = vi.fn(async () => result('pass'));
    const summary = await runProbeRound({ api, controlUrls: CONTROLS, check, clock: () => START });
    expect(check).not.toHaveBeenCalled();
    expect(summary.controlOk).toBeUndefined();
  });

  it('one control URL down is not a control failure', async () => {
    const { summary, controls } = await roundWith((url) => url.includes('gstatic'));
    expect(summary.controlOk).toBe(true);
    expect(controls[0]).toMatchObject({ ok: true });
  });

  it('checks each control URL once per batch (scheduled + recheck) with a short GET, never with the WAF header', async () => {
    const { check } = await roundWith(() => false);
    const calls = check.mock.calls.map(([req]) => req).filter((r) => CONTROLS.includes(r.url));
    expect(calls).toHaveLength(4);
    for (const c of calls) expect(c).toEqual({ url: c.url, method: 'GET', timeoutMs: 10_000 });
  });

  it('no control URLs → no control sent', async () => {
    const { api, controls } = fakeApi();
    const summary = await runProbeRound({
      api,
      check: vi.fn(async () => result('pass')),
      clock: () => START,
    });
    expect(summary.controlOk).toBeUndefined();
    expect(controls).toEqual([undefined]);
  });
});

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
      // The page's keywords (D-022): the result says which are missing, the server judges.
      mustContain: ['Welcome'],
      mustNotContain: ['Index of /'],
    });
    expect(sleep).toHaveBeenCalledWith(30_000);
    expect(posted[0]).toEqual([
      expect.objectContaining({
        monitorId: 'm-ok',
        outcome: 'pass',
        attempt: 1,
        finalUrl: 'https://ok.example.test/',
        keywordMissing: ['Welcome'],
        keywordForbidden: [],
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

  it('sends a monitor’s custom headers with the secret header last (S05)', async () => {
    const { api } = fakeApi([monitors[1]!]);
    const check = vi.fn(async () => result('pass'));
    await runProbeRound({ api, check, secretHeader: { name: 'X-DxT-Monitor', value: 's3cret' } });
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'Accept-Language': 'th', 'X-DxT-Monitor': 's3cret' } }),
    );
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
