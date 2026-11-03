import { after } from 'next/server';
import { ingestBatchSchema } from '@dxt/shared';
import { serverEnv } from '@/lib/env';
import { hasBearer, unauthorized } from '@/lib/auth/bearer';
import { serviceDb } from '@/server/db';
import { engineAfterReport } from '@/server/engine/engine-and-deliver';
import { dueForBangkok, storeBangkokResults } from '@/server/ingest/bangkok';
import { loadWatchFacts, stampBeat } from '@/server/heartbeats';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Results older or further in the future than this are refused (replay / clock skew). */
const MAX_SKEW_MS = 5 * 60_000;
/** The engine and the first sends after a batch must finish inside maxDuration. */
const ENGINE_BUDGET_MS = 50_000;

/**
 * Ingest API for the Bangkok probe on the VPS, bearer INGEST_TOKEN; the VPS never holds a database
 * key (PRD §10). GET: the monitors due this minute. POST: a batch of results, stored as BKK — the
 * location is fixed here, so a leaked token can't speak for Singapore or Tokyo. `?confirm=1`: the agent
 * echoes D-051's confirm flag, so it may be given confirm checks (anything else: none). The GET also
 * carries the engine's last cron sweep and who is on call, for the VPS watchdog (S12a, D-053).
 */
export async function GET(request: Request): Promise<Response> {
  if (!hasBearer(request, serverEnv().INGEST_TOKEN)) return unauthorized();
  const confirms = new URL(request.url).searchParams.get('confirm') === '1';
  const db = serviceDb();
  const now = new Date();
  // The watch facts are best effort: a failed read never costs Bangkok its round (the watchdog
  // then counts the sweep as unknown, not missed).
  // The agent's loop asks every minute and its watchdog judges right after: this GET is the
  // watchdog's beat on our side (Probes page; Healthchecks `vps-watchdog` is the outside one).
  const [monitors, , watch] = await Promise.all([
    dueForBangkok(db, now, confirms),
    stampBeat(db, 'vps-watchdog', now),
    loadWatchFacts(db, now).catch((err: unknown) => {
      console.warn(JSON.stringify({ event: 'watch_facts_failed', error: String(err) }));
      return null;
    }),
  ]);
  return Response.json(watch ? { monitors, ...watch } : { monitors });
}

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  if (!hasBearer(request, env.INGEST_TOKEN)) return unauthorized();

  const parsed = ingestBatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_body' }, { status: 400 });

  const now = Date.now();
  const stale = parsed.data.results.some((r) => Math.abs(now - Date.parse(r.checkedAt)) > MAX_SKEW_MS);
  if (stale) return Response.json({ error: 'stale_results' }, { status: 422 });

  const db = serviceDb();
  const stored = await storeBangkokResults(db, parsed.data.results, new Date(now), parsed.data.control);
  // The response doesn't wait: the VPS loop moves on while the engine judges the round.
  after(() => engineAfterReport(db, env, now + ENGINE_BUDGET_MS, 'ingest'));
  return Response.json({ ok: true, stored });
}
