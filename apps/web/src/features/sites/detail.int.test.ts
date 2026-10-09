// @vitest-environment node
/**
 * S06 Done-when 2: Site detail's uptime, read from stored incidents and their timelines on the LOCAL
 * Supabase stack, equals `siteUptime` — the MuvMi 30-day sample (spec §5): 101 DOWN minutes → 99.77%.
 * Run with `pnpm --filter @dxt/web test:int` (CI: the `db` job). Refuses any non-local URL.
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { siteUptime } from '@dxt/engine';
import type { Database, DbClient } from '@dxt/db';
import { formatPercent } from '@dxt/shared';
import { loadSiteDetail } from './detail-queries';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
// The Supabase CLI's well-known local demo key — not a secret, and never sent to a non-local URL.
const SECRET_KEY = process.env.E2E_SUPABASE_SECRET_KEY ?? 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(URL_))
  throw new Error('integration tests run on the local stack only');

const db: DbClient = createClient<Database>(URL_, SECRET_KEY, { auth: { persistSession: false } });
const run = crypto.randomUUID().slice(0, 8);
const NOW = new Date();
const minAgo = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const DAY = 1440;

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

/** A DOWN incident: first failed check `startMin` ago, confirmed 30 s later, recovered after `minutes`. */
async function downIncident(startMin: number, minutes: number | null) {
  const inc = await must(
    db
      .from('incidents')
      .insert({
        site_id: siteId,
        monitor_id: monitorId,
        trigger: 'hard_fail',
        severity: 'down',
        episode_severity: 'down',
        state: minutes === null ? 'unacked' : 'resolved',
        started_at: minAgo(startMin),
        detected_at: minAgo(startMin - 0.5),
        recovered_at: minutes === null ? null : minAgo(startMin - minutes),
        resolved_at: minutes === null ? null : minAgo(startMin - minutes - 10),
      })
      .select('id')
      .single(),
  );
  const events = [{ incident_id: inc.id, type: 'detected', at: minAgo(startMin - 0.5), payload: {} }];
  if (minutes !== null)
    events.push({ incident_id: inc.id, type: 'recovered', at: minAgo(startMin - minutes), payload: {} });
  await must(db.from('incident_events').insert(events).select('id'));
}

beforeAll(async () => {
  clientId = (
    await must(
      db
        .from('clients')
        .insert({ name: `Uptime client ${run}` })
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
          name: `MuvMi ${run}`,
          tier: 1,
          monitoring_started_at: minAgo(60 * DAY),
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
  // INC-0120 47 min, INC-0126 35 min, INC-0142 19 min so far; an older 26 min drop outside 30 days
  await downIncident(17 * DAY, 47);
  await downIncident(14 * DAY, 35);
  await downIncident(40 * DAY, 26);
  await downIncident(19, null);
});

afterAll(async () => {
  const ids = (await must(db.from('incidents').select('id').eq('site_id', siteId))).map((i) => i.id);
  await db.from('incident_events').delete().in('incident_id', ids);
  await db.from('incidents').delete().eq('site_id', siteId);
  await db.from('monitors').delete().eq('id', monitorId);
  await db.from('sites').delete().eq('id', siteId);
  await db.from('clients').delete().eq('id', clientId);
});

describe('Site detail uptime (S06 Done-when 2, spec §5)', () => {
  it('MuvMi 30 d = 99.77% = siteUptime over the same 101 DOWN minutes', async () => {
    const detail = await loadSiteDetail(db, siteId, '30d', NOW);
    const expected = siteUptime({ windowMinutes: 30 * DAY, downMinutes: 101, maintenanceMinutes: 0 });
    expect(detail?.stats.uptime).toBeCloseTo(expected, 6);
    expect(formatPercent(detail!.stats.uptime!)).toBe('99.77%');
    expect(detail?.stats.incidents).toBe(3);
    expect(detail?.openIncident?.state).toBe('unacked');
  });

  it('24 h counts only the drop in progress', async () => {
    const detail = await loadSiteDetail(db, siteId, '24h', NOW);
    expect(detail?.stats.uptime).toBeCloseTo(1 - 19 / DAY, 6);
  });

  it('90 d history lists every incident, newest first, with its length', async () => {
    const detail = await loadSiteDetail(db, siteId, '90d', NOW);
    expect(detail?.history.map((h) => h.minutes)).toEqual([null, 35, 47, 26]);
    expect(detail?.historyMttr).toBe(35);
  });

  it('an unknown site is null', async () => {
    expect(await loadSiteDetail(db, crypto.randomUUID(), '24h', NOW)).toBeNull();
  });
});
