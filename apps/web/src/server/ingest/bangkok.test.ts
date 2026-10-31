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

  it('stores the keyword result and final URL, and nulls them for an agent that sends none (D-022)', async () => {
    const { db, calls } = fakeDb();
    const base = {
      checkedAt: '2026-10-07T03:00:01Z',
      outcome: 'pass' as const,
      statusCode: 200,
      responseMs: 5_800,
      ttfbMs: 400,
      resolvedIp: null,
      error: null,
      attempt: 1 as const,
    };
    await storeBangkokResults(
      db,
      [
        {
          ...base,
          monitorId: 'm1',
          finalUrl: 'https://a.example.test/',
          keywordMissing: ['Welcome'],
          keywordForbidden: [],
        },
        // An agent not redeployed yet.
        { ...base, monitorId: 'm2' },
      ],
      now,
    );
    expect(calls.find((c) => c.table === 'check_results')?.values).toEqual([
      expect.objectContaining({
        monitor_id: 'm1',
        final_url: 'https://a.example.test/',
        keyword_missing: ['Welcome'],
        keyword_forbidden: [],
      }),
      expect.objectContaining({
        monitor_id: 'm2',
        final_url: null,
        keyword_missing: null,
        keyword_forbidden: null,
      }),
    ]);
  });

  it('stores a blocked check’s WAF signature and the batch’s control check on every row (D-027)', async () => {
    const { db, calls } = fakeDb();
    const base = {
      checkedAt: now.toISOString(),
      responseMs: 120,
      ttfbMs: 60,
      resolvedIp: null,
      error: null,
      attempt: 1 as const,
    };
    await storeBangkokResults(
      db,
      [
        { ...base, monitorId: 'm1', outcome: 'blocked', statusCode: 403, waf: 'akamai' },
        // A WAF value on a non-blocked row never reaches the table (its check constraint refuses it).
        { ...base, monitorId: 'm2', outcome: 'pass', statusCode: 200, waf: 'akamai' },
      ],
      now,
      { ok: false, akamaiOk: false },
    );
    expect(calls.find((c) => c.table === 'check_results')?.values).toEqual([
      expect.objectContaining({ monitor_id: 'm1', waf: 'akamai', control_ok: false, akamai_ok: false }),
      expect.objectContaining({ monitor_id: 'm2', waf: null, control_ok: false }),
    ]);

    const { db: db2, calls: calls2 } = fakeDb();
    // An agent not redeployed sends no control: unknown, stored as null.
    await storeBangkokResults(db2, [{ ...base, monitorId: 'm3', outcome: 'pass', statusCode: 200 }], now);
    expect(calls2.find((c) => c.table === 'check_results')?.values).toEqual([
      expect.objectContaining({ monitor_id: 'm3', waf: null, control_ok: null, akamai_ok: null }),
    ]);

    // D-051: a confirm check comes back flagged; everything else (an old agent too) stays null.
    const { db: db3, calls: calls3 } = fakeDb();
    await storeBangkokResults(
      db3,
      [
        { ...base, monitorId: 'm4', outcome: 'pass', statusCode: 200, confirm: true },
        { ...base, monitorId: 'm5', outcome: 'pass', statusCode: 200 },
      ],
      now,
    );
    expect(calls3.find((c) => c.table === 'check_results')?.values).toEqual([
      expect.objectContaining({ monitor_id: 'm4', confirm: true }),
      expect.objectContaining({ monitor_id: 'm5', confirm: null }),
    ]);
  });

  it('throws when the insert fails, before beating', async () => {
    const { db, calls } = fakeDb({ 'check_results.insert': { error: { message: 'boom' } } });
    await expect(storeBangkokResults(db, [], now)).rejects.toThrow('check_results: boom');
    expect(calls.some((c) => c.table === 'probe_locations')).toBe(false);
  });

  it('beats on asking only in a minute with nothing due (no batch will follow)', async () => {
    const { db, calls } = fakeDb({ 'monitors.select': { data: [] } });
    expect(await dueForBangkok(db, now)).toEqual([]);
    expect(calls.some((c) => c.table === 'probe_locations' && c.op === 'update')).toBe(true);
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
      { id: 'm1', url: 'https://a.example.test', method: 'GET', timeoutMs: 30_000, headers: [] },
    ]);
    expect(calls.some((c) => c.table === 'probe_locations')).toBe(false);
  });
});
