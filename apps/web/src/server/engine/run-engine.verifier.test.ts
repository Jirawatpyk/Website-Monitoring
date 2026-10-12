// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeDb as baseFakeDb, type FakeCall } from '../../../test/fake-db';
import { runEngine } from './run-engine';
import { verificationOf, type VerifyJobRow } from './verifier-state';

// A blocked round on SIN + TYO at 10:00 (D-001, D-019), judged at 10:01:05.
const now = new Date('2026-10-06T10:01:05Z');
const at = (sec: number) => new Date(Date.parse('2026-10-06T10:00:00Z') + sec * 1000).toISOString();
const beating = [
  { code: 'SIN', last_heartbeat_at: at(50) },
  { code: 'TYO', last_heartbeat_at: at(30) },
];
const monitor = {
  id: 'm1',
  url: 'https://tubtong.example.test',
  is_primary: true,
  must_contain: ['Tubtong'],
  timeout_ms: 10_000,
  thresholds: {},
  allowed_redirect_domains: [],
  site_id: 's1',
  sites: { name: 'Tubtong', tier: 1, is_active: true, muted_until: null },
};
const blocked = [
  {
    monitor_id: 'm1',
    location: 'SIN',
    outcome: 'blocked',
    checked_at: at(1),
    attempt: 1,
    status_code: 403,
    error: null,
  },
  {
    monitor_id: 'm1',
    location: 'TYO',
    outcome: 'blocked',
    checked_at: at(2),
    attempt: 1,
    status_code: 403,
    error: null,
  },
];
const verifierUp = { 'agent_heartbeats.select': { data: { last_seen_at: at(60) } } };
const job = (over: Partial<VerifyJobRow> = {}): VerifyJobRow => ({
  id: 'j1',
  monitor_id: 'm1',
  round_at: at(0),
  status: 'done',
  result: 'loaded',
  detail: null,
  attempts: 1,
  created_at: at(62),
  lease_until: null,
  completed_at: at(64),
  ...over,
});
const fakeDb = (results: Parameters<typeof baseFakeDb>[0] = {}) =>
  baseFakeDb({
    'probe_locations.select': { data: beating },
    'monitors.select': { data: [monitor] },
    'rpc.engine_checks': { data: blocked },
    ...results,
  });
/** Verify jobs come from `engine_verify_jobs`; the queued count from a `verification_jobs` head query. */
const jobs =
  (rows: VerifyJobRow[], queued = 0) =>
  (c: FakeCall) =>
    c.filters.some(([m, col]) => m === 'eq' && col === 'status') ? { count: queued } : { data: rows };

