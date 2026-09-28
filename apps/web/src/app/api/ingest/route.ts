import { ingestBatchSchema, type CheckResultInput } from '@dxt/shared';
import { serverEnv } from '@/lib/env';
import { hasBearer, notImplemented, unauthorized } from '@/lib/auth/bearer';

export const dynamic = 'force-dynamic';

/** Results older or further in the future than this are refused (replay / clock skew). */
const MAX_SKEW_MS = 5 * 60_000;

/** Ingest API: the Bangkok VPS probe posts check results here. The VPS never holds a database key (PRD §10). */
export async function POST(request: Request): Promise<Response> {
  if (!hasBearer(request, serverEnv().INGEST_TOKEN)) return unauthorized();

  const parsed = ingestBatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_body' }, { status: 400 });

  const now = Date.now();
  const stale = parsed.data.results.some((r) => Math.abs(now - Date.parse(r.checkedAt)) > MAX_SKEW_MS);
  if (stale) return Response.json({ error: 'stale_results' }, { status: 422 });

  // The location is fixed server-side: this endpoint only ever speaks for Bangkok.
  const results: CheckResultInput[] = parsed.data.results.map((r) => ({ ...r, location: 'BKK' }));

  // TODO(FR-02): insert `results` into check_results with the service client.
  void results;
  return notImplemented('ingest');
}
