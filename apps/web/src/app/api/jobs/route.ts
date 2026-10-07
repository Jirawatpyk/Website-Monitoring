import { after } from 'next/server';
import { serverEnv } from '@/lib/env';
import { hasBearer, unauthorized } from '@/lib/auth/bearer';
import { serviceDb } from '@/server/db';
import { engineAfterReport } from '@/server/engine/engine-and-deliver';
import { completeJob, completeJobSchema, leaseJobs, leaseQuerySchema } from '@/server/verifier/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The engine and the first sends after a verdict must finish inside maxDuration. */
const ENGINE_BUDGET_MS = 50_000;

/**
 * Job API for the browser verifier on the VPS, bearer INGEST_TOKEN (PRD §10, D-019). GET leases up
 * to `max` jobs for 60 s, each with a signed upload URL for its screenshot (the VPS never holds a
 * Storage or database key). POST returns a result; after the lease it is refused (409).
 */
export async function GET(request: Request): Promise<Response> {
  if (!hasBearer(request, serverEnv().INGEST_TOKEN)) return unauthorized();
  const query = leaseQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: 'invalid_query' }, { status: 400 });
  const jobs = await leaseJobs(serviceDb(), query.data, new Date());
  return Response.json({ jobs });
}

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  if (!hasBearer(request, env.INGEST_TOKEN)) return unauthorized();
  const body = completeJobSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: 'invalid_body' }, { status: 400 });

  const db = serviceDb();
  const started = Date.now();
  const done = await completeJob(db, body.data);
  if (!done.ok) return Response.json({ error: 'lease_expired' }, { status: 409 });
  // A verdict judges its blocked round now (OK + note, DOWN or PROBLEM), not at the next cron.
  if (done.kind === 'verify') after(() => engineAfterReport(db, env, started + ENGINE_BUDGET_MS, 'jobs'));
  return Response.json({ ok: true });
}
