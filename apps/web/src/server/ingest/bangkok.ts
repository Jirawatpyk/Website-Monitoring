import 'server-only';
import type { DbClient } from '@dxt/db';
import type { IngestBatch } from '@dxt/shared';
import { loadDueMonitors, type DueMonitor } from '../probe/due-monitors';

/** Bangkok's results arrive here only through the Ingest API: the location is never the sender's. */
const LOCATION = 'BKK';

/** Mark Bangkok as reporting: the engine expects a location only while it beats (D-019). */
export async function beatBangkok(db: DbClient, now: Date): Promise<void> {
  const { error } = await db
    .from('probe_locations')
    .update({ last_heartbeat_at: now.toISOString() })
    .eq('code', LOCATION);
  if (error) throw new Error(`heartbeat: ${error.message}`);
}

/**
 * The monitors the Bangkok probe should check this minute — the same rule as SIN and TYO. Bangkok
 * beats when its results are stored, so an agent whose posts fail never holds rounds open; in a
 * minute with nothing due no batch follows, so asking is the beat then (else a Tier 2–3-only
 * minute would let it drop out of the vote).
 */
export async function dueForBangkok(db: DbClient, now: Date): Promise<DueMonitor[]> {
  const monitors = await loadDueMonitors(db, now);
  if (!monitors.length) await beatBangkok(db, now);
  return monitors;
}

/** Store a batch from the VPS as BKK check results (attempt 1 or the recheck) and beat. */
export async function storeBangkokResults(
  db: DbClient,
  results: IngestBatch['results'],
  now: Date,
): Promise<number> {
  const { error } = await db.from('check_results').insert(
    results.map((r) => ({
      monitor_id: r.monitorId,
      location: LOCATION,
      checked_at: r.checkedAt,
      attempt: r.attempt,
      outcome: r.outcome,
      status_code: r.statusCode,
      response_ms: r.responseMs,
      ttfb_ms: r.ttfbMs,
      resolved_ip: r.resolvedIp,
      error: r.error,
      final_url: r.finalUrl ?? null,
      keyword_missing: r.keywordMissing ?? null,
      keyword_forbidden: r.keywordForbidden ?? null,
    })),
  );
  if (error) throw new Error(`check_results: ${error.message}`);
  await beatBangkok(db, now);
  return results.length;
}
