// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb as baseFakeDb } from '../../../test/fake-db';

import { runEngine } from './run-engine';

const now = new Date('2026-10-06T10:01:05Z');
// Both Vercel locations active and beating, as on staging before Bangkok's agent runs.
const beating = [
  { code: 'SIN', last_heartbeat_at: '2026-10-06T10:00:50Z' },
  { code: 'TYO', last_heartbeat_at: '2026-10-06T10:00:30Z' },
];
const fakeDb = (results: Parameters<typeof baseFakeDb>[0] = {}) =>
  baseFakeDb({ 'probe_locations.select': { data: beating }, ...results });
const at = (sec: number) => new Date(Date.parse('2026-10-06T10:00:00Z') + sec * 1000).toISOString();

const monitor = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  url: 'https://tubtong.example.test',
  must_contain: ['Tubtong'],
  timeout_ms: 10_000,
  site_id: 's1',
  sites: { name: 'Tubtong', tier: 1, is_active: true, muted_until: null, ...over },
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
      verifying: 0,
      unverified: 0,
      alerts: 0,
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

  it.each([
    ['beating', '2026-10-06T10:00:40Z', 0],
    ['stopped 3 min ago', '2026-10-06T09:58:00Z', 1],
    ['never started', null, 1],
  ])('expects Bangkok only while its agent beats (D-019) — agent %s', async (_name, beat, opened) => {
    const { db } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'check_results.select': { data: down },
      'probe_locations.select': { data: [...beating, { code: 'BKK', last_heartbeat_at: beat }] },
      'rpc.engine_open_incident': { data: 'i1' },
    });
    // A beating agent that hasn't reported holds the round until its deadline; a stopped one doesn't.
    expect(await runEngine(db, now)).toMatchObject({ opened });
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
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'check_results.select': { data: ok },
    });
    await runEngine(db, now);
    // Through the guarded function: a run with an older snapshot never moves the round back.
    expect(rpcCalls.find((c) => c.name === 'engine_record_round')?.args).toEqual({
      p_site_id: 's1',
      p_round_at: at(0),
      p_evaluated_at: now.toISOString(),
      p_ok_rounds: 1,
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
    const { db, rpcCalls } = fakeDb({
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
      rpcCalls
        .filter((c) => c.name === 'engine_record_round')
        .map((c) => (c.args as { p_ok_rounds: number }).p_ok_rounds),
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
    });
    expect(await runEngine(db, now)).toMatchObject({ relapses: 1, opened: 0 });
    // Only the round is recorded: nothing opens and nothing alerts (D-004 is S04).
    expect(rpcCalls.map((c) => c.name)).toEqual(['engine_record_round']);
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
    ['rpc.engine_record_round', 'engine_record_round: boom'],
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
