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
  is_primary: true,
  must_contain: ['Tubtong'],
  timeout_ms: 10_000,
  thresholds: {},
  allowed_redirect_domains: [],
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
  episode_severity: 'down',
  started_at: at(-600),
  detected_at: at(-560),
  acked_at: null,
  recovered_at: state === 'monitoring' || state === 'needs_root_cause' ? at(-120) : null,
  escalation_level: 0,
  is_flapping: false,
  root_cause_category: null,
  notifications: downQueued ? [{ template: 'down' }] : [],
});

describe('runEngine', () => {
  it('does nothing without monitors', async () => {
    const { db, rpcCalls } = fakeDb();
    expect(await runEngine(db, now)).toEqual({
      ok: true,
      sites: 0,
      monitors: 0,
      opened: 0,
      problems: 0,
      recovered: 0,
      settled: 0,
      relapses: 0,
      verifying: 0,
      unverified: 0,
      alerts: 0,
      escalated: 0,
    });
    expect(rpcCalls).toEqual([]);
  });

  it('opens an incident with the cause when both locations fail the check and the recheck', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: down },
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
          // The monitor's verdict and the site status commit with the incident (D-022).
          p_monitors: [
            {
              monitorId: 'm1',
              status: 'down',
              trigger: null,
              cause: null,
              slowRounds: 0,
              failingSince: {
                SIN: at(0),
                TYO: at(1),
              },
            },
          ],
          p_status: 'down',
        },
      },
    ]);
  });

  it.each([
    ['beating', '2026-10-06T10:00:40Z', []],
    ['stopped 3 min ago', '2026-10-06T09:58:00Z', ['engine_record_round']],
    ['never started', null, ['engine_record_round']],
  ])('expects Bangkok only while its agent beats (D-019) — agent %s', async (_name, beat, rpcs) => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: ok },
      'probe_locations.select': { data: [...beating, { code: 'BKK', last_heartbeat_at: beat }] },
    });
    // A beating agent that hasn't reported holds an OK round until its deadline; a stopped one doesn't.
    await runEngine(db, now);
    expect(rpcCalls.map((c) => c.name)).toEqual(rpcs);
  });

  it('a DOWN two locations confirmed is judged without waiting for a beating Bangkok (engine review M2)', async () => {
    const { db } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: down },
      'probe_locations.select': {
        data: [...beating, { code: 'BKK', last_heartbeat_at: '2026-10-06T10:00:40Z' }],
      },
      'rpc.engine_open_incident': { data: 'i1' },
    });
    expect(await runEngine(db, now)).toMatchObject({ opened: 1 });
  });

  it('counts nothing when the site already had an open incident (the function returns null)', async () => {
    const { db } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: down },
      'rpc.engine_open_incident': { data: null },
    });
    expect(await runEngine(db, now)).toMatchObject({ opened: 0 });
  });

  it('opens the incident of a muted site without queueing the alert', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor({ muted_until: '2026-10-06T12:00:00Z' })] },
      'rpc.engine_checks': { data: down },
      'rpc.engine_open_incident': { data: 'i1' },
    });
    await runEngine(db, now);
    expect(rpcCalls[0]?.args).toMatchObject({ p_notify: false });
  });

  it('records a quiet round in site_status', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: ok },
    });
    await runEngine(db, now);
    // Through the guarded function: a run with an older snapshot never moves the round back.
    expect(rpcCalls.find((c) => c.name === 'engine_record_round')?.args).toEqual({
      p_site_id: 's1',
      p_round_at: at(0),
      p_evaluated_at: now.toISOString(),
      p_ok_rounds: 1,
      p_monitors: [
        { monitorId: 'm1', status: 'ok', trigger: null, cause: null, slowRounds: 0, failingSince: {} },
      ],
      p_status: 'ok',
    });
  });

  it('recovers an open incident on the first OK round, from the OK check time', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: ok },
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
        p_context: { okLocations: 2, slowLimitMs: 3_000, recoveredAt: at(0) },
        p_notify: true,
        p_flip_ok: true,
        p_auto_resolve: false,
        p_hold_summary: false,
        p_monitors: [
          { monitorId: 'm1', status: 'ok', trigger: null, cause: null, slowRounds: 0, failingSince: {} },
        ],
        // PRD §5: the site shows OK only after the second OK round.
        p_status: 'down',
      },
    });
  });

  it('sends no RECOVERED when the DOWN was held back by a mute (spec §15.1)', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: ok },
      'incidents.select': { data: [incident('unacked', false)] },
      'rpc.engine_recover_incident': { data: true },
    });
    await runEngine(db, now);
    expect(rpcCalls[0]?.args).toMatchObject({ p_notify: false });
  });

  it('judges a missed round and the next in one run', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': {
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
      'rpc.engine_checks': { data: ok },
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

  it('a DOWN on a recovered incident joins it: DOWN AGAIN through one guarded function (D-004)', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: down },
      'incidents.select': { data: [incident('needs_root_cause')] },
      'site_status.select': {
        data: [
          { site_id: 's1', last_round_at: null, ok_rounds: 2, flips: [at(-600), at(-120)], flip_ok: true },
        ],
      },
      'rpc.engine_relapse_incident': { data: true },
    });
    expect(await runEngine(db, now)).toMatchObject({ relapses: 1, opened: 0 });
    expect(rpcCalls.map((c) => c.name)).toEqual(['engine_relapse_incident']);
    expect(rpcCalls[0]?.args).toMatchObject({
      p_incident_id: 'i1',
      p_severity: 'down',
      p_trigger: 'hard_fail',
      p_round_at: at(0),
      // 3rd change in 30 min: the reply says "Now flapping" (D-024).
      p_flapping: true,
      p_context: { backSince: at(-120), nowFlapping: true, flapping: true, startedAt: at(0) },
      p_notify: true,
      p_status: 'down',
    });
  });

  it('an overlapping run that loses the relapse guard counts nothing', async () => {
    const { db } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: down },
      'incidents.select': { data: [incident('monitoring')] },
      'rpc.engine_relapse_incident': { data: false },
    });
    expect(await runEngine(db, now)).toMatchObject({ relapses: 0 });
  });

  it('waits when the round was already judged', async () => {
    const { db, calls, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: ok },
      'site_status.select': { data: [{ site_id: 's1', last_round_at: at(1), ok_rounds: 1 }] },
    });
    await runEngine(db, now);
    expect(rpcCalls).toEqual([]);
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  it.each([
    ['monitors.select', 'monitors: boom'],
    ['rpc.engine_checks', 'boom'],
    ['probe_locations.select', 'boom'],
  ])('throws when %s fails', async (key, message) => {
    const { db } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: ok },
      [key]: { error: { message: 'boom' } },
    });
    await expect(runEngine(db, now)).rejects.toThrow(message);
  });

  it.each([
    ['rpc.engine_record_round', ok, [], []],
    ['rpc.engine_open_incident', down, [], []],
    ['rpc.engine_recover_incident', ok, [incident('unacked')], []],
    [
      'rpc.engine_settle_incident',
      ok,
      [incident('monitoring')],
      [{ site_id: 's1', last_round_at: null, ok_rounds: 1 }],
    ],
  ])('reports the run failed when %s fails', async (key, checks, incidents, statuses) => {
    const { db } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: checks },
      'incidents.select': { data: incidents },
      'site_status.select': { data: statuses },
      [key]: { error: { message: 'boom' } },
    });
    // A site's write failing fails the run (Healthchecks), never the other sites' judging.
    expect(await runEngine(db, now)).toMatchObject({
      ok: false,
      failures: [`Tubtong: ${key.slice(4)}: boom`],
    });
  });
});

