import 'server-only';
import type { DbClient } from '@dxt/db';
import type { IngestBatch } from '@dxt/shared';
import type { ServerEnv } from '@/lib/env';
import { engineAndDeliver } from '../engine/engine-and-deliver';
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

/** The monitors the Bangkok probe should check this minute — the same rule as SIN and TYO. */
export async function dueForBangkok(db: DbClient, now: Date): Promise<DueMonitor[]> {
  const monitors = await loadDueMonitors(db, now);
  await beatBangkok(db, now);
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
    })),
  );
  if (error) throw new Error(`check_results: ${error.message}`);
  await beatBangkok(db, now);
  return results.length;
}

/**
 * After a Bangkok batch, judge the rounds and send at once. Any Bangkok result — even a pass — can
 * be the one that completes a round SIN and TYO already confirmed, so the engine runs after every
 * batch (S02b review; PRD §9: alert within 30 s). Idempotent like the probe trigger; a failure is
 * logged and the engine cron judges the round on its next run.
 */
export async function engineAfterIngest(
  db: DbClient,
  env: ServerEnv,
  deadline: number,
  run: typeof engineAndDeliver = engineAndDeliver,
): Promise<void> {
  try {
    const summary = await run(db, env, deadline);
    console.info(JSON.stringify({ event: 'ingest_engine', ...summary }));
  } catch (err) {
    console.error(JSON.stringify({ event: 'ingest_engine_failed', error: String(err) }));
  }
}
