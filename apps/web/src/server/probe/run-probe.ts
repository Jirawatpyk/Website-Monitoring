import 'server-only';
import type { DbClient } from '@dxt/db';
import { runHttpCheck, type HttpCheckRequest, type HttpCheckResult } from '@dxt/probe';
import type { ProbeLocation } from '@dxt/shared';
import type { CronJobResult } from '../cron-job';
import { loadDueMonitors, type DueMonitor } from './due-monitors';

export { isDue } from './due-monitors';

/** The Vercel region each cloud probe must run in (vercel.json `functions`). */
export const PROBE_REGIONS = { SIN: 'sin1', TYO: 'hnd1' } as const satisfies Partial<
  Record<ProbeLocation, string>
>;
export type CloudLocation = keyof typeof PROBE_REGIONS;

/** Work must finish inside the function's maxDuration (90 s, vercel.json) with room to write results. */
export const PROBE_BUDGET_MS = 85_000;
/** The immediate recheck starts about 30 s after the scheduled check (PRD §5, spec §6). */
export const RECHECK_DELAY_MS = 30_000;

export interface ProbeDeps {
  db: DbClient;
  location: CloudLocation;
  /** `{ name, value }` of the WAF allowlist header (PRD §13), when configured. */
  secretHeader?: { name: string; value: string };
  /**
   * Local development only (PROBE_ALLOW_PRIVATE_TARGETS=1 off Vercel): allow a loopback test target.
   * Off by default — a probe anywhere else keeps the SSRF guard.
   */
  allowPrivateTargets?: boolean;
  /** process.env.VERCEL / VERCEL_REGION; when not on Vercel (local) the region isn't checked. */
  vercel?: { region: string | undefined } | null;
  check?: (req: HttpCheckRequest) => Promise<HttpCheckResult>;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * One probe run from SIN or TYO: check every primary monitor that is due, recheck failures once in
 * the same invocation, and store both as check_results (attempt 1, then 2). The engine judges them.
 */
export async function runProbe({
  db,
  location,
  secretHeader,
  allowPrivateTargets = false,
  vercel = null,
  check = runHttpCheck,
  clock = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}: ProbeDeps): Promise<CronJobResult> {
  // A failover run in another region would record results under the wrong location.
  if (vercel && vercel.region !== PROBE_REGIONS[location]) {
    return { ok: false, location, skipped: 'wrong_region', expected: PROBE_REGIONS[location] };
  }

  const started = clock();
  const monitors = await loadDueMonitors(db, new Date(started));
  const headers = secretHeader ? { [secretHeader.name]: secretHeader.value } : undefined;

  // Scheduled checks carry the run's start time, so a run that starts at :59.9 still lands in the
  // round it was due for; rechecks carry their own start time.
  const runOnce = (m: DueMonitor, timeoutMs: number, at?: number) => {
    const checkedAt = new Date(at ?? clock());
    return check({ url: m.url, method: m.method, timeoutMs, headers, allowPrivateTargets }).then(
      (result) => ({
        m,
        checkedAt,
        result,
      }),
    );
  };

  const first = await Promise.all(monitors.map((m) => runOnce(m, m.timeoutMs, started)));
  await insertResults(db, location, 1, first);

  const failed = first.filter((r) => r.result.outcome === 'fail').map((r) => r.m);
  let rechecked = 0;
  let recheckFailed = 0;
  if (failed.length) {
    const deadline = started + PROBE_BUDGET_MS;
    await sleep(Math.max(0, started + RECHECK_DELAY_MS - clock()));
    const remaining = deadline - clock();
    if (remaining >= 1_000) {
      const second = await Promise.all(failed.map((m) => runOnce(m, Math.min(m.timeoutMs, remaining))));
      await insertResults(db, location, 2, second);
      rechecked = second.length;
      recheckFailed = second.filter((r) => r.result.outcome === 'fail').length;
    }
  }

  const beat = await db
    .from('probe_locations')
    .update({ last_heartbeat_at: new Date(clock()).toISOString() })
    .eq('code', location);
  if (beat.error) throw new Error(`heartbeat: ${beat.error.message}`);

  return { ok: true, location, checked: first.length, failed: failed.length, rechecked, recheckFailed };
}

async function insertResults(
  db: DbClient,
  location: CloudLocation,
  attempt: 1 | 2,
  rows: { m: DueMonitor; checkedAt: Date; result: HttpCheckResult }[],
): Promise<void> {
  if (!rows.length) return;
  const { error } = await db.from('check_results').insert(
    rows.map(({ m, checkedAt, result }) => ({
      monitor_id: m.id,
      location,
      checked_at: checkedAt.toISOString(),
      attempt,
      outcome: result.outcome,
      status_code: result.statusCode,
      response_ms: result.responseMs,
      ttfb_ms: result.ttfbMs,
      error: result.error,
    })),
  );
  if (error) throw new Error(`check_results: ${error.message}`);
}