describe('runEngine — PROBLEM triggers and site status (S04a, D-022)', () => {
  const page = (over: Record<string, unknown> = {}) => ({ ...monitor(), ...over });
  const slow = (monitor_id = 'm1') =>
    ['SIN', 'TYO'].map((location, i) => ({
      ...row(location, 'pass', i, 1, 200),
      monitor_id,
      response_ms: 3_400,
    }));

  it('the third slow round opens PROBLEM (Slow) with its cause, summary and alert', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: slow() },
      'rpc.engine_monitor_status': {
        data: [
          { monitor_id: 'm1', status: 'ok', trigger: null, cause: null, slow_rounds: 2, failing_since: {} },
        ],
      },
      'rpc.engine_open_incident': { data: 'i1' },
    });
    expect(await runEngine(db, now)).toMatchObject({ problems: 1, opened: 0 });
    expect(rpcCalls[0]).toMatchObject({
      name: 'engine_open_incident',
      args: {
        p_trigger: 'slow',
        p_severity: 'problem',
        p_started_at: at(-120),
        p_detected_at: now.toISOString(),
        p_context: {
          cause: 'p50 3.4 s (SIN, TYO) · over the Tier 1 limit of 3 s for 3 checks in a row',
          summary: 'slow, p50 3.4 s',
        },
        p_notify: true,
        p_status: 'problem',
        p_monitors: [{ monitorId: 'm1', status: 'problem', trigger: 'slow', slowRounds: 3 }],
      },
    });
  });

  it('a monitor’s own slow limit wins over the tier’s', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [page({ thresholds: { slowMs: 4_000 } })] },
      'rpc.engine_checks': { data: slow() },
      'rpc.engine_monitor_status': {
        data: [
          { monitor_id: 'm1', status: 'ok', trigger: null, cause: null, slow_rounds: 2, failing_since: {} },
        ],
      },
    });
    await runEngine(db, now);
    expect(rpcCalls[0]).toMatchObject({ name: 'engine_record_round', args: { p_status: 'ok' } });
  });

  it('a key page returning 500 while the home page is fine → PROBLEM (Key page), never DOWN', async () => {
    const booking = page({ id: 'm2', url: 'https://tubtong.example.test/booking', is_primary: false });
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [booking, monitor()] },
      'rpc.engine_checks': { data: [...ok, ...down.map((r) => ({ ...r, monitor_id: 'm2' }))] },
      'rpc.engine_open_incident': { data: 'i1' },
    });
    expect(await runEngine(db, now)).toMatchObject({ sites: 1, monitors: 2, problems: 1, opened: 0 });
    expect(rpcCalls[0]?.args).toMatchObject({
      p_monitor_id: 'm2',
      p_trigger: 'key_page',
      p_severity: 'problem',
      p_context: {
        cause: 'Home OK · /booking → HTTP 500 (SIN, TYO)',
        summary: 'key page /booking, HTTP 500',
        monitorUrl: 'https://tubtong.example.test/booking',
      },
      p_status: 'problem',
    });
  });

  it('skips a site without a primary monitor (only the primary can judge DOWN)', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [page({ is_primary: false })] },
      'rpc.engine_checks': { data: down },
    });
    expect(await runEngine(db, now)).toMatchObject({ sites: 0 });
    expect(rpcCalls.filter((c) => c.name.startsWith('engine_'))).toEqual([]);
  });

  it('keeps a key page’s worded cause while it has no data, and doesn’t recover what nobody saw recover', async () => {
    const booking = page({ id: 'm2', url: 'https://tubtong.example.test/booking', is_primary: false });
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor(), booking] },
      'rpc.engine_checks': { data: ok },
      'rpc.engine_monitor_status': {
        data: [
          {
            monitor_id: 'm2',
            status: 'problem',
            trigger: 'key_page',
            cause: 'Home OK · /booking → HTTP 404 (SIN, TYO)',
            slow_rounds: 0,
            failing_since: null,
          },
        ],
      },
      'incidents.select': {
        data: [{ ...incident('unacked'), severity: 'problem', notifications: [{ template: 'problem' }] }],
      },
      'rpc.engine_recover_incident': { data: true },
    });
    // Past the round's deadline, home passes, but /booking has no data: its problem holds.
    expect(await runEngine(db, new Date(at(140)))).toMatchObject({ recovered: 0 });
    expect(rpcCalls[0]).toMatchObject({ name: 'engine_record_round' });
    expect(rpcCalls[0]?.args).not.toHaveProperty('p_status');
    expect(rpcCalls[0]?.args).toMatchObject({
      p_monitors: [
        { monitorId: 'm1', status: 'ok' },
        {
          monitorId: 'm2',
          status: 'problem',
          cause: 'Home OK · /booking → HTTP 404 (SIN, TYO)',
          failingSince: {},
        },
      ],
    });
  });

  it('fewer than 2 locations beating → one Admin alert; it clears 10 min later once 2 beat again', async () => {
    const lonely = fakeDb({
      'monitors.select': { data: [monitor()] },
      'probe_locations.select': { data: [beating[0]] },
      'rpc.open_system_alert': { data: 'a1' },
    });
    expect(await runEngine(lonely.db, now)).toMatchObject({ alerts: 1 });
    expect(lonely.rpcCalls).toContainEqual({
      name: 'open_system_alert',
      args: { p_kind: 'probe_locations_low', p_context: { active: ['SIN'] } },
    });
    const alert = (opened: string) => ({
      'system_alerts.select': { data: [{ kind: 'probe_locations_low', context: {}, opened_at: opened }] },
    });
    const young = fakeDb({ ...alert('2026-10-06T09:55:00Z') });
    await runEngine(young.db, now);
    expect(young.rpcCalls).toEqual([]);
    const old = fakeDb({ ...alert('2026-10-06T09:50:00Z') });
    await runEngine(old.db, now);
    expect(old.rpcCalls).toEqual([{ name: 'clear_system_alert', args: { p_kind: 'probe_locations_low' } }]);
  });
});

