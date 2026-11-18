import 'server-only';
import type { DbClient } from '@dxt/db';
import { getAccess } from '@/lib/auth/session';
import { serviceDb } from '@/server/db';
import { runExpiry, type ExpiryDeps } from '@/server/expiry/run-expiry';

/** A second press inside this long is refused: the guard holds across tabs and people (it reads the table). */
export const CHECK_NOW_GUARD_MS = 60_000;

export interface CheckNowDeps {
  access?: typeof getAccess;
  db?: () => DbClient;
  run?: (deps: ExpiryDeps) => ReturnType<typeof runExpiry>;
  clock?: () => number;
}

/** The newest `*_checked_at` of any site, or null before the first read. */
async function lastCheckedAt(db: DbClient): Promise<number | null> {
  const newest = (col: 'ssl_checked_at' | 'domain_checked_at') =>
    db.from('site_expiry').select(col).not(col, 'is', null).order(col, { ascending: false }).limit(1);
  const [ssl, domain] = await Promise.all([newest('ssl_checked_at'), newest('domain_checked_at')]);
  if (ssl.error) throw new Error(`site_expiry: ${ssl.error.message}`);
  if (domain.error) throw new Error(`site_expiry: ${domain.error.message}`);
  const times = [
    (ssl.data?.[0] as { ssl_checked_at?: string } | undefined)?.ssl_checked_at,
    (domain.data?.[0] as { domain_checked_at?: string } | undefined)?.domain_checked_at,
  ]
    .filter((v): v is string => !!v)
    .map((v) => Date.parse(v));
  return times.length ? Math.max(...times) : null;
}

/**
 * `POST /api/expiry/check` — "Check now" on the Expiry page (D-066 item 4): the hourly read for every
 * live site, from sin1 like the cron (pinned in vercel.json). An active Admin or Responder only; no
 * input but the session. It writes only `site_expiry` (monitoring data, no audit row); the engine
 * judges the new dates on its next round.
 */
export function checkNowHandler(deps: CheckNowDeps = {}) {
  const { access = getAccess, db = serviceDb, run = runExpiry, clock = Date.now } = deps;
  return async function POST(): Promise<Response> {
    const who = await access();
    if (who.status !== 'active') return Response.json({ error: 'Sign in first' }, { status: 401 });
    if (who.profile.role !== 'admin' && who.profile.role !== 'responder') {
      return Response.json({ error: 'Only an Admin or a Responder can check now' }, { status: 403 });
    }
    const client = db();
    const last = await lastCheckedAt(client);
    if (last !== null && clock() - last < CHECK_NOW_GUARD_MS) {
      return Response.json({ error: 'Checked less than a minute ago — try again shortly' }, { status: 429 });
    }
    const result = await run({
      db: client,
      vercel: process.env.VERCEL ? { region: process.env.VERCEL_REGION } : null,
      all: true,
    });
    if (result.skipped === 'wrong_region') {
      return Response.json({ error: 'The check runs only from Singapore' }, { status: 503 });
    }
    const failed = Array.isArray(result.failed) ? (result.failed as string[]) : [];
    return Response.json(
      { ok: result.ok, read: result.read, failed },
      { status: result.ok ? 200 : 500, headers: { 'cache-control': 'no-store' } },
    );
  };
}
