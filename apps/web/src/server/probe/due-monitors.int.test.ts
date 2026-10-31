// @vitest-environment node
/**
 * D-051: the confirm-check due-ness read against the LOCAL Supabase stack — the PostgREST filters
 * (`or(error.eq.Timeout,confirm.is.true)`) as the real API parses them. Run with
 * `pnpm --filter @dxt/web test:int` (CI: the `db` job). Refuses any non-local URL.
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database, DbClient } from '@dxt/db';
import { loadDueMonitors } from './due-monitors';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
// The Supabase CLI's well-known local demo key — not a secret, and never sent to a non-local URL.
const SECRET_KEY = process.env.E2E_SUPABASE_SECRET_KEY ?? 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(URL_))
  throw new Error('integration tests run on the local stack only');

const db: DbClient = createClient<Database>(URL_, SECRET_KEY, { auth: { persistSession: false } });
const run = crypto.randomUUID().slice(0, 8);
let clientId = '';
let siteId = '';
let monitorId = '';

// The current Tier 2 round, and a minute inside it off its tick.
const TIER2_MS = 180_000;
const bucket = Math.floor(Date.now() / TIER2_MS) * TIER2_MS;
const at = new Date(bucket + 60_000);
const t = (sec: number) => new Date(bucket + sec * 1000).toISOString();

beforeAll(async () => {
  const client = await db
    .from('clients')
    .insert({ name: `D-051 ${run}` })
    .select('id')
    .single();
  if (client.error) throw new Error(client.error.message);
  clientId = client.data.id;
  const site = await db
    .from('sites')
    .insert({ client_id: clientId, name: `D-051 ${run}`, tier: 2 })
    .select('id')
    .single();
  if (site.error) throw new Error(site.error.message);
  siteId = site.data.id;
  const monitor = await db
    .from('monitors')
    .insert({ site_id: siteId, type: 'http', is_primary: true, url: `https://${run}.example.test/` })
    .select('id')
    .single();
  if (monitor.error) throw new Error(monitor.error.message);
  monitorId = monitor.data.id;
});

afterAll(async () => {
  await db.from('check_results').delete().eq('monitor_id', monitorId);
  await db.from('monitors').delete().eq('id', monitorId);
  await db.from('sites').delete().eq('id', siteId);
  await db.from('clients').delete().eq('id', clientId);
});

const confirmFor = async (location: 'SIN' | 'TYO' | 'BKK') =>
  (await loadDueMonitors(db, at, { location })).find((m) => m.id === monitorId)?.confirm ?? false;

describe('D-051 due-ness on the real API', () => {
  it('owes a confirm once 2 locations timed out, and only until this location confirmed', async () => {
    const insert = await db.from('check_results').insert([
      {
        monitor_id: monitorId,
        location: 'BKK',
        checked_at: t(1),
        attempt: 1,
        outcome: 'fail',
        error: 'Timeout',
      },
      {
        monitor_id: monitorId,
        location: 'SIN',
        checked_at: t(2),
        attempt: 1,
        outcome: 'pass',
        status_code: 200,
      },
    ]);
    if (insert.error) throw new Error(insert.error.message);
    expect(await confirmFor('TYO')).toBe(false);

    const second = await db.from('check_results').insert({
      monitor_id: monitorId,
      location: 'TYO',
      checked_at: t(2),
      attempt: 1,
      outcome: 'fail',
      error: 'Timeout',
    });
    if (second.error) throw new Error(second.error.message);
    expect(await confirmFor('TYO')).toBe(true);

    const mine = await db.from('check_results').insert({
      monitor_id: monitorId,
      location: 'TYO',
      checked_at: t(62),
      attempt: 1,
      outcome: 'pass',
      status_code: 200,
      confirm: true,
    });
    if (mine.error) throw new Error(mine.error.message);
    expect(await confirmFor('TYO')).toBe(false);
    expect(await confirmFor('SIN')).toBe(true);
  });
});
