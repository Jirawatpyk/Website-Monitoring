// @vitest-environment node
/**
 * S02a Done-when 3: the engine driven by stored check results on the LOCAL Supabase stack
 * (`pnpm db:start`), through the real tables, SQL functions and constraints. Run with
 * `pnpm --filter @dxt/web test:int` (CI: the `db` job). Refuses any non-local URL.
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database, DbClient } from '@dxt/db';
import { runEngine } from './engine/run-engine';
import { dispatchNotifications } from './notifier/dispatch';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
// The Supabase CLI's well-known local demo key — not a secret, and never sent to a non-local URL.
const SECRET_KEY = process.env.E2E_SUPABASE_SECRET_KEY ?? 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
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
async function newSite(name: string): Promise<{ siteId: string; monitorId: string }> {
  const site = await must(
    db
      .from('sites')
      .insert({ client_id: clientId, name: `${name} ${run}`, tier: 1 })
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

type Outcome = 'pass' | 'fail';
async function results(
  monitorId: string,
  rows: [location: 'SIN' | 'TYO', Outcome, at: Date, attempt?: 1 | 2][],
) {
  await must(
    db.from('check_results').insert(
      rows.map(([location, outcome, at, attempt = 1]) => ({
        monitor_id: monitorId,
        location,
        outcome,
        checked_at: at.toISOString(),
        attempt,
        status_code: outcome === 'fail' ? 500 : 200,
      })),
    ),
  );
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

const now0 = new Date();
const ago = (sec: number, from = now0) => new Date(from.getTime() - sec * 1000);

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
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
    await results(monitorId, [
      ['SIN', 'fail', ago(65)],
      ['TYO', 'fail', ago(64)],
      ['SIN', 'fail', ago(34), 2],
      ['TYO', 'fail', ago(33), 2],
    ]);

    await runEngine(db, now0);
    await runEngine(db, now0);

    const incidents = await incidentsOf(siteId);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ state: 'unacked' });
    expect(new Date(incidents[0]!.started_at).getTime()).toBe(ago(65).getTime());
    expect(await notificationsOf(incidents[0]!.id)).toEqual([
      { template: 'down', status: 'queued', thread_key: incidents[0]!.id },
    ]);
    expect(await statusOf(siteId)).toMatchObject({ status: 'down' });
  });

  it('only one location fails → no incident', async () => {
    const { siteId, monitorId } = await newSite('One fails');
    await results(monitorId, [
      ['SIN', 'fail', ago(65)],
      ['TYO', 'pass', ago(64)],
      ['SIN', 'fail', ago(34), 2],
    ]);
    await runEngine(db, now0);
    expect(await incidentsOf(siteId)).toEqual([]);
    expect(await statusOf(siteId)).toMatchObject({ status: 'ok', ok_rounds: 1 });
  });

  it('a location that didn’t recheck doesn’t vote twice → no incident', async () => {
    const { siteId, monitorId } = await newSite('No recheck');
    await results(monitorId, [
      ['SIN', 'fail', ago(75)],
      ['TYO', 'fail', ago(74)], // later than SIN's first failure, but a scheduled check, not a recheck
      ['SIN', 'fail', ago(44), 2],
    ]);
    await runEngine(db, now0);
    expect(await incidentsOf(siteId)).toEqual([]);
    expect(await statusOf(siteId)).toMatchObject({ status: 'ok', ok_rounds: 0 });
  });

  it('first OK round → Monitoring + RECOVERED in the same thread; second → Needs root cause, site OK', async () => {
    const { siteId, monitorId } = await newSite('Recovers');
    await results(monitorId, [
      ['SIN', 'fail', ago(65)],
      ['TYO', 'fail', ago(64)],
      ['SIN', 'fail', ago(34), 2],
      ['TYO', 'fail', ago(33), 2],
    ]);
    await runEngine(db, now0);

    const now1 = new Date(now0.getTime() + 60_000);
    await results(monitorId, [
      ['SIN', 'pass', ago(5, now1)],
      ['TYO', 'pass', ago(4, now1)],
    ]);
    await runEngine(db, now1);
    const [incident] = await incidentsOf(siteId);
    expect(incident).toMatchObject({ state: 'monitoring' });
    expect(new Date(incident!.recovered_at!).getTime()).toBe(ago(4, now1).getTime());
    expect((await notificationsOf(incident!.id)).map((n) => [n.template, n.thread_key])).toEqual([
      ['down', incident!.id],
      ['recovered', incident!.id],
    ]);

    const now2 = new Date(now1.getTime() + 60_000);
    await results(monitorId, [
      ['SIN', 'pass', ago(5, now2)],
      ['TYO', 'pass', ago(4, now2)],
    ]);
    await runEngine(db, now2);
    expect((await incidentsOf(siteId))[0]).toMatchObject({ state: 'needs_root_cause' });
    expect(await statusOf(siteId)).toMatchObject({ status: 'ok', ok_rounds: 2 });

    // The notifier renders both from the stored rows and records the deliveries.
    const post = vi.fn(async () => ({ ok: true as const, messageName: 'spaces/S/messages/M' }));
    const summary = await dispatchNotifications({
      db,
      webhookUrl: 'https://chat.example.test/webhook',
      appUrl: 'https://monitor.example.test',
      post,
    });
    expect(summary.sent).toBeGreaterThanOrEqual(2);
    const texts = (post.mock.calls as unknown as [string, { text: string }][]).map((c) => c[1].text);
    expect(texts).toContain(`DOWN · Recovers ${run} (Tier 1)`);
    expect(texts).toContain(`RECOVERED · Recovers ${run} · down 2 min · add a root cause`);
    expect((await notificationsOf(incident!.id)).map((n) => n.status)).toEqual(['sent', 'sent']);
  });
});
