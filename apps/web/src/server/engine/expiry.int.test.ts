// @vitest-environment node
/**
 * S13 (D-066, D-067): SSL expiry and a new cause, round after round, through the real engine runner, SQL
 * functions and constraints on the LOCAL Supabase stack. Each round's carries are what the previous
 * round wrote — the reviews kept finding bugs that only show on the next round (a site never judged
 * again, a window hiding a new cause for good). Run with `pnpm --filter @dxt/web test:int`.
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database, DbClient } from '@dxt/db';
import { runEngine } from './run-engine';

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

// Inside response hours: a Tuesday 10:00 Bangkok, minute-aligned (Tier 1: a round a minute).
const BASE = Date.parse('2026-11-10T03:00:00Z');
const roundAt = (k: number) => new Date(BASE + k * 60_000);
const nowFor = (k: number) => new Date(BASE + k * 60_000 + 50_000);

type Kind = 'ok' | 'keyword' | 'down';
async function round(monitorId: string, k: number, kind: Kind) {
  const at = (sec: number) => new Date(roundAt(k).getTime() + sec * 1000).toISOString();
  const row = (location: 'SIN' | 'TYO', sec: number, attempt: 1 | 2 = 1) => ({
    monitor_id: monitorId,
    location,
    checked_at: at(sec),
    attempt,
    outcome: kind === 'down' ? ('fail' as const) : ('pass' as const),
    status_code: kind === 'down' ? 500 : 200,
    keyword_missing: [],
    keyword_forbidden: kind === 'keyword' ? ['บาคาร่า'] : [],
  });
  const rows =
    kind === 'down'
      ? [row('SIN', 1), row('TYO', 2), row('SIN', 31, 2), row('TYO', 32, 2)]
      : [row('SIN', 1), row('TYO', 2)];
  const { error } = await db.from('check_results').insert(rows);
  if (error) throw new Error(error.message);
}

/** The engine expects only locations that beat in the last 3 min (D-019), by the run's own clock. */
async function beat(at: Date | null, codes: ('BKK' | 'SIN' | 'TYO')[]) {
  const { error } = await db
    .from('probe_locations')
    .update({ last_heartbeat_at: at?.toISOString() ?? null })
    .in('code', codes);
  if (error) throw new Error(error.message);
}

async function judge(k: number) {
  await beat(nowFor(k), ['SIN', 'TYO']);
  return runEngine(db, nowFor(k));
}

async function newSite(name: string) {
  const site = await must(
    db
      .from('sites')
      .insert({ client_id: created.clients[0]!, name: `${name} ${run}`, tier: 1 })
      .select('id')
      .single(),
  );
  const host = `${name.toLowerCase()}-${run}.example.test`;
  const monitor = await must(
    db
      .from('monitors')
      // The site's own word: it alerts whatever DEFACEMENT_ALERTS says (D-042).
      .insert({
        site_id: site.id,
        type: 'http',
        is_primary: true,
        url: `https://${host}/`,
        must_not_contain: ['บาคาร่า'],
      })
      .select('id')
      .single(),
  );
  created.sites.push(site.id);
  created.monitors.push(monitor.id);
  // The certificate 13 days out, read at 06:00 (D-066).
  const read = new Date(BASE - 4 * 3_600_000).toISOString();
  const { error } = await db.from('site_expiry').insert({
    site_id: site.id,
    host,
    domain: `${run}.example.test`,
    ssl_expires_at: new Date(BASE + 13 * 86_400_000).toISOString(),
    ssl_valid_from: new Date(BASE - 77 * 86_400_000).toISOString(),
    ssl_issuer: 'Test CA',
    ssl_read_at: read,
    ssl_checked_at: read,
  });
  if (error) throw new Error(error.message);
  return { siteId: site.id, monitorId: monitor.id };
}

const incidentOf = (siteId: string) =>
  must(
    db
      .from('incidents')
      .select('id, state, severity, episode_severity, trigger, expiry_left, is_flapping')
      .eq('site_id', siteId)
      .single(),
  );
const eventsOf = async (incidentId: string) =>
  (
    await must(
      db
        .from('incident_events')
        .select('type, payload')
        .eq('incident_id', incidentId)
        .order('at')
        .order('id'),
    )
  ).map((e) => `${e.type}${(e.payload as { back?: boolean }).back ? ':back' : ''}`);
const chatOf = async (incidentId: string) =>
  (
    await must(
      db
        .from('notifications')
        .select('template, context, status')
        .eq('incident_id', incidentId)
        .eq('channel', 'google_chat')
        .order('created_at'),
    )
  ).map((n) => `${n.template}${(n.context as { newCause?: boolean }).newCause ? ':new_cause' : ''}`);
