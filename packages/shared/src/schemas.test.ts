import { describe, expect, it } from 'vitest';
import { PROBE_LOCATIONS, TIER_CONFIG, TRIGGERS, TRIGGER_LABELS } from './domain';
import { checkResultSchema, ingestBatchSchema } from './schemas';

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
});
