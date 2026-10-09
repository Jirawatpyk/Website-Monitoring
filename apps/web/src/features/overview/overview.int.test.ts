// @vitest-environment node
/**
 * S06b: the Overview's loader on the LOCAL Supabase stack — what `/` reads, and how long it takes
 * (Done-when 1: < 2 s with 17 sites and 90 days of generated checks, `supabase/dev/generate-checks.sql`).
 * The test adds its own live site with an open DOWN incident and checks the banner, row and counts.
 * Run with `pnpm --filter @dxt/web test:int` (CI: the `db` job). Refuses any non-local URL.
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database, DbClient } from '@dxt/db';
import { loadOverview } from './queries';
import { bannersOf, countsOf, liveIssues, nextStep } from './model';
import { SERIES_POINTS } from './assemble';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
// The Supabase CLI's well-known local demo key — not a secret, and never sent to a non-local URL.
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
let admin = { id: '', name: '' };
/** The page reads as the signed-in person (RLS), so the loader runs as the seeded Admin. */
let asAdmin: DbClient = db;

beforeAll(async () => {
  const profile = await must(
    db.from('profiles').select('id, display_name').eq('email', ADMIN_EMAIL).eq('is_active', true).single(),
  );
  admin = { id: profile.id, name: profile.display_name };
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
        .insert({ name: `Overview client ${run}` })
        .select('id')
        .single(),
    )
  ).id;
  siteId = (
    await must(
      db
        .from('sites')
        .insert({
          client_id: clientId,
          name: `AAA Overview ${run}`,
          tier: 1,
          monitoring_started_at: minAgo(3 * 1440),
        })
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
  // live after its monitor exists (a live site must be complete only for signed-in writes, D-025)
  await must(db.from('sites').update({ is_active: true }).eq('id', siteId).select('id'));
  await must(
    db
      .from('site_status')
      .insert({ site_id: siteId, status: 'down', since: minAgo(19), last_round_at: minAgo(1) })
      .select('site_id'),
  );
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
          state: 'unacked',
          started_at: minAgo(19),
          detected_at: minAgo(18),
        })
        .select('id')
        .single(),
    )
  ).id;
  await must(
    db
      .from('incident_events')
      .insert({
        incident_id: incidentId,
        type: 'detected',
        at: minAgo(18),
        payload: { cause: 'Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)', confirmingLocations: 3 },
      })
      .select('id'),
  );
});

afterAll(async () => {
  // the seed Admin signs in with Google only: don't leave it a password known from this file
  await db.auth.admin.updateUserById(admin.id, { password: crypto.randomUUID() });
  await db.from('incident_events').delete().eq('incident_id', incidentId);
  await db.from('incidents').delete().eq('site_id', siteId);
  await db.from('site_status').delete().eq('site_id', siteId);
  await db.from('sites').update({ is_active: false }).eq('id', siteId);
  await db.from('monitors').delete().eq('id', monitorId);
  await db.from('sites').delete().eq('id', siteId);
  await db.from('clients').delete().eq('id', clientId);
});

describe('loadOverview (S06b, spec §21)', () => {
  it('reads every live site with a 96-point line, and our DOWN as a banner and the first Live issue', async () => {
    const started = performance.now();
    const data = await loadOverview(asAdmin, { ...admin, role: 'admin' }, NOW);
    const ms = Math.round(performance.now() - started);
    console.info(`loadOverview: ${ms} ms for ${data.sites.length} live sites`);
    // Done-when 1's budget is the whole page (< 2 s); the loader is most of it
    expect(ms).toBeLessThan(2000);

    expect(data.viewer.kind).toBe('admin');
    expect(data.sites.every((s) => s.series.length === SERIES_POINTS)).toBe(true);
    const ours = data.sites.find((s) => s.id === siteId);
    expect(ours?.incident).toMatchObject({ number: expect.any(Number), cause: 'Timeout ×2 · 504 ×1' });
    expect(ours?.p50Ms).toBeNull(); // "—" while down

    const now = new Date(data.nowIso);
    const banners = bannersOf(data.sites, now, 99);
    expect(banners.shown.map((b) => b.site.id)).toContain(siteId);
    const first = liveIssues(data.sites, now).find((i) => i.site.id === siteId);
    expect(first?.reason.kind).toBe('down');
    expect(nextStep(data.viewer, first!).kind).toBe('ack');
    expect(countsOf(data.sites).unacked).toBeGreaterThanOrEqual(1);
    expect(data.kpis.uptime30d).toBeGreaterThan(0);
  });
});
