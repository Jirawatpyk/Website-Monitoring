import { after } from 'next/server';
import { ingestBatchSchema } from '@dxt/shared';
import { serverEnv } from '@/lib/env';
import { hasBearer, unauthorized } from '@/lib/auth/bearer';
import { serviceDb } from '@/server/db';
import { engineAfterReport } from '@/server/engine/engine-and-deliver';
import { dueForBangkok, storeBangkokResults } from '@/server/ingest/bangkok';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Results older or further in the future than this are refused (replay / clock skew). */
const MAX_SKEW_MS = 5 * 60_000;
/** The engine and the first sends after a batch must finish inside maxDuration. */
const ENGINE_BUDGET_MS = 50_000;

/**
 * Ingest API for the Bangkok probe on the VPS, bearer INGEST_TOKEN; the VPS never holds a database
 * key (PRD §10). GET: the monitors due this minute. POST: a batch of results, stored as BKK — the
 * location is fixed here, so a leaked token can't speak for Singapore or Tokyo.
 */
export async function GET(request: Request): Promise<Response> {
  if (!hasBearer(request, serverEnv().INGEST_TOKEN)) return unauthorized();
  const monitors = await dueForBangkok(serviceDb(), new Date());
  return Response.json({ monitors });
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
  const stored = await storeBangkokResults(db, parsed.data.results, new Date(now));
  // The response doesn't wait: the VPS loop moves on while the engine judges the round.
  after(() => engineAfterReport(db, env, now + ENGINE_BUDGET_MS, 'ingest'));
  return Response.json({ ok: true, stored });
}
