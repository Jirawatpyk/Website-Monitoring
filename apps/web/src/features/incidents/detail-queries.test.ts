// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db', () => ({ serviceDb: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getAccess: vi.fn() }));

const { locationsOf } = await import('./detail-queries');

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
    expect(locationsOf(around, latest, '2026-09-25T09:48:41+07:00', 30_000)).toEqual([
      {
        location: 'BKK',
        first: { text: 'Timeout > 30 s', pass: false },
        recheck: { text: 'Timeout > 30 s', pass: false },
        latest: { text: 'Blocked by bot protection', pass: false },
      },
      {
        location: 'SIN',
        first: { text: 'HTTP 504 · 12.4 s', pass: false },
        recheck: { text: 'HTTP 504 · 11.9 s', pass: false },
        latest: { text: '200 · 412 ms', pass: true },
      },
    ]);
  });

  it('a location with only one check has no separate recheck; none at all is left out', () => {
    const rows = locationsOf([check('TYO', '09:48:41')], [], '2026-09-25T09:48:41+07:00', 10_000);
    expect(rows).toEqual([
      { location: 'TYO', first: { text: 'Timeout > 10 s', pass: false }, recheck: null, latest: null },
    ]);
  });
});
