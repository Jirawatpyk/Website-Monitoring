// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fake-db';
import { dueForBangkok, storeBangkokResults } from './bangkok';

const now = new Date('2026-10-07T03:00:30Z');

describe('Bangkok through the Ingest API', () => {
  it('stores results as BKK with their attempt, then beats', async () => {
    const { db, calls } = fakeDb();
    const stored = await storeBangkokResults(
      db,
      [
        {
          monitorId: 'm1',
          checkedAt: '2026-10-07T03:00:31Z',
          outcome: 'fail',
          statusCode: 500,
          responseMs: 90,
          ttfbMs: 40,
          resolvedIp: null,
          error: null,
          attempt: 2,
        },
      ],
      now,
    );
    expect(stored).toBe(1);
    expect(calls.find((c) => c.table === 'check_results')?.values).toEqual([
      expect.objectContaining({
        monitor_id: 'm1',
        location: 'BKK',
        attempt: 2,
        outcome: 'fail',
        status_code: 500,
      }),
    ]);
    expect(calls.find((c) => c.table === 'probe_locations')).toMatchObject({
      op: 'update',
      values: { last_heartbeat_at: now.toISOString() },
      filters: [['eq', 'code', 'BKK']],
    });
  });

  it('throws when the insert fails, before beating', async () => {
    const { db, calls } = fakeDb({ 'check_results.insert': { error: { message: 'boom' } } });
    await expect(storeBangkokResults(db, [], now)).rejects.toThrow('check_results: boom');
    expect(calls.some((c) => c.table === 'probe_locations')).toBe(false);
  });

  it('throws when the heartbeat fails', async () => {
    const { db } = fakeDb({ 'probe_locations.update': { error: { message: 'boom' } } });
    await expect(storeBangkokResults(db, [], now)).rejects.toThrow('heartbeat: boom');
  });

  it('lists the monitors due this minute, with timeouts capped at 30 s — asking is not a heartbeat', async () => {
    const { db, calls } = fakeDb({
      'monitors.select': {
        data: [
          {
            id: 'm1',
            url: 'https://a.example.test',
            method: 'GET',
            timeout_ms: 45_000,
            sites: { tier: 1, is_active: true },
          },
          {
            id: 'm2',
            url: 'https://b.example.test',
            method: 'HEAD',
            timeout_ms: 5_000,
            sites: { tier: 3, is_active: true },
          },
        ],
      },
    });
    // 03:01 UTC: Tier 1 is due every minute, Tier 3 only on minutes divisible by 5.
    expect(await dueForBangkok(db, new Date('2026-10-07T03:01:30Z'))).toEqual([
      { id: 'm1', url: 'https://a.example.test', method: 'GET', timeoutMs: 30_000 },
    ]);
    expect(calls.some((c) => c.table === 'probe_locations')).toBe(false);
  });
});
