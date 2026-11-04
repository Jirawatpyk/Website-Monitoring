import 'server-only';
import type { DbClient } from '@dxt/db';

/**
 * The Vercel side's own beats (S12a, D-053): the Overview fault banner, Probes and the VPS watchdog read
 * them. `engine-run` is every engine run, the cron's or after a Bangkok batch (S12b, D-055).
 */
export type BeatName = 'engine-sweep' | 'engine-run' | 'notifier' | 'crawler' | 'vps-watchdog';

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

/** What the VPS watchdog needs to speak for a stopped engine (S12a, D-053): GET /api/ingest carries it. */
export type WatchFacts = {
  engineSweepAt: string | null;
  onCall: { name: string; chatUserId: string | null } | null;
};

/** The engine's last cron sweep and who holds the on-call shift now (an inactive person: nobody). */
export async function loadWatchFacts(db: DbClient, now: Date): Promise<WatchFacts> {
  const at = now.toISOString();
  const [sweep, shift] = await Promise.all([
    db.from('agent_heartbeats').select('last_seen_at').eq('name', 'engine-sweep').maybeSingle(),
    db
      .from('oncall_shifts')
      .select('person:profiles!oncall_shifts_user_id_fkey(display_name, google_chat_user_id, is_active)')
      .lte('starts_at', at)
      .gt('ends_at', at)
      .maybeSingle(),
  ]);
  if (sweep.error) throw new Error(`agent_heartbeats: ${sweep.error.message}`);
  // The sweep is what the watchdog can't do without: a failed on-call read costs only the mention.
  if (shift.error) console.warn(JSON.stringify({ event: 'watch_oncall_failed', error: shift.error.message }));
  const person = shift.error ? null : shift.data?.person;
  return {
    engineSweepAt: sweep.data?.last_seen_at ?? null,
    onCall: person?.is_active ? { name: person.display_name, chatUserId: person.google_chat_user_id } : null,
  };
}
