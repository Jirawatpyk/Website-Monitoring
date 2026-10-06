// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb as baseFakeDb } from '../../../test/fake-db';

// Both Vercel locations are active, as on staging.
const fakeDb = (results: Parameters<typeof baseFakeDb>[0] = {}) =>
  baseFakeDb({ 'probe_locations.select': { data: [{ code: 'SIN' }, { code: 'TYO' }] }, ...results });
import { runEngine } from './run-engine';

const now = new Date('2026-10-06T10:01:05Z');
const at = (sec: number) => new Date(Date.parse('2026-10-06T10:00:00Z') + sec * 1000).toISOString();

const monitor = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  timeout_ms: 10_000,
  site_id: 's1',
  sites: { tier: 1, is_active: true, muted_until: null, ...over },
});
const row = (
  location: string,
  outcome: string,
  sec: number,
  attempt = 1,
  status_code: number | null = 500,
) => ({
  monitor_id: 'm1',
  location,
  outcome,
  checked_at: at(sec),
  attempt,
  status_code,
  error: null,
});
const down = [
  row('SIN', 'fail', 0),
  row('TYO', 'fail', 1),
  row('SIN', 'fail', 31, 2),
  row('TYO', 'fail', 32, 2),
];
const ok = [row('SIN', 'pass', 0, 1, 200), row('TYO', 'pass', 1, 1, 200)];
const incident = (state: string, downQueued = true) => ({
  id: 'i1',
  site_id: 's1',
  state,
  severity: 'down',
  root_cause_category: null,
  notifications: downQueued ? [{ template: 'down' }] : [],
});

