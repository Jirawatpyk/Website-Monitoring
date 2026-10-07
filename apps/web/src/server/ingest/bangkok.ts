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
 * The monitors the Bangkok probe should check this minute — the same rule as SIN and TYO. Asking
 * isn't a heartbeat: Bangkok beats only when its results are stored, so an agent whose posts fail
 * never holds rounds open waiting for it.
 */
export function dueForBangkok(db: DbClient, now: Date): Promise<DueMonitor[]> {
  return loadDueMonitors(db, now);
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
    })),
  );
  if (error) throw new Error(`check_results: ${error.message}`);
  await beatBangkok(db, now);
  return results.length;
}
