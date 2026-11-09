import { describe, expect, it } from 'vitest';
import { allowedDownMinutes, PROBE_LOCATIONS, TIER_CONFIG, TRIGGERS, TRIGGER_LABELS } from './domain';
import { checkResultSchema, dueMonitorsResponseSchema, ingestBatchSchema } from './schemas';

describe('dueMonitorsResponseSchema (S12a watchdog facts)', () => {
  it('reads the sweep and the on-call person, and an older server that sends neither', () => {
    const r = dueMonitorsResponseSchema.parse({
      monitors: [],
      engineSweepAt: '2026-11-03T15:32:00.123+00:00',
      onCall: { name: 'Ploy', chatUserId: '1234' },
    });
    expect(r.onCall?.chatUserId).toBe('1234');
    expect(dueMonitorsResponseSchema.parse({ monitors: [] }).engineSweepAt).toBeUndefined();
    expect(
      dueMonitorsResponseSchema.parse({ monitors: [], engineSweepAt: null, onCall: null }).onCall,
    ).toBeNull();
  });

  it('refuses a Chat id that isn’t digits (it goes into a <users/…> mention)', () => {
    const bad = { monitors: [], onCall: { name: 'x', chatUserId: '1>' } };
    expect(dueMonitorsResponseSchema.safeParse(bad).success).toBe(false);
  });
});

const result = {
  monitorId: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
  location: 'SIN',
  checkedAt: '2026-09-25T02:48:12Z',
  outcome: 'fail',
  statusCode: 504,
  responseMs: 30_000,
  ttfbMs: null,
  resolvedIp: '203.0.113.10',
  error: null,
};

describe('checkResultSchema', () => {
  it('accepts a probe result, a scheduled check unless it says it is the recheck', () => {
    expect(checkResultSchema.parse(result)).toEqual({ ...result, attempt: 1 });
    expect(checkResultSchema.parse({ ...result, attempt: 2 }).attempt).toBe(2);
  });

  it.each([
    ['an unknown location', { location: 'HKG' }],
    ['an unknown outcome', { outcome: 'down' }],
    ['a status code out of range', { statusCode: 700 }],
    ['a monitor id that is not a uuid', { monitorId: 'monitor-1' }],
    ['a local time without zone', { checkedAt: '2026-09-25 09:48:12' }],
    ['a third attempt', { attempt: 3 }],
  ])('rejects %s', (_name, change) => {
    expect(checkResultSchema.safeParse({ ...result, ...change }).success).toBe(false);
  });
});

describe('ingestBatchSchema — Bangkok VPS batches', () => {
  const { location: _drop, ...bkk } = result;

  it('drops any location the sender claims (the server sets BKK)', () => {
    const parsed = ingestBatchSchema.parse({ results: [{ ...bkk, location: 'SIN' }] });
    expect(parsed.results[0]).not.toHaveProperty('location');
  });

  it('refuses empty and oversized batches', () => {
    expect(ingestBatchSchema.safeParse({ results: [] }).success).toBe(false);
    expect(ingestBatchSchema.safeParse({ results: Array.from({ length: 501 }, () => bkk) }).success).toBe(
      false,
    );
  });
});

describe('domain constants', () => {
  it('has a label for every trigger', () => {
    expect(Object.keys(TRIGGER_LABELS).sort()).toEqual([...TRIGGERS].sort());
  });

  it('matches the PRD round windows and probe locations', () => {
    expect(TIER_CONFIG[1].roundWindowSec).toBe(90);
    expect(TIER_CONFIG[2].roundWindowSec).toBe(TIER_CONFIG[2].intervalSec + 30);
    expect(PROBE_LOCATIONS).toEqual(['BKK', 'SIN', 'TYO']);
  });

  // D-059: the CEO's standard table — 99.9% is ~43 min down a month.
  it.each([
    [1, 0.9995, 21.6],
    [2, 0.999, 43.2],
    [3, 0.995, 216],
  ] as const)('Tier %i targets %d uptime: %d min allowed in 30 days', (tier, target, minutes) => {
    expect(TIER_CONFIG[tier].uptimeTarget).toBe(target);
    expect(allowedDownMinutes(target, 30 * 1440)).toBeCloseTo(minutes, 6);
  });

  it('allows nothing on an empty window', () => {
    expect(allowedDownMinutes(0.999, 0)).toBe(0);
  });
});
