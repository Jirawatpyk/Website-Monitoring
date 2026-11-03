import 'server-only';
import type { DbClient } from '@dxt/db';

/** The Vercel side's own beats (S12a, D-053): the Overview fault banner, Probes and the VPS watchdog read them. */
export type BeatName = 'engine-sweep' | 'notifier' | 'crawler';

/**
 * Stamps `agent_heartbeats` for a job that just did its work. Best effort, like the Healthchecks ping:
 * a failed stamp is logged and never fails the job (the Healthchecks check still speaks for it).
 */
export async function stampBeat(db: DbClient, name: BeatName, now: Date = new Date()): Promise<void> {
  try {
    const { error } = await db.from('agent_heartbeats').upsert({ name, last_seen_at: now.toISOString() });
    if (error) console.warn(JSON.stringify({ event: 'beat_failed', name, error: error.message }));
  } catch (err) {
    console.warn(JSON.stringify({ event: 'beat_failed', name, error: String(err) }));
  }
}
