import { describe, expect, it } from 'vitest';
import {
  chainStreakStart,
  lastRoundP50,
  probeHealth,
  SERIES_POINTS,
  seriesOf,
  viewerKindOf,
} from './assemble';

const NOW = new Date('2026-09-25T03:07:12Z'); // Fri 10:07 (UTC+7); the open bucket starts 03:00Z
const iso = (ms: number) => new Date(ms).toISOString();
const OPEN = Date.parse('2026-09-25T03:00:00Z');
const Q = 15 * 60_000;

describe('seriesOf (§21.5)', () => {
  it('places buckets into 96 closed slots, oldest first; the open bucket and older ones are left out', () => {
    const { series, failed } = seriesOf(
      {
        bucket_starts: [iso(OPEN - 96 * Q), iso(OPEN - 2 * Q), iso(OPEN - Q), iso(OPEN), iso(OPEN - 97 * Q)],
        p50_ms: [300, null, 420, 999, 111],
        hard_fails: [0, 3, 0, 0, 0],
      },
      NOW,
    );
    expect(series).toHaveLength(SERIES_POINTS);
    expect(series[0]).toBe(300);
    expect(series[94]).toBeNull(); // every check failed → the line breaks
    expect(failed[94]).toBe(true);
    expect(series[95]).toBe(420); // the last closed bucket
    expect(series.filter((v) => v !== null)).toEqual([300, 420]); // the open bucket waits until it closes
  });

  it('no row → all gaps', () => {
    expect(seriesOf(undefined, NOW).series.every((v) => v === null)).toBe(true);
  });
});

describe('lastRoundP50', () => {
  it.each<[(number | null)[], number | null]>([
    [[412, 380, 450], 412],
    [[400, null, 500], 450],
    [[null, null], null],
    [[], null],
  ])('%o → %s', (ms, expected) => {
    expect(lastRoundP50(ms)).toBe(expected);
  });
});

describe('chainStreakStart', () => {
  const chain = (at: string) => ({
    checked_at: at,
    outcome: 'fail',
    error: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  });
  it('walks back while the checks are chain errors', () => {
    expect(
      chainStreakStart([
        chain('09:40'),
        chain('09:35'),
        chain('09:31'),
        { checked_at: '09:30', outcome: 'pass', error: null },
      ]),
    ).toBe('09:31');
    expect(
      chainStreakStart([{ checked_at: '09:40', outcome: 'pass', error: null }, chain('09:35')]),
    ).toBeNull();
    expect(chainStreakStart([{ checked_at: '09:40', outcome: 'fail', error: null }])).toBeNull();
    expect(chainStreakStart([])).toBeNull();
  });
});

describe('probeHealth (D-032)', () => {
  const recent = iso(NOW.getTime() - 30_000);
  const stale = iso(NOW.getTime() - 4 * 60_000);
  const locs = [
    { code: 'TYO', is_active: true, last_heartbeat_at: recent },
    { code: 'BKK', is_active: true, last_heartbeat_at: recent },
    { code: 'SIN', is_active: true, last_heartbeat_at: stale },
  ];
  it.each<[string | null, number, 'idle' | 'busy' | 'offline']>([
    [recent, 0, 'idle'],
    [recent, 2, 'busy'],
    [stale, 0, 'offline'],
    [null, 0, 'offline'],
  ])('verifier seen %s, %i open jobs → %s', (seen, jobs, verifier) => {
    expect(probeHealth(locs, seen, jobs, NOW)).toEqual({ beating: ['BKK', 'TYO'], total: 3, verifier });
  });
  it('an inactive location is not counted', () => {
    expect(
      probeHealth([{ code: 'BKK', is_active: false, last_heartbeat_at: recent }], recent, 0, NOW).total,
    ).toBe(0);
  });
});

describe('viewerKindOf (D-032)', () => {
  it.each([
    ['admin', false, 'admin'],
    ['responder', false, 'responder'],
    ['viewer', false, 'viewer'],
    ['stakeholder', true, 'am'],
    ['stakeholder', false, 'ceo'],
    ['client', false, 'viewer'],
  ] as const)('%s (manages clients: %s) → %s', (role, manages, kind) => {
    expect(viewerKindOf(role, manages)).toBe(kind);
  });
});