const lastRound = async (siteId: string) =>
  (await must(db.from('site_status').select('last_round_at').eq('site_id', siteId).single())).last_round_at;

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await beat(null, ['BKK']);
  created.clients.push(
    (
      await must(
        db
          .from('clients')
          .insert({ name: `S13 ${run}` })
          .select('id')
          .single(),
      )
    ).id,
  );
});

afterAll(async () => {
  await beat(new Date(), ['SIN', 'TYO']);
  if (created.sites.length) {
    const incidents = await must(db.from('incidents').select('id').in('site_id', created.sites));
    const ids = incidents.map((i) => i.id);
    if (ids.length) {
      await db.from('notifications').delete().in('incident_id', ids);
      await db.from('incident_events').delete().in('incident_id', ids);
      await db.from('incidents').delete().in('id', ids);
    }
    await db.from('maintenance_windows').delete().in('site_id', created.sites);
    await db.from('check_results').delete().in('monitor_id', created.monitors);
    await db.from('sites').update({ is_active: false }).in('id', created.sites);
  }
});

describe('S13 · an SSL incident takes a new cause and goes back, round after round (D-067)', () => {
  it('SSL → keyword (told) → still judged → back to SSL (silent) → keyword again', async () => {
    const { siteId, monitorId } = await newSite('Ssl');
    await round(monitorId, 0, 'ok');
    await judge(0);
    let inc = await incidentOf(siteId);
    expect(inc).toMatchObject({ severity: 'problem', trigger: 'ssl', expiry_left: false });

    await round(monitorId, 1, 'keyword');
    await judge(1);
    inc = await incidentOf(siteId);
    expect(inc).toMatchObject({ trigger: 'keyword', expiry_left: true, state: 'unacked' });
    expect(await chatOf(inc.id)).toEqual(['problem', 'problem_again:new_cause']);

    // The next round is still judged (engine re-review H1).
    await round(monitorId, 2, 'keyword');
    await judge(2);
    expect(Date.parse((await lastRound(siteId))!)).toBe(roundAt(2).getTime());

    // The notifier sent the reply (an unsent one is cancelled by going back — tested in pgTAP).
    await db
      .from('notifications')
      .update({ status: 'sent', sent_at: roundAt(2).toISOString() })
      .eq('incident_id', inc.id);

    await round(monitorId, 3, 'ok');
    await judge(3);
    inc = await incidentOf(siteId);
    expect(inc).toMatchObject({ trigger: 'ssl', expiry_left: false, state: 'unacked' });
    expect(await eventsOf(inc.id)).toEqual(['detected', 'new_cause', 'new_cause:back']);

    await round(monitorId, 4, 'keyword');
    await judge(4);
    inc = await incidentOf(siteId);
    expect(inc).toMatchObject({ trigger: 'keyword', expiry_left: true });
    // The same words within 30 min: one reply.
    expect(await chatOf(inc.id)).toEqual(['problem', 'problem_again:new_cause']);
  });

  it('a DOWN back up on SSL: a keyword a window hid is told on the first round after it, then back to SSL with no RECOVERED', async () => {
    const { siteId, monitorId } = await newSite('Down');
    await round(monitorId, 0, 'down');
    await judge(0);
    await round(monitorId, 1, 'ok');
    await judge(1);
    await round(monitorId, 2, 'ok');
    await judge(2);
    let inc = await incidentOf(siteId);
    // Recovered at round 1 (a clean RECOVERED), SSL joined as PROBLEM AGAIN at round 2.
    // Opened, recovered, SSL joined: 3 changes by the rule, not a flapping site (engine re-review).
    expect(inc).toMatchObject({
      severity: 'down',
      episode_severity: 'problem',
      state: 'unacked',
      is_flapping: false,
    });

    // Maintenance over rounds 3–4.
    const { error } = await db.from('maintenance_windows').insert({
      site_id: siteId,
      kind: 'maintenance',
      starts_at: roundAt(3).toISOString(),
      ends_at: roundAt(5).toISOString(),
      reason: 'Deploy',
      approved_at: roundAt(0).toISOString(),
      start_logged: true,
    });
    if (error) throw new Error(error.message);
    await round(monitorId, 3, 'keyword');
    await judge(3);
    await round(monitorId, 4, 'keyword');
    await judge(4);
    expect(await chatOf(inc.id)).not.toContain('problem_again:new_cause');

    await round(monitorId, 5, 'keyword');
    await judge(5);
    expect(await chatOf(inc.id)).toContain('problem_again:new_cause');

    await round(monitorId, 6, 'ok');
    await judge(6);
    inc = await incidentOf(siteId);
    expect(inc).toMatchObject({ severity: 'down', episode_severity: 'problem', state: 'unacked' });
    expect((await eventsOf(inc.id)).at(-1)).toBe('new_cause:back');
    expect((await chatOf(inc.id)).filter((t) => t === 'recovered')).toHaveLength(1);
  });
});
