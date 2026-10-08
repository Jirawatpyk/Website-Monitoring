import type { CheckOutcome, ProbeLocation, WafVendor } from '@dxt/shared';

/**
 * One check round for one monitor: the latest result from each location inside the tier's window
 * (PRD §5 "Check round", spec §6 DOWN rule).
 */
export interface LocationResult {
  location: ProbeLocation;
  outcome: CheckOutcome;
  checkedAt: Date;
  /** A blocked check's header-level WAF signature (D-027). */
  waf?: WafVendor | null;
  /** Bangkok only: false = both VPS control URLs failed in that batch (D-027); null / absent = ok. */
  controlOk?: boolean | null;
}

export type RoundVerdict =
  /** Fewer than 2 locations reported: keep the current status and alert the Admin. */
  | { kind: 'insufficient_data'; reporting: readonly ProbeLocation[] }
  /** At least 2 locations hard-failed (timeout, 5xx, DNS/TLS error, connection refused). */
  | { kind: 'hard_fail'; failing: readonly ProbeLocation[]; abstained?: readonly ProbeLocation[] }
  /** Blocked (403/429/challenge) with no majority either way: the browser verifier decides. */
  | { kind: 'needs_verification'; blocked: readonly ProbeLocation[] }
  /** No DOWN majority. `failing` lists any minority failures (a regional PROBLEM candidate). */
  | { kind: 'pass'; failing: readonly ProbeLocation[]; abstained?: readonly ProbeLocation[] }
  /**
   * A site behind a WAF where nothing could vote: the others were WAF-blocked and the VPS's control
   * check failed, so its result can't be trusted (D-027). PROBLEM (unverified), never DOWN.
   */
  | { kind: 'untrusted'; abstained: readonly ProbeLocation[] };

export interface RoundInput {
  results: readonly LocationResult[];
  now: Date;
  windowSec: number;
  /** Locations treated as "no data" this round (see `faultyLocations`). */
  excluded?: ReadonlySet<ProbeLocation>;
  /**
   * Only results checked strictly after this instant count. The immediate recheck passes the time of
   * the first failing check, so a location that didn't recheck can't vote twice with its old result.
   */
  after?: Date;
  /**
   * The site is flagged `behind_waf` (D-027): a WAF-signed block and a Bangkok result whose control
   * check failed abstain, and the locations left decide — one is enough.
   */
  wafSite?: boolean;
  /** Fewer reporting locations than this = insufficient data (default 2; the WAF recheck uses 1). */
  minReporting?: number;
}

/** D-027: does this result sit the round out on a site behind a WAF? */
export function abstainsOnWafSite(r: LocationResult): boolean {
  return (r.outcome === 'blocked' && !!r.waf) || (r.location === 'BKK' && r.controlOk === false);
}

/** Probe clocks may run slightly ahead of the engine; results up to this far "in the future" still count. */
export const CLOCK_SKEW_TOLERANCE_MS = 10_000;

export function evaluateRound({
  results,
  now,
  windowSec,
  excluded,
  after,
  wafSite,
  minReporting = 2,
}: RoundInput): RoundVerdict {
  const latest = new Map<ProbeLocation, LocationResult>();
  for (const r of results) {
    if (excluded?.has(r.location)) continue;
    if (after && r.checkedAt.getTime() <= after.getTime()) continue;
    const age = now.getTime() - r.checkedAt.getTime();
    if (age < -CLOCK_SKEW_TOLERANCE_MS || age > windowSec * 1000) continue;
    const prev = latest.get(r.location);
    if (!prev || prev.checkedAt < r.checkedAt) latest.set(r.location, r);
  }

  const counted = [...latest.values()];
  // D-027: the VPS's control check counts even when BKK is excluded as faulty that minute — a VPS
  // whose network is down fails every site, and the verifier runs on that same VPS.
  const controlDown =
    !!wafSite &&
    results.some(
      (r) =>
        r.location === 'BKK' &&
        r.controlOk === false &&
        (!after || r.checkedAt.getTime() > after.getTime()) &&
        now.getTime() - r.checkedAt.getTime() <= windowSec * 1000 &&
        r.checkedAt.getTime() - now.getTime() <= CLOCK_SKEW_TOLERANCE_MS,
    );
  if (counted.length < minReporting) {
    return { kind: 'insufficient_data', reporting: counted.map((r) => r.location) };
  }
  if (wafSite) return evaluateWafRound(counted, controlDown);

  const by = (outcome: CheckOutcome) => counted.filter((r) => r.outcome === outcome).map((r) => r.location);
  const failing = by('fail');
  const blocked = by('blocked');
  const passing = by('pass');

  if (failing.length >= 2) return { kind: 'hard_fail', failing };
  if (passing.length >= 2) return { kind: 'pass', failing };
  if (blocked.length > 0) return { kind: 'needs_verification', blocked };
  return { kind: 'pass', failing };
}

