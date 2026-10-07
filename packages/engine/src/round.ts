import type { CheckOutcome, ProbeLocation } from '@dxt/shared';

/**
 * One check round for one monitor: the latest result from each location inside the tier's window
 * (PRD §5 "Check round", spec §6 DOWN rule).
 */
export interface LocationResult {
  location: ProbeLocation;
  outcome: CheckOutcome;
  checkedAt: Date;
}

export type RoundVerdict =
  /** Fewer than 2 locations reported: keep the current status and alert the Admin. */
  | { kind: 'insufficient_data'; reporting: readonly ProbeLocation[] }
  /** At least 2 locations hard-failed (timeout, 5xx, DNS/TLS error, connection refused). */
  | { kind: 'hard_fail'; failing: readonly ProbeLocation[] }
  /** Blocked (403/429/challenge) with no majority either way: the browser verifier decides. */
  | { kind: 'needs_verification'; blocked: readonly ProbeLocation[] }
  /** No DOWN majority. `failing` lists any minority failures (a regional PROBLEM candidate). */
  | { kind: 'pass'; failing: readonly ProbeLocation[] };

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
}

/** Probe clocks may run slightly ahead of the engine; results up to this far "in the future" still count. */
export const CLOCK_SKEW_TOLERANCE_MS = 10_000;

export function evaluateRound({ results, now, windowSec, excluded, after }: RoundInput): RoundVerdict {
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
  if (counted.length < 2) return { kind: 'insufficient_data', reporting: counted.map((r) => r.location) };

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
