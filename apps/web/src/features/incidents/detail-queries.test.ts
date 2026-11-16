// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db', () => ({ serviceDb: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getAccess: vi.fn() }));

const { downTriggerOf, incidentAccept, keyPageRows, locationsOf } = await import('./detail-queries');

const check = (location: string, at: string, over: Record<string, unknown> = {}) => ({
  location,
  outcome: 'fail',
  status_code: null,
  response_ms: null,
  error: 'Timeout',
  checked_at: `2026-09-25T${at}+07:00`,
  ...over,
});

describe('Evidence by location (Incident board)', () => {
  it('first check, recheck and latest per location, in BKK / SIN / TYO order', () => {
    const around = [
      check('SIN', '09:48:12', { status_code: 504, response_ms: 12_400, error: null }),
      check('BKK', '09:48:12'),
      check('SIN', '09:48:41', { status_code: 504, response_ms: 11_900, error: null }),
      check('BKK', '09:48:41'),
    ];
    const latest = [
      check('SIN', '10:07:10', { outcome: 'pass', status_code: 200, response_ms: 412, error: null }),
      check('BKK', '10:07:10', { outcome: 'blocked', error: null }),
    ];
    expect(locationsOf(around, latest, '2026-09-25T09:48:41+07:00', 30_000)).toMatchObject([
      {
        location: 'BKK',
        first: { text: 'Timeout > 30 s', glyph: 'fail' },
        recheck: { text: 'Timeout > 30 s', glyph: 'fail' },
        latest: { text: 'Blocked by bot protection', glyph: 'blocked' },
      },
      {
        location: 'SIN',
        first: { text: 'HTTP 504 · 12.4 s', glyph: 'fail' },
        recheck: { text: 'HTTP 504 · 11.9 s', glyph: 'fail' },
        latest: { text: '200 · 412 ms', glyph: 'pass' },
      },
    ]);
  });

  it('§37.4: the home page latest, the key page first fail and latest per location', () => {
    const pass = (l: string, at: string) =>
      check(l, at, { outcome: 'pass', status_code: 200, response_ms: 900, error: null });
    const notFound = (l: string, at: string) =>
      check(l, at, { status_code: 404, response_ms: 400, error: null });
    const rows = keyPageRows(
      [pass('BKK', '10:06:40'), pass('SIN', '10:06:40')],
      // Around the partial recovery: the key page timed out while the site was down (09:31) — that is the
      // DOWN, not the failure keeping it open; the first fail is from the round the home page came back.
      [check('BKK', '09:31:20'), notFound('BKK', '09:35:20'), notFound('SIN', '09:35:20')],
      [notFound('BKK', '10:06:40'), notFound('SIN', '10:06:40')],
      30_000,
      30_000,
      '2026-09-25T09:35:20+07:00',
    );
    expect(rows).toMatchObject([
      {
        location: 'BKK',
        home: { text: '200 · 900 ms', glyph: 'pass' },
        // A PROBLEM's failure: amber "Fail", never the red hard fail.
        first: { text: 'HTTP 404 · 0.4 s', glyph: 'problem', at: '2026-09-25T09:35:20+07:00' },
        latest: { text: 'HTTP 404 · 0.4 s', glyph: 'problem' },
      },
      { location: 'SIN', home: { glyph: 'pass' }, first: { glyph: 'problem' }, latest: { glyph: 'problem' } },
    ]);
  });

  it('a location with only one check has no separate recheck; none at all is left out', () => {
    const rows = locationsOf([check('TYO', '09:48:41')], [], '2026-09-25T09:48:41+07:00', 10_000);
    expect(rows).toMatchObject([
      { location: 'TYO', first: { text: 'Timeout > 10 s', glyph: 'fail' }, recheck: null, latest: null },
    ]);
  });
});

describe('downTriggerOf (§37 meta line)', () => {
  const ev = (type: string, payload: Record<string, unknown> = {}) => ({ type, payload });
  it.each([
    // INC-0003: a TLS-chain PROBLEM the browser verifier raised to DOWN — the DOWN's cause, not the record's
    [
      'raised by the browser',
      'tls_chain',
      [ev('detected'), ev('escalated_to_down', { verifyJobId: 'j1' })],
      'Browser',
    ],
    ['raised by a hard fail', 'slow', [ev('escalated_to_down', {})], 'Hard fail'],
    ['raised by hand', 'key_page', [ev('escalated_to_down', { manual: true })], 'Manual (hand check)'],
    ['a DOWN from the start', 'hard_fail', [ev('detected')], 'Hard fail'],
  ] as const)('%s', (_, trigger, events, expected) => {
    expect(downTriggerOf(trigger, [...events])).toBe(expected);
  });
});

describe('incidentAccept (S09d, §26.6)', () => {
  const ev = (type: string, at: string, payload: Record<string, unknown> = {}) => ({
    type,
    at: `2026-10-15T${at}+00:00`,
    actor_id: 'u-tao',
    payload,
  });
  const nameOf = () => 'Tao';
  const i = { recovered_at: '2026-10-15T11:32:23+00:00' } as Parameters<typeof incidentAccept>[0];

  it('the latest accept of the current drop, and the fetch that matched it', () => {
    expect(
      incidentAccept(i, [ev('detected', '11:16:01'), ev('baseline_accepted', '11:30:47')], nameOf),
    ).toEqual({
      at: '2026-10-15T11:30:47+00:00',
      by: 'Tao',
      withResolve: false,
      matchedAt: '2026-10-15T11:32:23+00:00',
    });
  });

  it('none once undone, and none carried into a relapse (/verify, 15 Oct)', () => {
    expect(
      incidentAccept(
        i,
        [ev('detected', '11:16:01'), ev('baseline_accepted', '11:30:08'), ev('baseline_undone', '11:30:16')],
        nameOf,
      ),
    ).toBeNull();
    expect(
      incidentAccept(
        i,
        [ev('detected', '11:16:01'), ev('baseline_accepted', '11:30:47'), ev('relapsed', '11:39:00')],
        nameOf,
      ),
    ).toBeNull();
  });
});
