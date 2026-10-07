import type { CheckOutcome, ProbeLocation, ProblemDetail } from '@dxt/shared';
import { faultyLocations, isRegionalProblem, REGIONAL_AFTER_MIN } from './round';

/**
 * PROBLEM triggers (PRD §5, StatusModel "PROBLEM triggers", D-022): pure rules over one monitor's
 * checks in one round, plus the carry state some of them need across rounds. Each fires on what a
 * majority of the reporting locations saw, so one location's CDN wobble never pages anyone.
 */

/** What a probe saw for one check, beyond pass / fail / blocked. */
export interface CheckFacts {
  location: ProbeLocation;
  outcome: CheckOutcome;
  checkedAt: Date;
  statusCode: number | null;
  error?: string | null;
  responseMs?: number | null;
  finalUrl?: string | null;
  /** null / undefined = not checked (no keywords, HEAD, or a response that didn't pass). */
  keywordMissing?: readonly string[] | null;
  keywordForbidden?: readonly string[] | null;
}

/** Why a monitor shows PROBLEM this round (defined in `@dxt/shared`, worded by `@dxt/notifier`). */
export type { ProblemDetail } from '@dxt/shared';

// ── Slow (p50 over the threshold 3 rounds in a row) ─────────────────────────

export const SLOW_ROUNDS = 3;

/** The median response time of the passing checks; null with fewer than 2 (no evidence either way). */
export function roundP50(checks: readonly CheckFacts[]): number | null {
  const ms = checks
    .filter((c) => c.outcome === 'pass' && typeof c.responseMs === 'number')
    .map((c) => c.responseMs as number)
    .sort((a, b) => a - b);
  if (ms.length < 2) return null;
  const mid = Math.floor(ms.length / 2);
  return ms.length % 2 ? ms[mid]! : (ms[mid - 1]! + ms[mid]!) / 2;
}

/** The slow streak after this round: +1 over the threshold, 0 under it, unchanged without evidence. */
export function nextSlowRounds(previous: number, p50: number | null, thresholdMs: number): number {
  if (p50 === null) return previous;
  return p50 > thresholdMs ? Math.min(previous + 1, 100) : 0;
}

// ── Keyword (must-contain missing / must-not-contain found) ─────────────────

/** Missing or forbidden text at a majority of the locations that checked keywords (2 or more). */
export function keywordIssue(
  checks: readonly CheckFacts[],
): Extract<ProblemDetail, { kind: 'keyword' }> | null {
  const checked = checks.filter((c) => c.keywordMissing != null || c.keywordForbidden != null);
  const bad = checked.filter((c) => (c.keywordMissing?.length ?? 0) + (c.keywordForbidden?.length ?? 0) > 0);
  if (checked.length < 2 || bad.length * 2 <= checked.length) return null;
  return {
    kind: 'keyword',
    missing: unique(bad.flatMap((c) => c.keywordMissing ?? [])),
    forbidden: unique(bad.flatMap((c) => c.keywordForbidden ?? [])),
    locations: bad.map((c) => c.location),
  };
}

// ── Redirect (final host outside the site's allowlist) ──────────────────────

const bare = (host: string) =>
  host
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .split(/[/:]/)[0]!
    .replace(/^www\./, '')
    .replace(/\.$/, '');

/**
 * A final host is allowed when it is the monitor's own base host (without `www.`), an allowlist
 * entry, or a subdomain of either: `shop.example.com` passes for `example.com`; `example.com.evil.io`
 * doesn't.
 */
export function isAllowedHost(host: string, monitorUrl: string, allowlist: readonly string[]): boolean {
  const h = bare(host);
  const allowed = [bare(hostOf(monitorUrl)), ...allowlist.map(bare)].filter(Boolean);
  return allowed.some((d) => h === d || h.endsWith(`.${d}`));
}

/** The redirect target when a majority of the locations that answered ended outside the allowlist. */
export function redirectIssue(
  checks: readonly CheckFacts[],
  monitorUrl: string,
  allowlist: readonly string[],
): Extract<ProblemDetail, { kind: 'redirect' }> | null {
  const ended = checks.filter((c) => !!c.finalUrl);
  const off = ended.filter((c) => !isAllowedHost(hostOf(c.finalUrl!), monitorUrl, allowlist));
  if (ended.length < 2 || off.length * 2 <= ended.length) return null;
  return { kind: 'redirect', host: hostOf(off[0]!.finalUrl!), locations: off.map((c) => c.location) };
}

