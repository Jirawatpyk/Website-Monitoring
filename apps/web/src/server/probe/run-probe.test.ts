// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { HttpCheckResult } from '@dxt/probe';
import { fakeDb, type FakeCall } from '../../../test/fake-db';
import { isDue, runProbe } from './run-probe';

const pass: HttpCheckResult = {
  outcome: 'pass',
  statusCode: 200,
  responseMs: 80,
  ttfbMs: 40,
  error: null,
  bodySample: '',
  finalUrl: 'https://a.example.test/',
  keywordMissing: ['Welcome'],
  keywordForbidden: [],
};
const fail: HttpCheckResult = {
  outcome: 'fail',
  statusCode: 500,
  responseMs: 90,
  ttfbMs: 50,
  error: null,
  bodySample: '',
  finalUrl: 'https://a.example.test/',
  keywordMissing: null,
  keywordForbidden: null,
};

const monitor = (id: string, tier: number, timeout_ms = 10_000) => ({
  id,
  url: `https://${id}.example.test`,
  method: 'GET',
  timeout_ms,
  must_contain: id === 'b' ? ['Welcome'] : [],
  must_not_contain: [],
  sites: { tier, is_active: true },
});

// 10:00:00 UTC — minute 600, due for every tier.
const start = Date.parse('2026-10-06T10:00:00Z');

function setup(monitors: unknown[], results: HttpCheckResult[][]) {
  const fake = fakeDb({ 'monitors.select': { data: monitors } });
  let t = start;
  let round = 0;
  const check = vi.fn(async () => {
    const r = results[round]?.shift() ?? pass;
    return r;
  });
  const sleep = vi.fn(async (ms: number) => {
    t += ms;
    round += 1;
  });
  return { ...fake, check, sleep, clock: () => t };
}

const inserts = (calls: FakeCall[]) =>
  calls
    .filter((c) => c.table === 'check_results' && c.op === 'insert')
    .map((c) => c.values as Record<string, unknown>[]);

describe('isDue (PRD §2 intervals)', () => {
  it.each([
    [1, '2026-10-06T10:01:00Z', true],
    [2, '2026-10-06T10:03:00Z', true],
    [2, '2026-10-06T10:04:00Z', false],
    [3, '2026-10-06T10:05:00Z', true],
    [3, '2026-10-06T10:06:00Z', false],
  ] as const)('Tier %i at %s → %s', (tier, at, due) => {
    expect(isDue(tier, new Date(at))).toBe(due);
  });
});

