import { serverEnv } from '@/lib/env';
import { hasBearer, notImplemented, unauthorized } from '@/lib/auth/bearer';

export const dynamic = 'force-dynamic';

/**
 * Job API for the browser verifier on the VPS: GET leases the next verification job from pgmq,
 * POST returns its result (+ screenshot path in Supabase Storage). Leases expire so a crashed
 * verifier never holds a job (PRD §10).
 */
export async function GET(request: Request): Promise<Response> {
  if (!hasBearer(request, serverEnv().INGEST_TOKEN)) return unauthorized();
  return notImplemented('jobs.lease');
}

export async function POST(request: Request): Promise<Response> {
  if (!hasBearer(request, serverEnv().INGEST_TOKEN)) return unauthorized();
  return notImplemented('jobs.complete');
}
