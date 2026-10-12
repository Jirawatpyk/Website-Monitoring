import { failsHere } from './hard-fail';
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

/**
 * The median response time of the passing checks; null with fewer than `min` (no evidence either way).
 * `min` is 2, or 1 on a site behind a WAF whose round only one location could decide (D-027) — the
 * same goes for the keyword, redirect and key-page status rules below.
 */
export function roundP50(checks: readonly CheckFacts[], min = 2): number | null {
  const ms = checks
    .filter((c) => c.outcome === 'pass' && typeof c.responseMs === 'number')
    .map((c) => c.responseMs as number)
    .sort((a, b) => a - b);
  if (ms.length < min) return null;
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
  min = 2,
): Extract<ProblemDetail, { kind: 'keyword' }> | null {
  const checked = checks.filter((c) => c.keywordMissing != null || c.keywordForbidden != null);
  const bad = checked.filter((c) => (c.keywordMissing?.length ?? 0) + (c.keywordForbidden?.length ?? 0) > 0);
  if (checked.length < min || bad.length * 2 <= checked.length) return null;
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
  min = 2,
): Extract<ProblemDetail, { kind: 'redirect' }> | null {
  const ended = checks.filter((c) => !!c.finalUrl);
  const off = ended.filter((c) => !isAllowedHost(hostOf(c.finalUrl!), monitorUrl, allowlist));
  if (ended.length < min || off.length * 2 <= ended.length) return null;
  return { kind: 'redirect', host: hostOf(off[0]!.finalUrl!), locations: off.map((c) => c.location) };
}

// ── Key page 4xx ────────────────────────────────────────────────────────────

/** A key page answering 4xx (a WAF block is `blocked`, not here) at a majority of the reporting locations. */
export function statusIssue(
  checks: readonly CheckFacts[],
  min = 2,
): Extract<ProblemDetail, { kind: 'status' }> | null {
  const client = checks.filter(
    (c) => c.outcome === 'pass' && c.statusCode !== null && c.statusCode >= 400 && c.statusCode < 500,
  );
  if (checks.length < min || client.length * 2 <= checks.length) return null;
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
    if (failsHere(c)) next[c.location] ??= c.checkedAt.toISOString();
    else delete next[c.location];
  }
  return next;
}

/**
 * One location failing for ≥ 5 min while the round's majority passes (spec §6). Behind a WAF
 * (`wafSite`, D-027) the round's voters already decided it was OK: one passing voter is enough.
 */
export function regionalIssue(
  scheduled: readonly CheckFacts[],
  failingSince: FailingSince,
  wafSite = false,
): Extract<ProblemDetail, { kind: 'regional' }> | null {
  const failing = scheduled.filter(failsHere);
  const passing = scheduled.filter((c) => c.outcome === 'pass');
  const majority = wafSite ? passing.length > 0 : passing.length * 2 > scheduled.length;
  if (failing.length !== 1 || !majority) return null;
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

/** Below this many sites from a location in one minute, the faulty-location rule doesn't apply (D-022). */
export const FAULTY_MIN_SITES = 3;

/**
 * Per probe minute, the location that failed more than half of every monitor it checked — treated as
 * no data for that minute (`faultyLocations`). A location with fewer than 3 sites that minute is
 * never judged faulty: one real failure would otherwise hide a regional problem.
 */
export function faultyByMinute(
  /** Each site's primary scheduled checks (PRD §5 counts sites, not their key pages). */
  scheduled: readonly (Pick<CheckFacts, 'location' | 'outcome' | 'checkedAt' | 'error'> & {
    siteId: string;
  })[],
): Map<number, Set<ProbeLocation>> {
  const minutes = new Map<number, typeof scheduled>();
  for (const c of scheduled) {
    const minute = minuteOf(c.checkedAt);
    minutes.set(minute, [...(minutes.get(minute) ?? []), c]);
  }
  const out = new Map<number, Set<ProbeLocation>>();
  for (const [minute, rows] of minutes) {
    const sites = new Map<ProbeLocation, Set<string>>();
    for (const r of rows) sites.set(r.location, (sites.get(r.location) ?? new Set()).add(r.siteId));
    const judged = rows.filter((r) => (sites.get(r.location)?.size ?? 0) >= FAULTY_MIN_SITES);
    const faulty = faultyLocations(judged);
    if (faulty.size) out.set(minute, faulty);
  }
  return out;
}

// ── Slow location (D-039) ───────────────────────────────────────────────────

/** One site's primary scheduled check, with the limit the slow rule holds it to. */
export interface TimedCheck {
  siteId: string;
  location: ProbeLocation;
  outcome: CheckOutcome;
  checkedAt: Date;
  responseMs?: number | null;
  slowThresholdMs: number;
}

/**
 * What "slow" means when a location is judged (not a site): over 3 s, the strictest tier limit, or a
 * site's own lower one. With each site's own limit a Tier 2–3 site (5 s) at 3–5 s never counted, so a
 * VPS slowing every page to ~3.5 s went unseen (production INC-0011 / INC-0012, 12 Oct 2026, D-039).
 */
export const SLOW_LOCATION_MS = 3_000;

/**
 * Per probe minute, the location whose response times say more about the probe than the sites: the
 * only one slow (over `SLOW_LOCATION_MS`, or a site's own lower limit) on more than half of the 3+ sites it timed that minute,
 * and — on the 3+ sites another location also timed (the same sites, so a site only it can reach
 * behind a WAF accuses nobody) — slow on more than half where that other location was slow on at
 * most half. Its times that minute are no evidence for the slow rule — on a site behind a WAF, the
 * Bangkok VPS's own network slowing down made every one-location round slow (production, 12 Oct
 * 2026). Two locations slow, or everyone, is left alone: the sites may really be slow (the sole
 * outlier, as spec §15.3's faulty location).
 */
export function slowLocationsByMinute(checks: readonly TimedCheck[]): Map<number, Set<ProbeLocation>> {
  const tally = new Map<number, Map<ProbeLocation, Map<string, boolean>>>();
  for (const c of checks) {
    if (c.outcome !== 'pass' || typeof c.responseMs !== 'number') continue;
    const minute = minuteOf(c.checkedAt);
    const locs = tally.get(minute) ?? tally.set(minute, new Map()).get(minute)!;
    const sites = locs.get(c.location) ?? locs.set(c.location, new Map()).get(c.location)!;
    const limit = Math.min(c.slowThresholdMs, SLOW_LOCATION_MS);
    sites.set(c.siteId, (sites.get(c.siteId) ?? false) || c.responseMs > limit);
  }
  const out = new Map<number, Set<ProbeLocation>>();
  for (const [minute, locs] of tally) {
    const judged = [...locs].filter(([, sites]) => sites.size >= FAULTY_MIN_SITES);
    const overHalf = (slow: number, of: number) => slow * 2 > of;
    const slowOn = (sites: Map<string, boolean>, ids: readonly string[]) =>
      ids.filter((id) => sites.get(id)).length;
    const slow = judged.filter(([, sites]) => overHalf(slowOn(sites, [...sites.keys()]), sites.size));
    if (slow.length !== 1) continue;
    const [loc, sites] = slow[0]!;
    const outlier = judged.some(([other, theirs]) => {
      if (other === loc) return false;
      const shared = [...sites.keys()].filter((id) => theirs.has(id));
      return (
        shared.length >= FAULTY_MIN_SITES &&
        overHalf(slowOn(sites, shared), shared.length) &&
        !overHalf(slowOn(theirs, shared), shared.length)
      );
    });
    if (outlier) out.set(minute, new Set([loc]));
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