describe('runEngine — blocked rounds (S03)', () => {
  it('queues a verify job for the round when the verifier is up, and waits', async () => {
    const { db, calls, rpcCalls } = fakeDb(verifierUp);
    expect(await runEngine(db, now)).toMatchObject({ verifying: 1, opened: 0, unverified: 0 });
    expect(calls.find((c) => c.table === 'verification_jobs' && c.op === 'insert')?.values).toEqual({
      kind: 'verify',
      monitor_id: 'm1',
      site_id: 's1',
      round_at: at(0),
      url: 'https://tubtong.example.test',
      must_contain: ['Tubtong'],
    });
    // The round isn't recorded: the job's result will judge it.
    expect(rpcCalls.map((c) => c.name)).toEqual([]);
  });

  it('a second engine run queueing the same job is a no-op', async () => {
    const { db } = fakeDb({
      ...verifierUp,
      'verification_jobs.insert': { error: { message: 'duplicate', code: '23505' } },
    });
    expect(await runEngine(db, now)).toMatchObject({ verifying: 0 });
  });

  it('fails the run on any other insert error', async () => {
    const { db } = fakeDb({ ...verifierUp, 'verification_jobs.insert': { error: { message: 'boom' } } });
    expect(await runEngine(db, now)).toMatchObject({
      ok: false,
      failures: ['Tubtong: verification_jobs: boom'],
    });
  });

  it('page loaded → an OK round with the note on the site', async () => {
    const { db, rpcCalls } = fakeDb({ ...verifierUp, 'rpc.engine_verify_jobs': jobs([job()]) });
    await runEngine(db, now);
    expect(rpcCalls.map((c) => c.name)).toEqual(['engine_record_round', 'engine_note_site']);
    expect(rpcCalls[0]?.args).toMatchObject({ p_ok_rounds: 1 });
    expect(rpcCalls[1]?.args).toEqual({
      p_site_id: 's1',
      p_round_at: at(0),
      p_note: 'Automated check blocked by bot protection; verified via browser',
    });
  });

  it('page failed in the browser → DOWN with the browser cause and the verify job', async () => {
    const { db, rpcCalls } = fakeDb({
      ...verifierUp,
      'rpc.engine_verify_jobs': jobs([job({ result: 'failed', detail: 'HTTP 503' })]),
      'rpc.engine_open_incident': { data: 'i1' },
    });
    expect(await runEngine(db, now)).toMatchObject({ opened: 1 });
    expect(rpcCalls[0]).toMatchObject({
      name: 'engine_open_incident',
      args: {
        p_trigger: 'hard_fail',
        p_severity: 'down',
        p_started_at: at(1),
        p_detected_at: at(64),
        p_context: {
          cause: 'Browser: page didn’t load (HTTP 503)',
          confirmingLocations: 2,
          verifyJobId: 'j1',
        },
        p_notify: true,
      },
    });
  });

  it('verifier down → PROBLEM (unverified) at once, the note, and one Admin alert naming the site (D-001)', async () => {
    const { db, rpcCalls } = fakeDb({ 'rpc.open_system_alert': { data: 'a1' } });
    expect(await runEngine(db, now)).toMatchObject({ unverified: 1, alerts: 1 });
    expect(rpcCalls.map((c) => c.name)).toEqual([
      'engine_open_incident',
      'engine_note_site',
      'open_system_alert',
    ]);
    expect(rpcCalls[0]?.args).toMatchObject({
      p_trigger: 'blocked_unverified',
      p_severity: 'problem',
      p_started_at: at(1),
      p_detected_at: now.toISOString(),
      // Its Chat card and owner email go out now (D-019, S04a).
      p_notify: true,
      p_context: {
        cause: 'HTTP 403 bot challenge (SIN, TYO) · browser verifier unavailable',
        summary: 'blocked by bot protection, not verified',
        verifier: 'no_poll',
      },
      p_status: 'problem',
    });
    expect(rpcCalls[1]?.args).toMatchObject({ p_note: 'Blocked, not verified' });
    expect(rpcCalls[2]?.args).toEqual({
      p_kind: 'verifier_unavailable',
      p_context: { sites: ['Tubtong (Tier 1)'], reason: 'no_poll' },
    });
  });

  it('the browser was blocked too → PROBLEM with that cause, and no Admin alert (D-020)', async () => {
    const { db, rpcCalls } = fakeDb({
      ...verifierUp,
      'rpc.engine_verify_jobs': jobs([job({ result: 'blocked' })]),
    });
    expect(await runEngine(db, now)).toMatchObject({ unverified: 1, alerts: 0 });
    expect(rpcCalls.map((c) => c.name)).toEqual(['engine_open_incident', 'engine_note_site']);
    expect(rpcCalls[0]?.args).toMatchObject({
      p_trigger: 'blocked_unverified',
      p_context: {
        cause: 'HTTP 403 bot challenge (SIN, TYO) · blocked in the browser too',
        verifier: 'browser_blocked',
      },
    });
  });

  describe('a site behind a WAF (D-027)', () => {
    const wafMonitor = { ...monitor, sites: { ...monitor.sites, behind_waf: true } };
    const withBkk = [{ code: 'BKK', last_heartbeat_at: at(55) }, ...beating];
    const bkk = (over: Record<string, unknown> = {}) => ({
      monitor_id: 'm1',
      location: 'BKK',
      outcome: 'pass',
      checked_at: at(3),
      attempt: 1,
      status_code: 200,
      error: null,
      keyword_missing: [],
      keyword_forbidden: [],
      ...over,
    });
    const akamai = blocked.map((c) => ({ ...c, waf: 'akamai' }));

    it('BKK passes, Akamai blocks SIN / TYO → OK with the note, no verify job', async () => {
      const { db, rpcCalls, calls } = fakeDb({
        ...verifierUp,
        'probe_locations.select': { data: withBkk },
        'monitors.select': { data: [wafMonitor] },
        'rpc.engine_checks': { data: [bkk({ control_ok: true }), ...akamai] },
      });
      expect(await runEngine(db, now)).toMatchObject({ verifying: 0, unverified: 0 });
      expect(calls.some((c) => c.table === 'verification_jobs' && c.op === 'insert')).toBe(false);
      expect(rpcCalls.find((c) => c.name === 'engine_note_site')?.args).toMatchObject({
        p_note: 'Verified from BKK; SIN, TYO blocked by bot protection',
      });
    });

    it('one failing BKK control minute is no data: no PROBLEM, nothing queued (D-038)', async () => {
      const { db, rpcCalls } = fakeDb({
        ...verifierUp,
        'probe_locations.select': { data: withBkk },
        'monitors.select': { data: [wafMonitor] },
        'rpc.engine_checks': { data: [bkk({ control_ok: false }), ...akamai] },
      });
      expect(await runEngine(db, now)).toMatchObject({ unverified: 0, opened: 0 });
      expect(rpcCalls.some((c) => c.name === 'engine_open_incident')).toBe(false);
    });

    // Earlier BKK minutes of another monitor: the VPS's control result per probe minute (D-028).
    const minute = (sec: number, control_ok: boolean, attempt = 1) =>
      bkk({ monitor_id: 'm-other', checked_at: at(sec), control_ok, attempt });

    it('alert still open, but the control passed a minute ago: one failing minute stays no data (D-038)', async () => {
      const { db, rpcCalls } = fakeDb({
        ...verifierUp,
        'probe_locations.select': { data: withBkk },
        'monitors.select': { data: [wafMonitor] },
        'rpc.engine_checks': { data: [minute(-57, true), bkk({ control_ok: false }), ...akamai] },
        'system_alerts.select': {
          data: [{ kind: 'bkk_control_failing', context: {}, opened_at: '2026-10-06T09:40:00Z' }],
        },
      });
      expect(await runEngine(db, now)).toMatchObject({ unverified: 0 });
      expect(rpcCalls.some((c) => c.name === 'engine_open_incident')).toBe(false);
    });

    it('scheduled control failing every minute is not hidden by rechecks that pass it (D-038)', async () => {
      const { db } = fakeDb({
        ...verifierUp,
        'probe_locations.select': { data: withBkk },
        'monitors.select': { data: [wafMonitor] },
        'rpc.engine_checks': {
          data: [
            minute(-117, false),
            minute(-87, true, 2),
            minute(-57, false),
            minute(-27, true, 2),
            bkk({ control_ok: false }),
            minute(33, true, 2),
            ...akamai,
          ],
        },
      });
      expect(await runEngine(db, now)).toMatchObject({ unverified: 1 });
    });

    it('the VPS’s control check down 3 minutes → PROBLEM (unverified) with that cause, and no verifier Admin alert', async () => {
      const { db, rpcCalls } = fakeDb({
        ...verifierUp,
        'probe_locations.select': { data: withBkk },
        'monitors.select': { data: [wafMonitor] },
        'rpc.engine_checks': {
          data: [minute(-117, false), minute(-57, false), bkk({ control_ok: false }), ...akamai],
        },
        'system_alerts.select': {
          data: [{ kind: 'bkk_control_failing', context: {}, opened_at: '2026-10-06T09:40:00Z' }],
        },
      });
      expect(await runEngine(db, now)).toMatchObject({ unverified: 1, alerts: 0 });
      expect(rpcCalls[0]?.args).toMatchObject({
        p_trigger: 'blocked_unverified',
        p_context: {
          cause: 'HTTP 403 bot challenge (SIN, TYO) · BKK network check failed, not verified',
          verifier: 'control_failed',
        },
      });
      expect(rpcCalls.some((c) => c.name === 'open_system_alert')).toBe(false);
    });

    it('a DOWN confirmed by BKK alone names who confirmed it and who the WAF blocked (D-027)', async () => {
      const { db, rpcCalls } = fakeDb({
        ...verifierUp,
        'probe_locations.select': { data: withBkk },
        'monitors.select': { data: [wafMonitor] },
        'rpc.engine_checks': {
          data: [
            bkk({ outcome: 'fail', status_code: 503, control_ok: true }),
            bkk({ outcome: 'fail', status_code: 503, control_ok: true, attempt: 2, checked_at: at(33) }),
            ...akamai,
          ],
        },
        'rpc.engine_open_incident': { data: 'i1' },
      });
      await runEngine(db, now);
      expect(rpcCalls.find((c) => c.name === 'engine_open_incident')?.args).toMatchObject({
        p_context: { confirmingLocations: 1, confirmingFrom: ['BKK'], wafBlocked: ['SIN', 'TYO'] },
      });
    });

    it('the control check failing 3 BKK rounds in a row → one Admin alert naming the sites (D-028); it clears once it passes', async () => {
      // BKK batches at 09:58, 09:59 and 10:00, all with the control check down.
      const earlier = [-120, -60].map((sec) =>
        bkk({ control_ok: false, checked_at: at(sec), monitor_id: 'm0' }),
      );
      const { db, rpcCalls } = fakeDb({
        ...verifierUp,
        'probe_locations.select': { data: withBkk },
        'monitors.select': { data: [wafMonitor] },
        'rpc.engine_checks': { data: [bkk({ control_ok: false }), ...akamai, ...earlier] },
        'rpc.open_system_alert': { data: 'a1' },
      });
      expect(await runEngine(db, now)).toMatchObject({ alerts: 1 });
      expect(rpcCalls.find((c) => c.name === 'open_system_alert')?.args).toEqual({
        p_kind: 'bkk_control_failing',
        p_context: { sites: [`${wafMonitor.sites.name} (Tier ${wafMonitor.sites.tier})`] },
      });

      const old = fakeDb({
        ...verifierUp,
        'probe_locations.select': { data: withBkk },
        'monitors.select': { data: [wafMonitor] },
        'rpc.engine_checks': { data: [bkk({ control_ok: true }), ...akamai] },
        'system_alerts.select': {
          data: [{ kind: 'bkk_control_failing', context: {}, opened_at: '2026-10-06T09:40:00Z' }],
        },
      });
      await runEngine(old.db, now);
      expect(old.rpcCalls).toContainEqual({
        name: 'clear_system_alert',
        args: { p_kind: 'bkk_control_failing' },
      });
    });
  });

  it('a job nobody picked up in 30 s counts the verifier unavailable even while it polls', async () => {
    const { db, rpcCalls } = fakeDb({
      ...verifierUp,
      'rpc.engine_verify_jobs': jobs([
        job({ status: 'queued', result: null, created_at: at(30), completed_at: null }),
      ]),
    });
    expect(await runEngine(db, now)).toMatchObject({ unverified: 1 });
    expect(rpcCalls.find((c) => c.name === 'open_system_alert')?.args).toMatchObject({
      p_context: { reason: 'not_picked_up' },
    });
  });

  it('names the reason the engine saw: a lease that ran out', async () => {
    const { db, rpcCalls } = fakeDb({
      ...verifierUp,
      'rpc.engine_verify_jobs': jobs([
        job({ status: 'leased', result: null, lease_until: at(60), completed_at: null }),
      ]),
    });
    await runEngine(db, now);
    expect(rpcCalls.find((c) => c.name === 'open_system_alert')?.args).toMatchObject({
      p_context: { reason: 'lease_expired' },
    });
  });

  it('with an incident open, an unverified round records the round and sends no second alert', async () => {
    const { db, rpcCalls } = fakeDb({
      'incidents.select': {
        data: [
          {
            id: 'i1',
            site_id: 's1',
            state: 'unacked',
            severity: 'problem',
            root_cause_category: null,
            notifications: [],
          },
        ],
      },
      'site_status.select': {
        data: [{ site_id: 's1', last_round_at: null, ok_rounds: 0, note: 'Blocked, not verified' }],
      },
      'system_alerts.select': { data: [{ kind: 'verifier_unavailable', context: { reason: 'no_poll' } }] },
    });
    expect(await runEngine(db, now)).toMatchObject({ unverified: 1, alerts: 0 });
    expect(rpcCalls.map((c) => c.name)).toEqual(['engine_record_round']);
    expect(rpcCalls[0]?.args).toMatchObject({ p_ok_rounds: 0 });
  });

  it('a plain pass round clears a note left by a blocked one', async () => {
    const { db, rpcCalls } = fakeDb({
      'rpc.engine_checks': {
        data: blocked.map((c) => ({ ...c, outcome: 'pass', status_code: 200 })),
      },
      'site_status.select': {
        data: [
          {
            site_id: 's1',
            last_round_at: null,
            ok_rounds: 1,
            note: 'Automated check blocked by bot protection; verified via browser',
          },
        ],
      },
    });
    await runEngine(db, now);
    expect(rpcCalls.find((c) => c.name === 'engine_note_site')?.args).toEqual({
      p_site_id: 's1',
      p_round_at: at(0),
    });
  });

  it.each([
    ['opened 10 min ago, polling, nothing queued', at(-540), 0, true],
    ['opened 5 min ago (it could flap)', at(-240), 0, false],
    ['jobs still queued', at(-540), 2, false],
  ])(
    'a verifier-unavailable alert clears once it works again — %s (engine review M3)',
    async (_n, openedAt, queued, cleared) => {
      const { db, rpcCalls } = fakeDb({
        ...verifierUp,
        'rpc.engine_checks': { data: [] },
        'verification_jobs.select': jobs([], queued),
        'system_alerts.select': {
          data: [{ kind: 'verifier_unavailable', context: { reason: 'lease_expired' }, opened_at: openedAt }],
        },
      });
      await runEngine(db, now);
      expect(rpcCalls).toEqual(
        cleared ? [{ name: 'clear_system_alert', args: { p_kind: 'verifier_unavailable' } }] : [],
      );
    },
  );

  it('a job queued 35 s while every session was busy with a live lease waits its turn (engine review M4, N1)', async () => {
    const { db, rpcCalls } = fakeDb({
      'agent_heartbeats.select': { data: { last_seen_at: at(60), info: { sessions: 3, free: 0 } } },
      'rpc.engine_verify_jobs': jobs([
        job({ status: 'queued', result: null, created_at: at(30), completed_at: null }),
      ]),
      'verification_jobs.select': jobs([], 1),
    });
    expect(await runEngine(db, now)).toMatchObject({ unverified: 0 });
    expect(rpcCalls).toEqual([]);
  });

  it('a job nobody picked up is expired with its round, so a late verdict can’t land on it', async () => {
    const { db, calls } = fakeDb({
      ...verifierUp,
      'rpc.engine_verify_jobs': jobs([
        job({ status: 'queued', result: null, created_at: at(30), completed_at: null }),
      ]),
    });
    await runEngine(db, now);
    expect(calls.find((c) => c.table === 'verification_jobs' && c.op === 'update')).toMatchObject({
      values: { status: 'expired' },
      filters: [
        ['eq', 'monitor_id', 'm1'],
        ['eq', 'round_at', at(0)],
        ['eq', 'status', 'queued'],
      ],
    });
  });

  it('DOWN while a PROBLEM (unverified) is open → raised to DOWN with its alert (D-021)', async () => {
    const { db, rpcCalls } = fakeDb({
      'rpc.engine_checks': {
        data: [
          {
            monitor_id: 'm1',
            location: 'SIN',
            outcome: 'fail',
            checked_at: at(1),
            attempt: 1,
            status_code: 500,
            error: null,
          },
          {
            monitor_id: 'm1',
            location: 'TYO',
            outcome: 'fail',
            checked_at: at(2),
            attempt: 1,
            status_code: 500,
            error: null,
          },
          {
            monitor_id: 'm1',
            location: 'SIN',
            outcome: 'fail',
            checked_at: at(31),
            attempt: 2,
            status_code: 500,
            error: null,
          },
          {
            monitor_id: 'm1',
            location: 'TYO',
            outcome: 'fail',
            checked_at: at(32),
            attempt: 2,
            status_code: 500,
            error: null,
          },
        ],
      },
      'incidents.select': {
        data: [
          {
            id: 'i1',
            site_id: 's1',
            state: 'unacked',
            severity: 'problem',
            root_cause_category: null,
            notifications: [],
          },
        ],
      },
      'rpc.engine_escalate_incident': { data: true },
    });
    expect(await runEngine(db, now)).toMatchObject({ escalated: 1 });
    expect(rpcCalls[0]).toMatchObject({
      name: 'engine_escalate_incident',
      args: {
        p_incident_id: 'i1',
        p_detected_at: at(32),
        p_notify: true,
        p_context: { confirmingLocations: 2 },
      },
    });
  });

  it('alerts when more than 5 jobs are stuck, and clears 10 min later once the queue drains', async () => {
    const behind = fakeDb({
      ...verifierUp,
      'rpc.engine_checks': { data: [] },
      'verification_jobs.select': jobs([], 6),
      'rpc.open_system_alert': { data: 'a2' },
    });
    expect(await runEngine(behind.db, now)).toMatchObject({ alerts: 1 });
    expect(behind.rpcCalls).toEqual([
      { name: 'open_system_alert', args: { p_kind: 'verifier_backlog', p_context: { queued: 6 } } },
    ]);
    // Only jobs queued more than 30 s ago count: a fresh burst the next poll takes is no backlog.
    const count = behind.calls.find(
      (c) =>
        c.table === 'verification_jobs' && c.filters.some(([m, col]) => m === 'lt' && col === 'created_at'),
    );
    expect(count?.filters).toContainEqual([
      'lt',
      'created_at',
      new Date(now.getTime() - 30_000).toISOString(),
    ]);

    const backlog = (opened: string) => ({
      ...verifierUp,
      'rpc.engine_checks': { data: [] },
      'verification_jobs.select': jobs([], 5),
      'system_alerts.select': {
        data: [{ kind: 'verifier_backlog', context: { queued: 6 }, opened_at: opened }],
      },
    });
    const young = fakeDb(backlog(new Date(now.getTime() - 60_000).toISOString()));
    await runEngine(young.db, now);
    expect(young.rpcCalls).toEqual([]);
    const drained = fakeDb(backlog(new Date(now.getTime() - 11 * 60_000).toISOString()));
    await runEngine(drained.db, now);
    expect(drained.rpcCalls).toEqual([{ name: 'clear_system_alert', args: { p_kind: 'verifier_backlog' } }]);
  });

  it.each(['agent_heartbeats.select', 'verification_jobs.select', 'system_alerts.select'])(
    'throws when %s fails',
    async (key) => {
      const { db } = fakeDb({ [key]: { error: { message: 'boom' } } });
      await expect(runEngine(db, now)).rejects.toThrow('boom');
    },
  );
});

