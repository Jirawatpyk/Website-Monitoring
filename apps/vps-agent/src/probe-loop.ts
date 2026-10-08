import { runHttpCheck, type HttpCheckRequest, type HttpCheckResult } from '@dxt/probe';
import { probeRequestHeaders, type IngestBatch } from '@dxt/shared';
import type { Api, DueMonitor } from './api';

/** The immediate recheck starts about 30 s after the scheduled check (PRD §5, spec §6). */
export const RECHECK_DELAY_MS = 30_000;
/** Checks end by here so the recheck's post (≤ 10 s) lands before the next tick (+1 s). */
export const ROUND_BUDGET_MS = 48_000;

export interface ProbeDeps {
  api: Api;
  /** `{ name, value }` of the WAF allowlist header (PRD §13), when configured. */
  secretHeader?: { name: string; value: string };
  /** Control URLs checked every round (D-027); none = no control reported. */
  controlUrls?: readonly string[];
  /** A public site served by Akamai, checked with the controls (D-027 rule 2b); none = not reported. */
  akamaiControlUrl?: string;
  check?: (req: HttpCheckRequest) => Promise<HttpCheckResult>;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ProbeSummary {
  checked: number;
  failed: number;
  rechecked: number;
  /** The round's control check: false = every control URL failed; undefined = none configured. */
  controlOk?: boolean;
}

/** A control URL gets less time than a monitor: it is a well-run public endpoint. */
export const CONTROL_TIMEOUT_MS = 10_000;

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
  finalUrl: r.finalUrl,
  keywordMissing: r.keywordMissing,
  keywordForbidden: r.keywordForbidden,
  waf: r.waf,
});

/**
 * One Bangkok round, judged exactly like Singapore and Tokyo (`runHttpCheck`, same SSRF guard):
 * check every due monitor, post the results, recheck failures about 30 s later and post those.
 * Scheduled checks carry the round's start time so they land in the round they were due for.
 */
export async function runProbeRound({
  api,
  secretHeader,
  controlUrls = [],
  akamaiControlUrl,
  check = runHttpCheck,
  clock = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}: ProbeDeps): Promise<ProbeSummary> {
  const started = clock();
  const monitors = await api.dueMonitors();
  const run = (m: DueMonitor, timeoutMs: number) =>
    check({
      url: m.url,
      method: m.method,
      timeoutMs,
      headers: probeRequestHeaders(m.headers, secretHeader),
      mustContain: m.mustContain,
      mustNotContain: m.mustNotContain,
    });

  // The control check runs beside each batch it vouches for (D-027): ok while any control URL answers.
  const runControl = async () => {
    if (!controlUrls.length) return undefined;
    const get = (url: string) => check({ url, method: 'GET', timeoutMs: CONTROL_TIMEOUT_MS });
    const [rs, akamai] = await Promise.all([
      Promise.all(controlUrls.map(get)),
      akamaiControlUrl ? get(akamaiControlUrl) : Promise.resolve(null),
    ]);
    return {
      ok: rs.some((r) => r.outcome === 'pass'),
      ...(akamai ? { akamaiOk: akamai.outcome === 'pass' } : {}),
    };
  };
  const [first, control] = monitors.length
    ? await Promise.all([
        Promise.all(monitors.map(async (m) => ({ m, r: await run(m, m.timeoutMs) }))),
        runControl(),
      ])
    : [[], undefined];
  if (first.length)
    await api.postResults(
      first.map(({ m, r }) => toResult(m, started, r, 1)),
      control,
    );

  const failed = first.filter(({ r }) => r.outcome === 'fail').map(({ m }) => m);
  let rechecked = 0;
  if (failed.length) {
    await sleep(Math.max(0, started + RECHECK_DELAY_MS - clock()));
    const remaining = started + ROUND_BUDGET_MS - clock();
    if (remaining >= 1_000) {
      // The recheck gets its own control check: the network may have changed in 30 s.
      const [second, recheckControl] = await Promise.all([
        Promise.all(
          failed.map(async (m) => {
            const at = clock();
            return { m, at, r: await run(m, Math.min(m.timeoutMs, remaining)) };
          }),
        ),
        runControl(),
      ]);
      await api.postResults(
        second.map(({ m, at, r }) => toResult(m, at, r, 2)),
        recheckControl,
      );
      rechecked = second.length;
    }
  }
  return {
    checked: first.length,
    failed: failed.length,
    rechecked,
    ...(control ? { controlOk: control.ok } : {}),
  };
}

/** Milliseconds until the next interval boundary (the UTC minute for 60 s), plus a small offset. */
export function untilNextTick(now: number, intervalMs: number, offsetMs = 1_000): number {
  return intervalMs - (now % intervalMs) + offsetMs;
}
