import 'server-only';
import type { DbClient } from '@dxt/db';
import type { Verification } from '@dxt/engine';

/** No Job API poll for this long = the verifier is unavailable (D-019; it polls every 5 s). */
export const VERIFIER_FRESH_MS = 2 * 60_000;
/** A verify job still queued this long after it was created = nobody is picking jobs up (D-019). */
export const PICKUP_WITHIN_MS = 30_000;
/** More jobs than this waiting → Admin alert (PRD §10, StatusModel). */
export const BACKLOG_ALERT_OVER = 5;

export interface VerifyJobRow {
  id: string;
  monitor_id: string;
  round_at: string | null;
  status: string;
  result: string | null;
  detail: string | null;
  attempts: number;
  created_at: string;
  lease_until: string | null;
  completed_at: string | null;
}

/** What a blocked round's job means for the engine now (D-019). */
export function verificationOf(job: VerifyJobRow, now: Date): Verification {
  const t = now.getTime();
  switch (job.status) {
    case 'done':
      if (job.result === 'blocked') return { state: 'blocked', jobId: job.id };
      return job.result === 'loaded'
        ? { state: 'loaded', jobId: job.id }
        : {
            state: 'failed',
            jobId: job.id,
            completedAt: new Date(job.completed_at ?? now),
            detail: job.detail,
          };
    case 'leased':
      return job.lease_until && Date.parse(job.lease_until) >= t
        ? { state: 'pending' }
        : { state: 'unavailable', reason: 'lease_expired' };
    case 'queued':
      return t - Date.parse(job.created_at) < PICKUP_WITHIN_MS
        ? { state: 'pending' }
        : { state: 'unavailable', reason: 'not_picked_up' };
    default:
      return { state: 'unavailable', reason: job.attempts > 0 ? 'lease_expired' : 'not_picked_up' };
  }
}

export interface VerifierState {
  available: boolean;
  /** monitor id → round start (epoch ms) → its verify job. */
  jobs: Map<string, Map<number, Verification>>;
  /** Jobs waiting to be leased (any kind). */
  queued: number;
  /** Open Admin alerts by kind, with their context. */
  openAlerts: Map<string, Record<string, unknown>>;
}

/** The verifier's heartbeat, the verify jobs of the rounds in view, the queue and open alerts. */
export async function loadVerifierState(
  db: DbClient,
  monitorIds: readonly string[],
  since: Date,
  now: Date,
): Promise<VerifierState> {
  const [beat, jobs, queued, alerts] = await Promise.all([
    db.from('agent_heartbeats').select('last_seen_at').eq('name', 'verifier').maybeSingle(),
    db
      .from('verification_jobs')
      .select(
        'id, monitor_id, round_at, status, result, detail, attempts, created_at, lease_until, completed_at',
      )
      .eq('kind', 'verify')
      .in('monitor_id', monitorIds)
      .gte('round_at', since.toISOString()),
    db.from('verification_jobs').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
    db.from('system_alerts').select('kind, context').is('cleared_at', null),
  ]);
  if (beat.error) throw new Error(`agent_heartbeats: ${beat.error.message}`);
  if (jobs.error) throw new Error(`verification_jobs: ${jobs.error.message}`);
  if (queued.error) throw new Error(`verification_jobs: ${queued.error.message}`);
  if (alerts.error) throw new Error(`system_alerts: ${alerts.error.message}`);

  const byMonitor = new Map<string, Map<number, Verification>>();
  for (const job of (jobs.data ?? []) as VerifyJobRow[]) {
    if (!job.round_at) continue;
    const rounds = byMonitor.get(job.monitor_id) ?? new Map<number, Verification>();
    rounds.set(Date.parse(job.round_at), verificationOf(job, now));
    byMonitor.set(job.monitor_id, rounds);
  }
  const lastSeen = beat.data?.last_seen_at ? Date.parse(beat.data.last_seen_at) : null;
  return {
    available: lastSeen !== null && now.getTime() - lastSeen <= VERIFIER_FRESH_MS,
    jobs: byMonitor,
    queued: queued.count ?? 0,
    openAlerts: new Map(
      (alerts.data ?? []).map((a) => [a.kind, (a.context ?? {}) as Record<string, unknown>]),
    ),
  };
}