describe('verificationOf — what a job means now (D-019)', () => {
  const t = new Date('2026-10-06T10:01:05Z');
  it.each<[string, Partial<VerifyJobRow>, string, string?]>([
    ['loaded', {}, 'loaded'],
    ['failed', { result: 'failed' }, 'failed'],
    ['blocked in the browser', { result: 'blocked' }, 'blocked'],
    ['leased, lease holds', { status: 'leased', result: null, lease_until: at(90) }, 'pending'],
    [
      'leased, lease ran out',
      { status: 'leased', result: null, lease_until: at(60) },
      'unavailable',
      'lease_expired',
    ],
    ['queued 20 s', { status: 'queued', result: null, created_at: at(45) }, 'pending'],
    ['queued 35 s', { status: 'queued', result: null, created_at: at(30) }, 'unavailable', 'not_picked_up'],
    [
      'expired after a lease',
      { status: 'expired', result: null, attempts: 1 },
      'unavailable',
      'lease_expired',
    ],
    [
      'expired never leased',
      { status: 'expired', result: null, attempts: 0 },
      'unavailable',
      'not_picked_up',
    ],
  ])('%s → %s', (_name, over, state, reason) => {
    const v = verificationOf(job(over), t);
    expect(v.state).toBe(state);
    if (reason) expect(v).toMatchObject({ reason });
  });
});
