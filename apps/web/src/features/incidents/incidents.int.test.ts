// @vitest-environment node
/**
 * S07 on the LOCAL Supabase stack: the incident page and list loaders, and the note / resolve / undo
 * functions as a signed-in Admin (RLS and `auth.uid()` as the page has them) — Done-when 1 and 3:
 * the gate refuses Unknown, a note is an event plus a NOTE row sent at once, RESOLVED is held 10 s for
 * everyone emailed, Undo cancels it. Run with `pnpm --filter @dxt/web test:int` (CI: the `db` job).
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database, DbClient } from '@dxt/db';
import { loadIncident, loadIncidentList } from './detail-queries';
import { DEFAULT_FILTERS, filterIncidents } from './model';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
// The Supabase CLI's well-known local demo keys — not secrets, and never sent to a non-local URL.
const SECRET_KEY = process.env.E2E_SUPABASE_SECRET_KEY ?? 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
const PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const PASSWORD = 'int-local-only-Password-1';
const ADMIN_EMAIL = 'tao@example.test'; // the local seed's Admin (supabase/seed.sql)
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(URL_))
  throw new Error('integration tests run on the local stack only');

const db: DbClient = createClient<Database>(URL_, SECRET_KEY, { auth: { persistSession: false } });
const run = crypto.randomUUID().slice(0, 8);
const NOW = new Date();
const minAgo = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

async function must<T>(
  p: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  if (data === null || data === undefined) throw new Error('no data');
  return data;
}

let clientId = '';
let siteId = '';
let monitorId = '';
let incidentId = '';
let admin = { id: '', displayName: '', email: ADMIN_EMAIL };
let asAdmin: DbClient = db;
const viewer = () => ({ ...admin, role: 'admin' as const });
const noSign = async () => null;

beforeAll(async () => {
  const profile = await must(
    db.from('profiles').select('id, display_name').eq('email', ADMIN_EMAIL).eq('is_active', true).single(),
  );
  admin = { id: profile.id, displayName: profile.display_name, email: ADMIN_EMAIL };
  const { error: pwError } = await db.auth.admin.updateUserById(profile.id, { password: PASSWORD });
  if (pwError) throw new Error(pwError.message);
  asAdmin = createClient<Database>(URL_, PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error: signInError } = await asAdmin.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: PASSWORD,
  });
  if (signInError) throw new Error(signInError.message);

  clientId = (
    await must(
      db
        .from('clients')
        .insert({ name: `Incidents client ${run}` })
        .select('id')
        .single(),
    )
  ).id;
  siteId = (
    await must(
      db
        .from('sites')
        .insert({ client_id: clientId, name: `AAA Incidents ${run}`, tier: 2, primary_owner_id: profile.id })
        .select('id')
        .single(),
    )
  ).id;
  monitorId = (
    await must(
      db
        .from('monitors')
        .insert({ site_id: siteId, type: 'http', is_primary: true, url: `https://${run}.example.test/` })
        .select('id')
        .single(),
    )
  ).id;
  // ORCA-like: DOWN at 30 min ago, recovered 22 min ago, settled → Needs root cause.
  incidentId = (
    await must(
      db
        .from('incidents')
        .insert({
          site_id: siteId,
          monitor_id: monitorId,
          trigger: 'hard_fail',
          severity: 'down',
          episode_severity: 'down',
          state: 'needs_root_cause',
          started_at: minAgo(30),
          detected_at: minAgo(29.5),
          recovered_at: minAgo(22),
        })
        .select('id')
        .single(),
    )
  ).id;
  await must(
    db
      .from('incident_events')
      .insert([
        {
          incident_id: incidentId,
          type: 'detected',
          at: minAgo(29.5),
          payload: { cause: 'HTTP 502 (SIN, TYO)', confirmingLocations: 2 },
        },
        { incident_id: incidentId, type: 'recovered', at: minAgo(22), payload: { okLocations: 3 } },
        {
          incident_id: incidentId,
          type: 'ok_two_rounds',
          at: minAgo(21),
          payload: { state: 'needs_root_cause' },
        },
      ])
      .select('id'),
  );
  // The thread exists (a Chat DOWN went out) and the owner got the DOWN email.
  await must(
    db
      .from('notifications')
      .insert([
        {
          incident_id: incidentId,
          channel: 'google_chat',
          template: 'down',
          thread_key: incidentId,
          status: 'sent',
        },
        {
          incident_id: incidentId,
          channel: 'email',
          template: 'down',
          user_id: profile.id,
          thread_key: incidentId,
          status: 'sent',
        },
      ])
      .select('id'),
  );
  // A short PROBLEM that resolved on its own: hidden from the list, counted.
  await must(
    db
      .from('incidents')
      .insert({
        site_id: siteId,
        monitor_id: monitorId,
        trigger: 'slow',
        severity: 'problem',
        episode_severity: 'problem',
        state: 'resolved',
        auto_resolved: true,
        started_at: minAgo(120),
        detected_at: minAgo(120),
        recovered_at: minAgo(117),
        resolved_at: minAgo(117),
      })
      .select('id'),
  );
});

afterAll(async () => {
  // the seed Admin signs in with Google only: don't leave it a password known from this file
  await db.auth.admin.updateUserById(admin.id, { password: crypto.randomUUID() });
  const ids = (await must(db.from('incidents').select('id').eq('site_id', siteId))).map((i) => i.id);
  await db.from('notifications').delete().in('incident_id', ids);
  await db.from('incident_events').delete().in('incident_id', ids);
  await db.from('incidents').delete().eq('site_id', siteId);
  await db.from('monitors').delete().eq('id', monitorId);
  await db.from('sites').delete().eq('id', siteId);
  await db.from('clients').delete().eq('id', clientId);
});

describe('incident page and actions (S07, D-033)', () => {
  it('loads the page: gate 2 of 3 met (no root cause yet), Resolve opens, timeline in words', async () => {
    const d = (await loadIncident(asAdmin, viewer(), incidentId, NOW, noSign))!;
    expect(d.canAct).toBe(true);
    expect(d.gate).toMatchObject({ metCount: 2, ok: false, canOpenDialog: true });
    expect(d.timeline.map((t) => t.title)).toEqual([
      'First failed check',
      expect.stringMatching(/^Confirmed down /),
      'Recovered → Monitoring',
      'OK for 2 rounds → Needs root cause',
    ]);
  });

  it('a note: on the timeline, and a NOTE reply queued with no hold and no email', async () => {
    const { error } = await asAdmin.rpc('add_incident_note', {
      p_incident_id: incidentId,
      p_text: 'Host restarted it',
    });
    expect(error).toBeNull();
    const d = (await loadIncident(asAdmin, viewer(), incidentId, NOW, noSign))!;
    expect(d.timeline.at(-1)).toMatchObject({
      title: `Note by ${admin.displayName}`,
      detail: 'Host restarted it',
    });
    const notes = await must(
      db
        .from('notifications')
        .select('channel, hold_until, status')
        .eq('incident_id', incidentId)
        .eq('template', 'note'),
    );
    expect(notes).toEqual([{ channel: 'google_chat', hold_until: null, status: 'queued' }]);
  });

  it('T10: Unknown doesn’t resolve; a real category does, held 10 s; Undo cancels it', async () => {
    const unknown = await asAdmin.rpc('resolve_incident', {
      p_incident_id: incidentId,
      p_category: 'unknown',
      p_what: 'Still looking',
      p_fix: '',
    });
    expect(unknown.error?.message).toMatch(/^Unknown keeps the incident open/);

    const ok = await asAdmin.rpc('resolve_incident', {
      p_incident_id: incidentId,
      p_category: 'hosting',
      p_what: 'Host rebooted the app server',
      p_fix: '',
    });
    expect(ok.error).toBeNull();
    const held = await must(
      db
        .from('notifications')
        .select('channel, user_id, hold_until, status')
        .eq('incident_id', incidentId)
        .eq('template', 'resolved'),
    );
    expect(held.map((n) => [n.channel, n.user_id, n.status]).sort()).toEqual([
      ['email', admin.id, 'queued'],
      ['google_chat', null, 'queued'],
    ]);
    expect(held.every((n) => n.hold_until === ok.data)).toBe(true);

    const d = (await loadIncident(asAdmin, viewer(), incidentId, new Date(), noSign))!;
    expect(d.state).toBe('resolved');
    expect(d.resolved).toMatchObject({ byViewer: true, posted: null });
    expect(d.timeline.at(-1)!.title).toMatch(/^Resolved by .* \(posts .* unless undone\)$/);

    expect((await asAdmin.rpc('undo_resolve', { p_incident_id: incidentId })).error).toBeNull();
    const after = (await loadIncident(asAdmin, viewer(), incidentId, new Date(), noSign))!;
    expect(after.state).toBe('needs_root_cause');
    expect(after.rootCause.category).toBe('hosting');
    expect(after.gate.ok).toBe(true);
    const cancelled = await must(
      db.from('notifications').select('status').eq('incident_id', incidentId).eq('template', 'resolved'),
    );
    expect(cancelled.every((n) => n.status === 'cancelled')).toBe(true);
  });

  it('the list: the incident in Needs action, the auto-resolved one hidden and counted', async () => {
    const list = await loadIncidentList(asAdmin, NOW);
    const mine = list.incidents.filter((i) => i.siteId === siteId);
    expect(mine).toHaveLength(2);
    const needs = filterIncidents(mine, DEFAULT_FILTERS, NOW);
    expect(needs.rows.map((r) => r.id)).toEqual([incidentId]);
    const all = filterIncidents(mine, { ...DEFAULT_FILTERS, view: 'all' }, NOW);
    expect(all.hiddenAutoResolved).toBe(1);
    expect(list.sites.some((s) => s.id === siteId)).toBe(true);
  });

  it('an unknown incident is null', async () => {
    expect(await loadIncident(asAdmin, viewer(), crypto.randomUUID(), NOW, noSign)).toBeNull();
  });
});