// ── Key page 4xx ────────────────────────────────────────────────────────────

/** A key page answering 4xx (a WAF block is `blocked`, not here) at a majority of the reporting locations. */
export function statusIssue(
  checks: readonly CheckFacts[],
): Extract<ProblemDetail, { kind: 'status' }> | null {
  const client = checks.filter(
    (c) => c.outcome === 'pass' && c.statusCode !== null && c.statusCode >= 400 && c.statusCode < 500,
  );
  if (checks.length < 2 || client.length * 2 <= checks.length) return null;
  return { kind: 'status', statusCode: client[0]!.statusCode!, locations: client.map((c) => c.location) };
}

// ── Regional (one location failing ≥ 5 min while the others pass) ───────────

export type FailingSince = Readonly<Partial<Record<ProbeLocation, string>>>;

/**
 * When each location started failing, after this round's scheduled checks: a failure keeps (or
 * starts) its clock, a pass or a block stops it, and a location with no data this round keeps its
 * clock as it was.
 */
export function nextFailingSince(previous: FailingSince, scheduled: readonly CheckFacts[]): FailingSince {
  const next: Partial<Record<ProbeLocation, string>> = { ...previous };
  for (const c of scheduled) {
    if (c.outcome === 'fail') next[c.location] ??= c.checkedAt.toISOString();
    else delete next[c.location];
  }
  return next;
}

/** One location failing for ≥ 5 min while the round's majority passes (spec §6). */
export function regionalIssue(
  scheduled: readonly CheckFacts[],
  failingSince: FailingSince,
): Extract<ProblemDetail, { kind: 'regional' }> | null {
  const failing = scheduled.filter((c) => c.outcome === 'fail');
  const passing = scheduled.filter((c) => c.outcome === 'pass');
  if (failing.length !== 1 || passing.length * 2 <= scheduled.length) return null;
  const one = failing[0]!;
  const since = failingSince[one.location];
  if (!since || !isRegionalProblem(new Date(since), one.checkedAt)) return null;
  const minutes = Math.floor((one.checkedAt.getTime() - Date.parse(since)) / 60_000);
  return {
    kind: 'regional',
    location: one.location,
    minutes: Math.max(minutes, REGIONAL_AFTER_MIN),
    since,
    failure: { statusCode: one.statusCode, error: one.error ?? null },
    okLocations: passing.map((c) => c.location),
  };
}

// ── Faulty location (spec §15.3) ────────────────────────────────────────────

/** Below this many monitors from a location in one minute, the faulty-location rule doesn't apply (D-022). */
export const FAULTY_MIN_MONITORS = 3;

/**
 * Per probe minute, the location that failed more than half of every monitor it checked — treated as
 * no data for that minute (`faultyLocations`). A location with fewer than 3 monitors that minute is
 * never judged faulty: one real failure would otherwise hide a regional problem.
 */
export function faultyByMinute(
  scheduled: readonly (Pick<CheckFacts, 'location' | 'outcome' | 'checkedAt'> & { monitorId: string })[],
): Map<number, Set<ProbeLocation>> {
  const minutes = new Map<number, typeof scheduled>();
  for (const c of scheduled) {
    const minute = minuteOf(c.checkedAt);
    minutes.set(minute, [...(minutes.get(minute) ?? []), c]);
  }
  const out = new Map<number, Set<ProbeLocation>>();
  for (const [minute, rows] of minutes) {
    const monitors = new Map<ProbeLocation, Set<string>>();
    for (const r of rows) monitors.set(r.location, (monitors.get(r.location) ?? new Set()).add(r.monitorId));
    const judged = rows.filter((r) => (monitors.get(r.location)?.size ?? 0) >= FAULTY_MIN_MONITORS);
    const faulty = faultyLocations(judged);
    if (faulty.size) out.set(minute, faulty);
  }
  return out;
}

export const minuteOf = (at: Date): number => Math.floor(at.getTime() / 60_000) * 60_000;

/** The host of an absolute URL, lower-case (the engine has no URL global: no DOM, no Node types). */
export function hostOf(url: string): string {
  const afterScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const authority = afterScheme.split(/[/?#]/)[0]!;
  return authority
    .slice(authority.lastIndexOf('@') + 1)
    .replace(/:\d+$/, '')
    .toLowerCase();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
