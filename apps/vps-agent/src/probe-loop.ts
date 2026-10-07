import { runHttpCheck, type HttpCheckRequest, type HttpCheckResult } from '@dxt/probe';
import type { IngestBatch } from '@dxt/shared';
import type { Api, DueMonitor } from './api';

/** The immediate recheck starts about 30 s after the scheduled check (PRD §5, spec §6). */
export const RECHECK_DELAY_MS = 30_000;
/** A round must be posted before the next one starts. */
export const ROUND_BUDGET_MS = 55_000;

export interface ProbeDeps {
  api: Api;
  /** `{ name, value }` of the WAF allowlist header (PRD §13), when configured. */
  secretHeader?: { name: string; value: string };
  check?: (req: HttpCheckRequest) => Promise<HttpCheckResult>;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ProbeSummary {
  checked: number;
  failed: number;
  rechecked: number;
}

type Result = IngestBatch['results'][number];

const toResult = (m: DueMonitor, checkedAt: number, r: HttpCheckResult, attempt: 1 | 2): Result => ({
  monitorId: m.id,
  checkedAt: new Date(checkedAt).toISOString(),
  outcome: r.outcome,
  statusCode: r.statusCode,
  responseMs: r.responseMs,
  ttfbMs: r.ttfbMs,
  resolvedIp: null,
  error: r.error,
  attempt,
});

/**
 * One Bangkok round, judged exactly like Singapore and Tokyo (`runHttpCheck`, same SSRF guard):
 * check every due monitor, post the results, recheck failures about 30 s later and post those.
 * Scheduled checks carry the round's start time so they land in the round they were due for.
 */
export async function runProbeRound({
  api,
  secretHeader,
  check = runHttpCheck,
  clock = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}: ProbeDeps): Promise<ProbeSummary> {
  const started = clock();
  const monitors = await api.dueMonitors();
  const headers = secretHeader ? { [secretHeader.name]: secretHeader.value } : undefined;
  const run = (m: DueMonitor, timeoutMs: number) =>
    check({ url: m.url, method: m.method, timeoutMs, headers });

  const first = await Promise.all(monitors.map(async (m) => ({ m, r: await run(m, m.timeoutMs) })));
  if (first.length) await api.postResults(first.map(({ m, r }) => toResult(m, started, r, 1)));

  const failed = first.filter(({ r }) => r.outcome === 'fail').map(({ m }) => m);
  let rechecked = 0;
  if (failed.length) {
    await sleep(Math.max(0, started + RECHECK_DELAY_MS - clock()));
    const remaining = started + ROUND_BUDGET_MS - clock();
    if (remaining >= 1_000) {
      const second = await Promise.all(
        failed.map(async (m) => {
          const at = clock();
          return { m, at, r: await run(m, Math.min(m.timeoutMs, remaining)) };
        }),
      );
      await api.postResults(second.map(({ m, at, r }) => toResult(m, at, r, 2)));
      rechecked = second.length;
    }
  }
  return { checked: first.length, failed: failed.length, rechecked };
}

/** Milliseconds until the next interval boundary (the UTC minute for 60 s), plus a small offset. */
export function untilNextTick(now: number, intervalMs: number, offsetMs = 1_000): number {
  return intervalMs - (now % intervalMs) + offsetMs;
}