describe('runProbe', () => {
  it('refuses to record anything outside its Vercel region', async () => {
    const s = setup([monitor('a', 1)], []);
    const result = await runProbe({ db: s.db, location: 'SIN', vercel: { region: 'iad1' }, check: s.check });
    expect(result).toEqual({ ok: false, location: 'SIN', skipped: 'wrong_region', expected: 'sin1' });
    expect(s.check).not.toHaveBeenCalled();
  });

  it('checks due monitors with the secret header and stores attempt 1; no recheck when all pass', async () => {
    const s = setup([monitor('a', 1), monitor('b', 2, 5_000)], [[pass, pass]]);
    const result = await runProbe({
      db: s.db,
      location: 'TYO',
      vercel: { region: 'hnd1' },
      secretHeader: { name: 'X-DxT-Monitor', value: 'v' },
      check: s.check,
      clock: s.clock,
      sleep: s.sleep,
    });
    expect(result).toEqual({
      ok: true,
      location: 'TYO',
      checked: 2,
      failed: 0,
      rechecked: 0,
      recheckFailed: 0,
      blocked: 0,
    });
    expect(s.check).toHaveBeenCalledWith({
      url: 'https://b.example.test',
      method: 'GET',
      timeoutMs: 5_000,
      headers: { 'X-DxT-Monitor': 'v' },
      allowPrivateTargets: false,
      mustContain: ['Welcome'],
      mustNotContain: [],
    });
    expect(inserts(s.calls)).toEqual([
      [
        expect.objectContaining({
          monitor_id: 'a',
          location: 'TYO',
          attempt: 1,
          outcome: 'pass',
          status_code: 200,
          // What the page said beyond pass / fail (D-022).
          final_url: 'https://a.example.test/',
          keyword_missing: ['Welcome'],
          keyword_forbidden: [],
        }),
        expect.objectContaining({ monitor_id: 'b', attempt: 1 }),
      ],
    ]);
    expect(s.sleep).not.toHaveBeenCalled();
    // Every monitor of an active site, key pages included — not only the primary (S04a).
    expect(s.calls.find((c) => c.table === 'monitors')?.filters).toEqual([
      ['eq', 'sites.is_active', true],
      // Switched off or removed monitors are skipped (S05, D-025).
      ['eq', 'enabled', true],
      ['is', 'removed_at', null],
      // HTTP page monitors only: SSL / domain (S13) and browser (S23) are checked their own way.
      ['in', 'type', ['http', 'keyword']],
    ]);
    expect(s.calls.find((c) => c.table === 'probe_locations')).toMatchObject({
      op: 'update',
      filters: [['eq', 'code', 'TYO']],
    });
  });

  it('skips monitors that are not due this minute', async () => {
    const s = setup([monitor('t2', 2)], []);
    const result = await runProbe({
      db: s.db,
      location: 'SIN',
      check: s.check,
      clock: () => start + 60_000,
      sleep: s.sleep,
    });
    expect(result).toMatchObject({ checked: 0 });
    expect(inserts(s.calls)).toEqual([]);
  });

  it('rechecks failures ~30 s later in the same run and stores them as attempt 2', async () => {
    const s = setup([monitor('a', 1), monitor('b', 1)], [[fail, pass], [fail]]);
    const result = await runProbe({
      db: s.db,
      location: 'SIN',
      check: s.check,
      clock: s.clock,
      sleep: s.sleep,
    });
    expect(result).toEqual({
      ok: true,
      location: 'SIN',
      checked: 2,
      failed: 1,
      rechecked: 1,
      recheckFailed: 1,
      blocked: 0,
    });
    expect(s.sleep).toHaveBeenCalledWith(30_000);
    expect(inserts(s.calls)[1]).toEqual([
      expect.objectContaining({ monitor_id: 'a', attempt: 2, outcome: 'fail' }),
    ]);
  });

  it('caps a monitor timeout at 30 s and rechecks 30 s after the run started (PRD §5)', async () => {
    const s = setup([monitor('slow', 1, 60_000)], [[fail], [fail]]);
    await runProbe({ db: s.db, location: 'SIN', check: s.check, clock: s.clock, sleep: s.sleep });
    expect(s.check).toHaveBeenNthCalledWith(1, expect.objectContaining({ timeoutMs: 30_000 }));
    expect(s.sleep).toHaveBeenCalledWith(30_000);
    expect(s.check).toHaveBeenLastCalledWith(expect.objectContaining({ timeoutMs: 30_000 }));
  });

  it('stamps scheduled checks with the run start, so a late start keeps its round', async () => {
    const s = setup([monitor('a', 1)], [[pass]]);
    const clock = vi
      .fn()
      .mockReturnValueOnce(start)
      .mockReturnValue(start + 2_500);
    await runProbe({ db: s.db, location: 'SIN', check: s.check, clock, sleep: s.sleep });
    expect(inserts(s.calls)[0]?.[0]).toMatchObject({ checked_at: new Date(start).toISOString() });
  });

  it('skips the recheck when no time is left', async () => {
    const s = setup([monitor('a', 1)], [[fail]]);
    const clock = vi
      .fn()
      .mockReturnValueOnce(start)
      .mockReturnValue(start + 84_500);
    const result = await runProbe({ db: s.db, location: 'SIN', check: s.check, clock, sleep: s.sleep });
    expect(result).toMatchObject({ failed: 1, rechecked: 0 });
  });

  it('fails loudly when the database refuses a write', async () => {
    const s = fakeDb({
      'monitors.select': { data: [monitor('a', 1)] },
      'check_results.insert': { error: { message: 'no partition' } },
    });
    await expect(
      runProbe({ db: s.db, location: 'SIN', check: async () => pass, clock: () => start }),
    ).rejects.toThrow('check_results: no partition');
    const m = fakeDb({ 'monitors.select': { error: { message: 'down' } } });
    await expect(runProbe({ db: m.db, location: 'SIN' })).rejects.toThrow('monitors: down');
    const h = fakeDb({ 'probe_locations.update': { error: { message: 'x' } } });
    await expect(runProbe({ db: h.db, location: 'SIN' })).rejects.toThrow('heartbeat: x');
  });
});
