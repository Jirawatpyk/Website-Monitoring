// @vitest-environment node
/**
 * S02a Done-when 3 and S02b Done-when 3 / 5: the engine and the notifier driven by stored rows on
 * the LOCAL Supabase stack
 * (`pnpm db:start`), through the real tables, SQL functions and constraints. Run with
 * `pnpm --filter @dxt/web test:int` (CI: the `db` job). Refuses any non-local URL.
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database, DbClient } from '@dxt/db';
import { runEngine } from './engine/run-engine';
import { engineAfterReport } from './engine/engine-and-deliver';
import { storeBangkokResults } from './ingest/bangkok';
import { completeJob, leaseJobs } from './verifier/jobs';
import { dispatchNotifications } from './notifier/dispatch';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
// The Supabase CLI's well-known local demo key — not a secret, and never sent to a non-local URL.
const SECRET_KEY = process.env.E2E_SUPABASE_SECRET_KEY ?? 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
const PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(URL_))
  throw new Error('integration tests run on the local stack only');

const db: DbClient = createClient<Database>(URL_, SECRET_KEY, { auth: { persistSession: false } });
const run = crypto.randomUUID().slice(0, 8);
const created = { clients: [] as string[], sites: [] as string[], monitors: [] as string[] };

async function must<T>(
  p: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  if (data === null || data === undefined) throw new Error('no data');
  return data;
}

let clientId: string;
async function newSite(
  name: string,
  owners: { primary_owner_id?: string; backup_owner_id?: string } = {},
): Promise<{ siteId: string; monitorId: string }> {
  const site = await must(
    db
      .from('sites')
      .insert({ client_id: clientId, name: `${name} ${run}`, tier: 1, ...owners })
      .select('id')
      .single(),
  );
  const monitor = await must(
    db
      .from('monitors')
      .insert({ site_id: site.id, type: 'http', is_primary: true, url: `https://${run}.example.test` })
      .select('id')
      .single(),
  );
  created.sites.push(site.id);
  created.monitors.push(monitor.id);
  return { siteId: site.id, monitorId: monitor.id };
}

type Outcome = 'pass' | 'fail' | 'blocked';
async function results(
  monitorId: string,
  rows: [location: 'BKK' | 'SIN' | 'TYO', Outcome, at: Date, attempt?: 1 | 2][],
) {
  const { error } = await db.from('check_results').insert(
    rows.map(([location, outcome, at, attempt = 1]) => ({
      monitor_id: monitorId,
      location,
      outcome,
      checked_at: at.toISOString(),
      attempt,
      status_code: outcome === 'fail' ? 500 : outcome === 'blocked' ? 403 : 200,
    })),
  );
  if (error) throw new Error(error.message);
}

const incidentsOf = (siteId: string) =>
  must(db.from('incidents').select('id, state, started_at, recovered_at').eq('site_id', siteId));
const notificationsOf = (incidentId: string) =>
  must(
    db
      .from('notifications')
      .select('template, status, thread_key')
      .eq('incident_id', incidentId)
      .order('created_at'),
  );
const statusOf = (siteId: string) =>
  must(db.from('site_status').select('status, ok_rounds, last_round_at').eq('site_id', siteId).maybeSingle());

// A probe tick two minutes ago (minute-aligned, like the cron): scheduled checks at M+1 / M+2 s.
const M = Math.floor(Date.now() / 60_000) * 60_000 - 120_000;
const t = (sec: number) => new Date(M + sec * 1000);
const downRound = (base = 0): ['SIN' | 'TYO', Outcome, Date, (1 | 2)?][] => [
  ['SIN', 'fail', t(base + 1)],
  ['TYO', 'fail', t(base + 2)],
  ['SIN', 'fail', t(base + 31), 2],
  ['TYO', 'fail', t(base + 32), 2],
];

/** The engine expects only locations that beat in the last 3 min (D-019). */
async function beat(location: 'BKK' | 'SIN' | 'TYO', at: Date | null) {
  const { error } = await db
    .from('probe_locations')
    .update({ last_heartbeat_at: at?.toISOString() ?? null })
    .eq('code', location);
  if (error) throw new Error(error.message);
}

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // SIN and TYO beating, Bangkok's agent not running — as on staging before S03.
  await beat('SIN', new Date());
  await beat('TYO', new Date());
  await beat('BKK', null);
  clientId = (
    await must(
      db
        .from('clients')
        .insert({ name: `Integration ${run}` })
        .select('id')
        .single(),
    )
  ).id;
  created.clients.push(clientId);
});