/**
 * D-027: on a site behind a WAF the locations that abstain sit out and the rest decide, one being
 * enough. Nothing left: the control check failed → untrusted; everyone WAF-blocked → the verifier.
 */
function evaluateWafRound(counted: readonly LocationResult[], controlDown: boolean): RoundVerdict {
  const abstained = counted.filter(abstainsOnWafSite).map((r) => r.location);
  const voters = counted.filter((r) => !abstainsOnWafSite(r));
  const by = (outcome: CheckOutcome) => voters.filter((r) => r.outcome === outcome).map((r) => r.location);
  if (!voters.length) {
    // The VPS's own network is down: neither its probe nor its browser verifier can decide.
    if (controlDown) return { kind: 'untrusted', abstained };
    return { kind: 'needs_verification', blocked: counted.map((r) => r.location) };
  }
  const failing = by('fail');
  const passing = by('pass');
  const enough = (n: number) => n >= 2 || (voters.length === 1 && n === 1);
  if (enough(failing.length)) return { kind: 'hard_fail', failing, abstained };
  if (enough(passing.length)) return { kind: 'pass', failing, abstained };
  if (by('blocked').length) {
    // The verifier runs on the same VPS: while its network is down it can't decide either.
    if (controlDown) return { kind: 'untrusted', abstained };
    return { kind: 'needs_verification', blocked: by('blocked') };
  }
  return { kind: 'pass', failing, abstained };
}

/** The site note of an OK round on a site behind a WAF: who decided, who the WAF blocked (D-027). */
export function wafNote(verifiedFrom: readonly ProbeLocation[], blocked: readonly ProbeLocation[]): string {
  return `Verified from ${verifiedFrom.join(', ')}; ${blocked.join(', ')} blocked by bot protection`;
}

/**
 * DOWN needs a hard-fail verdict on two checks in a row; the second is the immediate recheck ~30 s
 * after the first failure. Hard fails never wait for the browser verifier.
 * Evaluate `current` with `after` = the first failing check time, so each vote is a fresh recheck.
 */
export function confirmsDown(previous: RoundVerdict | null, current: RoundVerdict): boolean {
  return previous?.kind === 'hard_fail' && current.kind === 'hard_fail';
}

/** The site note of a blocked round the browser verifier loaded (PRD §5, spec §6). */
export const BLOCKED_NOTE = 'Automated check blocked by bot protection; verified via browser';

/** One location failing ≥ 5 min while the others pass → PROBLEM (regional). */
export const REGIONAL_AFTER_MIN = 5;

export function isRegionalProblem(failingSince: Date, now: Date): boolean {
  return now.getTime() - failingSince.getTime() >= REGIONAL_AFTER_MIN * 60_000;
}

/**
 * A single location that fails more than half of all sites in one round is treated as "no data" for
 * that round, so a broken probe can't take many sites DOWN at once (spec §15.3, PRD §5).
 * Only an outlier is excluded: when two or more locations each fail more than half, the sites really
 * are down (e.g. a shared host) and nothing is excluded — otherwise a mass outage would be hidden.
 */
export function faultyLocations(
  roundResults: readonly Pick<LocationResult, 'location' | 'outcome'>[],
): Set<ProbeLocation> {
  const totals = new Map<ProbeLocation, { all: number; failed: number }>();
  for (const { location, outcome } of roundResults) {
    const t = totals.get(location) ?? { all: 0, failed: 0 };
    t.all += 1;
    if (outcome === 'fail') t.failed += 1;
    totals.set(location, t);
  }
  const overHalf = [...totals].filter(([, t]) => t.failed / t.all > 0.5).map(([location]) => location);
  return overHalf.length === 1 ? new Set(overHalf) : new Set();
}