describe('runEngine — one failing site never blinds the others (security review M1)', () => {
  it('judges every site, then fails the run naming the site whose write failed', async () => {
    const other = { ...monitor(), id: 'm2', site_id: 's2', sites: { ...monitor().sites, name: 'Other' } };
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor(), other] },
      'rpc.engine_checks': { data: [...ok, ...ok.map((r) => ({ ...r, monitor_id: 'm2' }))] },
      'rpc.engine_record_round': (call) =>
        (call.values as { p_site_id: string }).p_site_id === 's1' ? { error: { message: 'boom' } } : {},
    });
    expect(await runEngine(db, now)).toMatchObject({
      ok: false,
      failures: ['Tubtong: engine_record_round: boom'],
    });
    expect(rpcCalls.map((c) => (c.args as { p_site_id?: string }).p_site_id)).toEqual(['s1', 's2']);
  });
});

describe('runEngine — overlapping runs (engine review M2)', () => {
  const carryAt = (last_round_at: string) => ({
    'rpc.engine_monitor_status': {
      data: [
        {
          monitor_id: 'm1',
          status: 'ok',
          trigger: null,
          cause: null,
          slow_rounds: 2,
          failing_since: {},
          last_round_at,
        },
      ],
    },
  });
  const siteAt = (last_round_at: string) => ({
    'site_status.select': { data: [{ site_id: 's1', last_round_at, ok_rounds: 1, note: null }] },
  });

  it('skips a site whose carry is ahead of its round (read after another run committed it)', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: ok },
      ...siteAt(at(-120)),
      ...carryAt(at(-60)),
    });
    await runEngine(db, now);
    expect(rpcCalls.filter((c) => c.name.startsWith('engine_'))).toEqual([]);
  });

  it('a carry far behind its site is stale (the monitor was off): dropped, and the site judged', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: ok },
      ...siteAt(at(-60)),
      ...carryAt(at(-3600)),
    });
    await runEngine(db, now);
    expect(rpcCalls[0]).toMatchObject({
      name: 'engine_record_round',
      args: { p_monitors: [{ monitorId: 'm1', slowRounds: 0 }] },
    });
  });

  it('skips a site whose monitor carry is older than its round: read mid-commit of another run', async () => {
    const { db, rpcCalls } = fakeDb({
      'monitors.select': { data: [monitor()] },
      'rpc.engine_checks': { data: ok },
      'site_status.select': { data: [{ site_id: 's1', last_round_at: at(-60), ok_rounds: 1, note: null }] },
      'rpc.engine_monitor_status': {
        data: [
          {
            monitor_id: 'm1',
            status: 'ok',
            trigger: null,
            cause: null,
            slow_rounds: 2,
            failing_since: {},
            last_round_at: at(-120),
          },
        ],
      },
    });
    await runEngine(db, now);
    expect(rpcCalls.filter((c) => c.name.startsWith('engine_'))).toEqual([]);
  });
});