afterAll(async () => {
  await db.from('agent_heartbeats').delete().eq('name', 'verifier');
  const incidents = await must(db.from('incidents').select('id').in('site_id', created.sites));
  const ids = incidents.map((i) => i.id);
  await db.from('notifications').delete().in('incident_id', ids);
  await db.from('incident_events').delete().in('incident_id', ids);
  await db.from('incidents').delete().in('id', ids);
  await db.from('check_results').delete().in('monitor_id', created.monitors);
  await db.from('site_status').delete().in('site_id', created.sites);
  await db.from('monitors').delete().in('id', created.monitors);
  await db.from('sites').delete().in('id', created.sites);
  await db.from('clients').delete().in('id', created.clients);
});

describe('engine on stored results (S02a Done-when 3)', () => {
  it('both locations fail the check and the recheck → one incident, one DOWN message; a second run adds nothing', async () => {
    const { siteId, monitorId } = await newSite('Both fail');
    await results(monitorId, downRound());

    await runEngine(db, t(65));
    await runEngine(db, t(65));

    const incidents = await incidentsOf(siteId);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ state: 'unacked' });
    expect(new Date(incidents[0]!.started_at).getTime()).toBe(t(1).getTime());
    expect(await notificationsOf(incidents[0]!.id)).toEqual([
      { template: 'down', status: 'queued', thread_key: incidents[0]!.id },
    ]);
    expect(await statusOf(siteId)).toMatchObject({ status: 'down' });
  });

  it('two engine runs judging the same round at once (probe trigger + cron) open one incident, confirmed at the last recheck', async () => {
    const { siteId, monitorId } = await newSite('Concurrent');
    await results(monitorId, downRound());
    await Promise.all([runEngine(db, t(65)), runEngine(db, t(65)), runEngine(db, t(66))]);

    const incidents = await must(
      db.from('incidents').select('id, started_at, detected_at').eq('site_id', siteId),
    );
    expect(incidents).toHaveLength(1);
    // PRD §9's 30 s clock starts when the last recheck confirmed it (board: "Confirmed down 09:48:41").
    expect(new Date(incidents[0]!.detected_at).getTime()).toBe(t(32).getTime());
    expect(await notificationsOf(incidents[0]!.id)).toHaveLength(1);
  });

  it('Bangkok completes the round through Ingest: SIN + TYO confirmed, BKK passes last → DOWN in that request (S02b review)', async () => {
    const { siteId, monitorId } = await newSite('Bangkok last');
    await beat('BKK', new Date());
    try {
      await results(monitorId, downRound());
      // Bangkok is beating but hasn't reported: the round waits for it (well before its deadline).
      await runEngine(db, t(65));
      expect(await incidentsOf(siteId)).toHaveLength(0);

      await storeBangkokResults(
        db,
        [
          {
            monitorId,
            checkedAt: t(3).toISOString(),
            outcome: 'pass',
            statusCode: 200,
            responseMs: 150,
            ttfbMs: 90,
            resolvedIp: null,
            error: null,
            attempt: 1,
          },
        ],
        new Date(),
      );
      // The Ingest route runs this after its response; the engine runs at the round's time here.
      vi.spyOn(console, 'info').mockImplementation(() => {});
      await engineAfterReport(db, {} as never, Date.now() + 30_000, 'ingest', (d) => runEngine(d, t(66)));

      const incidents = await incidentsOf(siteId);
      expect(incidents).toHaveLength(1);
      expect(await notificationsOf(incidents[0]!.id)).toEqual([
        expect.objectContaining({ template: 'down', status: 'queued' }),
      ]);
      const bkk = await must(
        db
          .from('check_results')
          .select('location, attempt')
          .eq('monitor_id', monitorId)
          .eq('location', 'BKK'),
      );
      expect(bkk).toEqual([{ location: 'BKK', attempt: 1 }]);
    } finally {
      await beat('BKK', null);
    }
  });

  it('only one location fails → no incident', async () => {
    const { siteId, monitorId } = await newSite('One fails');
    await results(monitorId, [
      ['SIN', 'fail', t(1)],
      ['TYO', 'pass', t(2)],
      ['SIN', 'fail', t(31), 2],
    ]);
    await runEngine(db, t(65));
    expect(await incidentsOf(siteId)).toEqual([]);
    expect(await statusOf(siteId)).toMatchObject({ status: 'ok', ok_rounds: 0 });
  });

  it('a location that didn’t recheck doesn’t vote twice → no incident', async () => {
    const { siteId, monitorId } = await newSite('No recheck');
    await results(monitorId, [
      ['SIN', 'fail', t(1)],
      ['TYO', 'fail', t(2)], // later than SIN's first failure, but a scheduled check, not a recheck
      ['SIN', 'fail', t(31), 2],
    ]);
    await runEngine(db, t(140)); // past the round deadline
    expect(await incidentsOf(siteId)).toEqual([]);
    expect(await statusOf(siteId)).toMatchObject({ status: 'ok', ok_rounds: 0 });
  });

  it('a newer round still waiting for its rechecks doesn’t hide the complete one', async () => {
    const { siteId, monitorId } = await newSite('Overlapping rounds');
    await results(monitorId, [...downRound(), ['SIN', 'fail', t(61)], ['TYO', 'fail', t(62)]]);
    await runEngine(db, t(65));
    const incidents = await incidentsOf(siteId);
    expect(incidents).toHaveLength(1);
    expect(new Date(incidents[0]!.started_at).getTime()).toBe(t(1).getTime());
  });

  it('first OK round → Monitoring + RECOVERED in the same thread; second → Needs root cause, site OK', async () => {
    const { siteId, monitorId } = await newSite('Recovers');
    await results(monitorId, downRound());
    await runEngine(db, t(65));
    // As the engine route / probe trigger do: send the DOWN as soon as it is queued.
    const post = vi.fn(async () => ({ ok: true as const, messageName: 'spaces/S/messages/M' }));
    const deliver = (incidentId: string) =>
      dispatchNotifications(
        {
          db,
          webhookUrl: 'https://chat.example.test/webhook',
          email: undefined,
          appUrl: 'https://monitor.example.test',
          post,
        },
        { incidentId },
      );
    await deliver((await incidentsOf(siteId))[0]!.id);

    await results(monitorId, [
      ['SIN', 'pass', t(61)],
      ['TYO', 'pass', t(62)],
    ]);
    await runEngine(db, t(125));
    const [incident] = await incidentsOf(siteId);
    expect(incident).toMatchObject({ state: 'monitoring' });
    expect(new Date(incident!.recovered_at!).getTime()).toBe(t(61).getTime());
    expect((await notificationsOf(incident!.id)).map((n) => [n.template, n.thread_key])).toEqual([
      ['down', incident!.id],
      ['recovered', incident!.id],
    ]);

    await results(monitorId, [
      ['SIN', 'pass', t(121)],
      ['TYO', 'pass', t(122)],
    ]);
    await runEngine(db, t(185));
    expect((await incidentsOf(siteId))[0]).toMatchObject({ state: 'needs_root_cause' });
    expect(await statusOf(siteId)).toMatchObject({ status: 'ok', ok_rounds: 2 });

    // The notifier renders both from the stored rows and records the deliveries.
    expect((await deliver(incident!.id)).chat).toMatchObject({ sent: 1 });
    const texts = (post.mock.calls as unknown as [string, { text: string }][]).map((c) => c[1].text);
    expect(texts).toContain(`DOWN · Recovers ${run} (Tier 1)`);
    expect(texts).toContain(`RECOVERED · Recovers ${run} · down 1 min · add a root cause`);
    expect((await notificationsOf(incident!.id)).map((n) => n.status)).toEqual(['sent', 'sent']);
  });

  it('a DOWN still queued when the site recovers is dropped, so the thread never ends on old news', async () => {
    const { siteId, monitorId } = await newSite('Late down');
    await results(monitorId, downRound());
    await runEngine(db, t(65));
    await results(monitorId, [
      ['SIN', 'pass', t(61)],
      ['TYO', 'pass', t(62)],
    ]);
    await runEngine(db, t(125));
    const [incident] = await incidentsOf(siteId);
    const post = vi.fn(async () => ({ ok: true as const, messageName: 'spaces/S/messages/M' }));
    const summary = await dispatchNotifications(
      {
        db,
        webhookUrl: 'https://chat.example.test/webhook',
        email: undefined,
        appUrl: 'https://monitor.example.test',
        post,
      },
      { incidentId: incident!.id },
    );
    expect(summary.chat).toMatchObject({ superseded: 1 });
    // RECOVERED waited behind the DOWN (one thread, in order) and leaves on the next pass.
    await dispatchNotifications(
      {
        db,
        webhookUrl: 'https://chat.example.test/webhook',
        email: undefined,
        appUrl: 'https://monitor.example.test',
        post,
      },
      { incidentId: incident!.id },
    );
    expect((post.mock.calls as unknown as [string, { text: string }][]).map((c) => c[1].text)).toEqual([
      `RECOVERED · Late down ${run} · down 1 min · add a root cause`,
    ]);
    expect((await notificationsOf(incident!.id)).map((n) => [n.template, n.status])).toEqual([
      ['down', 'cancelled'],
      ['recovered', 'sent'],
    ]);
  });
});
describe('browser verifier on blocked rounds (S03 Done-when 2, 3, 4)', () => {
  const blockedRound = (): ['SIN' | 'TYO', Outcome, Date][] => [
    ['SIN', 'blocked', t(1)],
    ['TYO', 'blocked', t(2)],
  ];
  const verifierPolled = (at: Date | null) =>
    at
      ? db.from('agent_heartbeats').upsert({ name: 'verifier', last_seen_at: at.toISOString() })
      : db.from('agent_heartbeats').delete().eq('name', 'verifier');
  const noteOf = async (siteId: string) =>
    (await must(db.from('site_status').select('note').eq('site_id', siteId).single())).note;
  // Admin alerts are global: start and end each test with none open.
  const clearAlerts = async () => {
    const alerts = await must(db.from('system_alerts').select('id'));
    await db
      .from('notifications')
      .delete()
      .in(
        'system_alert_id',
        alerts.map((a) => a.id),
      );
    await db
      .from('system_alerts')
      .delete()
      .in(
        'id',
        alerts.map((a) => a.id),
      );
  };
  // Jobs of other sites in the queue would be leased too: keep each test to its own.
  const onlyJobsOf = (monitorId: string) =>
    db
      .from('verification_jobs')
      .update({ status: 'expired' })
      .eq('status', 'queued')
      .neq('monitor_id', monitorId);

  it('blocked → a verify job → the VPS leases it, uploads the screenshot, page loaded → OK with the note', async () => {
    await clearAlerts();
    const { siteId, monitorId } = await newSite('Verified');
    await results(monitorId, blockedRound());
    await verifierPolled(new Date());

    expect(await runEngine(db, t(65))).toMatchObject({ verifying: 1 });
    expect(await incidentsOf(siteId)).toHaveLength(0);
    await onlyJobsOf(monitorId);

    const [job] = await leaseJobs(db, { max: 1, sessions: 0 }, new Date());
    expect(job).toMatchObject({ kind: 'verify', url: `https://${run}.example.test` });
    // The signed upload URL works without any key (the VPS holds none).
    const put = await fetch(job!.upload!.url, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });
    expect(put.ok).toBe(true);

    expect(
      await completeJob(db, {
        jobId: job!.id,
        result: 'loaded',
        detail: null,
        httpStatus: 200,
        screenshot: true,
      }),
    ).toEqual({
      ok: true,
      kind: 'verify',
    });
    await runEngine(db, t(70));
    expect(await incidentsOf(siteId)).toHaveLength(0);
    expect(await noteOf(siteId)).toBe('Automated check blocked by bot protection; verified via browser');
    const stored = await must(
      db.from('verification_jobs').select('screenshot_path').eq('id', job!.id).single(),
    );
    const file = await db.storage.from('verifier-screenshots').download(stored.screenshot_path!);
    expect(file.error).toBeNull();
    await db.storage.from('verifier-screenshots').remove([stored.screenshot_path!]);

    // A second verdict after the first is refused, like one after the lease (Done-when 4).
    expect(
      await completeJob(db, {
        jobId: job!.id,
        result: 'failed',
        detail: null,
        httpStatus: null,
        screenshot: false,
      }),
    ).toEqual({
      ok: false,
    });
  });

  it('verifier stopped: two blocked sites → PROBLEM (unverified) at once and one email per Admin (T03)', async () => {
    await clearAlerts();
    await verifierPolled(null);
    const a = await newSite('Blocked A');
    const b = await newSite('Blocked B');
    await results(a.monitorId, blockedRound());
    await results(b.monitorId, blockedRound());

    expect(await runEngine(db, t(65))).toMatchObject({ unverified: 2, alerts: 1 });
    for (const site of [a, b]) {
      expect(await incidentsOf(site.siteId)).toEqual([expect.objectContaining({ state: 'unacked' })]);
      expect(await noteOf(site.siteId)).toBe('Blocked, not verified');
    }
    const [incident] = await must(db.from('incidents').select('trigger, severity').eq('site_id', a.siteId));
    expect(incident).toEqual({ trigger: 'blocked_unverified', severity: 'problem' });

    const alerts = await must(db.from('system_alerts').select('id, kind, context').is('cleared_at', null));
    expect(alerts).toEqual([
      expect.objectContaining({
        kind: 'verifier_unavailable',
        context: expect.objectContaining({
          reason: 'no_poll',
          sites: expect.arrayContaining([`Blocked A ${run}`, `Blocked B ${run}`]),
        }),
      }),
    ]);
    const admins = await must(db.from('profiles').select('id').eq('role', 'admin').eq('is_active', true));
    const emails = await must(
      db.from('notifications').select('user_id, template').eq('system_alert_id', alerts[0]!.id),
    );
    expect(emails).toHaveLength(admins.length);

    // The next run (same outage) adds nothing.
    expect(await runEngine(db, t(66))).toMatchObject({ alerts: 0 });
    await clearAlerts();
  });

  it('a verdict after the lease ran out is refused (Done-when 4)', async () => {
    const { monitorId } = await newSite('Lease');
    await results(monitorId, blockedRound());
    await verifierPolled(new Date());
    await runEngine(db, t(65));
    await onlyJobsOf(monitorId);
    const [job] = await leaseJobs(db, { max: 1, sessions: 0 }, new Date());
    await db
      .from('verification_jobs')
      .update({ lease_until: new Date(Date.now() - 1000).toISOString() })
      .eq('id', job!.id);
    expect(
      await completeJob(db, {
        jobId: job!.id,
        result: 'loaded',
        detail: null,
        httpStatus: 200,
        screenshot: false,
      }),
    ).toEqual({
      ok: false,
    });
    await verifierPolled(null);
  });
});