describe('runEngine', () => {
  it('does nothing without monitors', async () => {
    const { db, rpcCalls } = fakeDb();
    expect(await runEngine(db, now)).toEqual({
      ok: true,
      monitors: 0,
      opened: 0,
      recovered: 0,
      settled: 0,
      relapses: 0,
    });
    expect(rpcCalls).toEqual([]);
  });

  it('opens an incident with the cause when both locations fail the check and the recheck', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'check_results.select': { data: down },
      'rpc.engine_open_incident': { data: 'i1' },
    });
    expect(await runEngine(db, now)).toMatchObject({ monitors: 1, opened: 1 });
    expect(rpcCalls).toEqual([
      {
        name: 'engine_open_incident',
        args: {
          p_site_id: 's1',
          p_monitor_id: 'm1',
          p_trigger: 'hard_fail',
          p_severity: 'down',
          p_started_at: at(0),
          p_detected_at: '2026-10-06T10:00:32.000Z', // the last confirming recheck, not the run
          p_round_at: at(0),
          p_context: { cause: 'HTTP 500 (SIN, TYO)', confirmingLocations: 2 },
          p_notify: true,
        },
      },
    ]);
  });

  it('counts nothing when the site already had an open incident (the function returns null)', async () => {
    const { db } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'check_results.select': { data: down },
      'rpc.engine_open_incident': { data: null },
    });
    expect(await runEngine(db, now)).toMatchObject({ opened: 0 });
  });

  it('opens the incident of a muted site without queueing the alert', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor({ muted_until: '2026-10-06T12:00:00Z' })] },
      'check_results.select': { data: down },
      'rpc.engine_open_incident': { data: 'i1' },
    });
    await runEngine(db, now);
    expect(rpcCalls[0]?.args).toMatchObject({ p_notify: false });
  });

  it('records a quiet round in site_status', async () => {
    const { db, calls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'check_results.select': { data: ok },
    });
    await runEngine(db, now);
    expect(calls.find((c) => c.table === 'site_status' && c.op === 'upsert')?.values).toEqual({
      site_id: 's1',
      last_round_at: at(0),
      last_evaluated_at: now.toISOString(),
      ok_rounds: 1,
    });
  });

  it('recovers an open incident on the first OK round, from the OK check time', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'check_results.select': { data: ok },
      'incidents.select': { data: [incident('unacked')] },
      'rpc.engine_recover_incident': { data: true },
    });
    expect(await runEngine(db, now)).toMatchObject({ recovered: 1 });
    expect(rpcCalls[0]).toEqual({
      name: 'engine_recover_incident',
      args: {
        p_incident_id: 'i1',
        p_from: 'unacked',
        p_to: 'monitoring',
        p_recovered_at: at(0),
        p_round_at: at(0),
        p_context: { okLocations: 2 },
        p_notify: true,
      },
    });
  });

  it('sends no RECOVERED when the DOWN was held back by a mute (spec §15.1)', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'check_results.select': { data: ok },
      'incidents.select': { data: [incident('unacked', false)] },
      'rpc.engine_recover_incident': { data: true },
    });
    await runEngine(db, now);
    expect(rpcCalls[0]?.args).toMatchObject({ p_notify: false });
  });

  it('judges a missed round and the next in one run', async () => {
    const { db, calls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'check_results.select': {
        data: [
          ...ok.map((r) => ({
            ...r,
            checked_at: at(Date.parse(r.checked_at) / 1000 - Date.parse(at(0)) / 1000 - 60),
          })),
          ...ok,
        ],
      },
    });
    await runEngine(db, new Date(Date.parse(at(0)) + 140_000));
    expect(
      calls
        .filter((c) => c.table === 'site_status' && c.op === 'upsert')
        .map((c) => (c.values as { ok_rounds: number }).ok_rounds),
    ).toEqual([1, 2]);
  });

  it('settles on the second OK round', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'check_results.select': { data: ok },
      'site_status.select': { data: [{ site_id: 's1', last_round_at: at(-60), ok_rounds: 1 }] },
      'incidents.select': { data: [incident('monitoring')] },
      'rpc.engine_settle_incident': { data: true },
    });
    expect(await runEngine(db, now)).toMatchObject({ settled: 1 });
    expect(rpcCalls[0]).toMatchObject({
      name: 'engine_settle_incident',
      args: { p_from: 'monitoring', p_to: 'needs_root_cause' },
    });
  });

  it('counts and logs a relapse while the incident is open, without alerting', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'check_results.select': { data: down },
      'incidents.select': { data: [incident('needs_root_cause')] },
      'probe_locations.select': { data: [{ code: 'SIN' }, { code: 'TYO' }] },
    });
    expect(await runEngine(db, now)).toMatchObject({ relapses: 1, opened: 0 });
    expect(rpcCalls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('relapse_not_alerted'));
    warn.mockRestore();
  });

  it('waits when the round was already judged', async () => {
    const { db, calls, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'check_results.select': { data: ok },
      'site_status.select': { data: [{ site_id: 's1', last_round_at: at(1), ok_rounds: 1 }] },
    });
    await runEngine(db, now);
    expect(rpcCalls).toEqual([]);
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  it.each([
    ['monitors.select', 'monitors: boom'],
    ['check_results.select', 'boom'],
    ['site_status.upsert', 'site_status: boom'],
    ['probe_locations.select', 'boom'],
  ])('throws when %s fails', async (key, message) => {
    const { db } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'check_results.select': { data: ok },
      [key]: { error: { message: 'boom' } },
    });
    await expect(runEngine(db, now)).rejects.toThrow(message);
  });

  it.each([
    ['rpc.engine_open_incident', down, [], []],
    ['rpc.engine_recover_incident', ok, [incident('unacked')], []],
    [
      'rpc.engine_settle_incident',
      ok,
      [incident('monitoring')],
      [{ site_id: 's1', last_round_at: null, ok_rounds: 1 }],
    ],
  ])('throws when %s fails', async (key, checks, incidents, statuses) => {
    const { db } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'check_results.select': { data: checks },
      'incidents.select': { data: incidents },
      'site_status.select': { data: statuses },
      [key]: { error: { message: 'boom' } },
    });
    await expect(runEngine(db, now)).rejects.toThrow(`${key.slice(4)}: boom`);
  });
});