describe('delivery, ack and undo (S02b Done-when 3 and 5)', () => {
  const webhookUrl = 'https://chat.example.test/webhook';
  const appUrl = 'https://monitor.example.test';
  const email = {
    apiKey: 're_local_test',
    from: 'DxT Monitor <alerts@notify.example.test>',
  };
  const PASSWORD = 'int-local-only-Password-1';
  let arm: string;
  let ploy: string;

  // Seed people (supabase/seed.sql): Arm owns the test sites, Ploy is the backup, Tao an Admin.
  const profileId = async (address: string) =>
    (await must(db.from('profiles').select('id').eq('email', address).single())).id;
  beforeAll(async () => {
    arm = await profileId('arm@example.test');
    ploy = await profileId('ploy@example.test');
  });

  async function openDown(name: string): Promise<string> {
    const { siteId, monitorId } = await newSite(name, {
      primary_owner_id: arm,
      backup_owner_id: ploy,
    });
    await results(monitorId, downRound());
    await runEngine(db, t(65));
    return (await incidentsOf(siteId))[0]!.id;
  }
  const rowsOf = (incidentId: string) =>
    must(
      db
        .from('notifications')
        .select(
          'id, channel, template, user_id, status, attempts, created_at, hold_until, next_retry_at, context',
        )
        .eq('incident_id', incidentId)
        .order('created_at')
        .order('channel'),
    );
  // Messages of other incidents already in the queue would be claimed too: keep each test to its own.
  const onlyMine = async (incidentId: string) => {
    const { error } = await db
      .from('notifications')
      .update({ status: 'cancelled' })
      .eq('status', 'queued')
      .neq('incident_id', incidentId);
    if (error) throw new Error(error.message);
  };
  const due = async (incidentId: string, template: string) => {
    const { error } = await db
      .from('notifications')
      .update({ hold_until: new Date(Date.now() - 1000).toISOString() })
      .eq('incident_id', incidentId)
      .eq('template', template);
    if (error) throw new Error(error.message);
  };
  async function signedIn(address: string) {
    const { error } = await db.auth.admin.updateUserById(await profileId(address), { password: PASSWORD });
    if (error) throw new Error(error.message);
    const user = createClient<Database>(URL_, PUBLISHABLE_KEY, {
      auth: { persistSession: false },
    });
    const signIn = await user.auth.signInWithPassword({
      email: address,
      password: PASSWORD,
    });
    if (signIn.error) throw new Error(signIn.error.message);
    return user;
  }
  const okPost = () =>
    vi.fn(async () => ({
      ok: true as const,
      messageName: 'spaces/S/messages/M',
    }));
  const okSend = () => vi.fn(async () => ({ ok: true as const, id: 'em_local' }));
  const sentEmails = (send: ReturnType<typeof okSend>) =>
    (send.mock.calls as unknown as [{ text: string }, { to: string }][]).map(([m, o]) => ({
      to: o.to,
      text: m.text,
    }));

  it('queues DOWN for Chat and the owner; a failing Chat is retried at +30 s, +2 min, +8 min, then emailed to the backup and the Admins', async () => {
    const incidentId = await openDown('Chat fails');
    await onlyMine(incidentId);
    expect((await rowsOf(incidentId)).map((n) => [n.channel, n.template, n.user_id])).toEqual([
      ['google_chat', 'down', null],
      ['email', 'down', arm],
    ]);

    const post = vi.fn(async () => ({ ok: false as const, error: 'HTTP 500' }));
    const send = okSend();
    const chatRow = async () => (await rowsOf(incidentId)).find((n) => n.channel === 'google_chat')!;
    const retriesAt: number[] = [];
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await dispatchNotifications({
        db,
        webhookUrl,
        email,
        appUrl,
        post,
        send,
      });
      const row = await chatRow();
      expect(row.attempts).toBe(attempt);
      if (attempt < 4) {
        expect(row.status).toBe('queued');
        retriesAt.push(new Date(row.next_retry_at!).getTime() - new Date(row.created_at).getTime());
        // Skip the wait: make the retry due now.
        await db.from('notifications').update({ next_retry_at: null }).eq('id', row.id);
      } else {
        expect(row).toMatchObject({ status: 'failed', next_retry_at: null });
      }
    }
    expect(retriesAt).toEqual([30_000, 120_000, 480_000]);
    const attempts = await must(
      db
        .from('notification_attempts')
        .select('attempt, ok, error')
        .eq('notification_id', (await chatRow()).id)
        .order('attempt'),
    );
    expect(attempts).toEqual(
      [1, 2, 3, 4].map((attempt) => ({
        attempt,
        ok: false,
        error: 'HTTP 500',
      })),
    );

    // The fallback goes out on the next pass (Chat and email run side by side): the backup and
    // every Admin, marked.
    await dispatchNotifications({ db, webhookUrl, email, appUrl, post, send });
    const emails = (await rowsOf(incidentId)).filter((n) => n.channel === 'email');
    expect(emails.find((n) => n.user_id === arm)?.context).not.toHaveProperty('fallback');
    expect(emails.find((n) => n.user_id === ploy)).toMatchObject({
      status: 'sent',
      context: expect.objectContaining({ fallback: true }),
    });
    const sent = sentEmails(send);
    expect(sent.map((e) => e.to)).toEqual(
      expect.arrayContaining(['arm@example.test', 'ploy@example.test', 'tao@example.test']),
    );
    expect(sent.find((e) => e.to === 'ploy@example.test')?.text).toContain('couldn’t be delivered');
  });

  it('holds ACKNOWLEDGED for the 10 s Undo window, then posts it under the person’s name in Chat and email', async () => {
    const incidentId = await openDown('Ack');
    await onlyMine(incidentId);
    const post = okPost();
    const send = okSend();
    await dispatchNotifications({ db, webhookUrl, email, appUrl, post, send });
    post.mockClear();
    send.mockClear();

    const user = await signedIn('arm@example.test');
    expect((await user.rpc('ack_incident', { p_incident_id: incidentId })).error).toBeNull();
    const state = await must(db.from('incidents').select('state, acked_by').eq('id', incidentId).single());
    expect(state).toEqual({ state: 'acknowledged', acked_by: arm });

    await dispatchNotifications({ db, webhookUrl, email, appUrl, post, send });
    expect(post).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();

    await due(incidentId, 'acknowledged');
    await dispatchNotifications({ db, webhookUrl, email, appUrl, post, send });
    const text = (post.mock.calls[0] as unknown as [string, { text: string }])[1].text;
    expect(text).toMatch(new RegExp(`^ACKNOWLEDGED · Ack ${run} · by Arm \\d\\d:\\d\\d$`));
    expect(sentEmails(send)).toEqual([
      {
        to: 'arm@example.test',
        text: expect.stringContaining('You got this because you acknowledged this incident.'),
      },
    ]);
  });

  it('T08: Ack → Undo within 10 s → no Chat post and no email, the rows end cancelled', async () => {
    const incidentId = await openDown('Undo');
    await onlyMine(incidentId);
    const post = okPost();
    const send = okSend();
    await dispatchNotifications({ db, webhookUrl, email, appUrl, post, send });
    post.mockClear();
    send.mockClear();

    const user = await signedIn('arm@example.test');
    expect((await user.rpc('ack_incident', { p_incident_id: incidentId })).error).toBeNull();
    expect((await user.rpc('undo_ack', { p_incident_id: incidentId })).error).toBeNull();

    const acks = (await rowsOf(incidentId)).filter((n) => n.template === 'acknowledged');
    expect(acks.map((n) => [n.channel, n.status])).toEqual([
      ['google_chat', 'cancelled'],
      ['email', 'cancelled'],
    ]);
    expect((await must(db.from('incidents').select('state').eq('id', incidentId).single())).state).toBe(
      'unacked',
    );
    await due(incidentId, 'acknowledged');
    await dispatchNotifications({ db, webhookUrl, email, appUrl, post, send });
    expect(post).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
