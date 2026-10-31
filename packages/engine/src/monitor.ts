import { isHardFail } from './hard-fail';
import type { IncidentState, ProbeLocation, Severity } from '@dxt/shared';
import type { LocationResult } from './round';
import type { CheckFacts } from './triggers';

/**
 * Check rounds of one monitor (spec §6, §16.4; PRD §5): the building blocks `decideSite` (site.ts)
 * judges every monitor of a site with.
 *
 * A round is one probe tick: the scheduled checks whose time falls in the same interval bucket
 * (`floor(checkedAt / intervalSec)`), plus each failing location's recheck. Rounds are judged only
 * when complete (every active location reported, every failure rechecked) or once the probes'
 * deadline has passed, so the engine never judges a round before its rechecks land and never mixes
 * two rounds' results.
 */

export interface StoredCheck extends LocationResult, CheckFacts {
  /** 1 = scheduled check, 2 = the immediate recheck of a failure. */
  attempt: 1 | 2;
  statusCode: number | null;
  error: string | null;
  /**
   * D-051: a Tier 2–3 confirm check (or its recheck), run a minute after a round whose scheduled checks
   * timed out. Judged with that round (`confirmOf`), never as its own round or its scheduled check.
   */
  confirm?: boolean;
}

export interface OpenIncident {
  id: string;
  state: IncidentState;
  /** The incident's worst severity (only goes up). */
  severity: Severity;
  hasRootCause: boolean;
  /** The severity of the drop in progress (D-024): the status floor and the recovery rule follow it. */
  episodeSeverity?: Severity;
  /** Someone acknowledged it: a PROBLEM never auto-resolves then (spec §16.1). */
  acked?: boolean;
  /** Its first failed check (incident duration). */
  startedAt?: Date;
  /** When it was flagged (`detected_at`): the 5 min of the auto-resolve count from here (spec §19.6). */
  detectedAt?: Date;
  /** Tagged flapping (D-004): RECOVERED becomes one summary after 15 min of continuous OK. */
  isFlapping?: boolean;
}

/** The site note while a blocked site can't be verified (D-019; trigger label, spec §11). */
export const UNVERIFIED_NOTE = 'Blocked, not verified';

/** Why the verifier counts as unavailable for a round (D-019). */
export type VerifierUnavailableReason = 'no_poll' | 'not_picked_up' | 'lease_expired';
/**
 * Why a blocked round couldn't be verified: the verifier was unavailable, the browser was blocked too
 * (D-020), or — behind a WAF — the VPS's control check failed so Bangkok can't decide (D-027).
 */
export type UnverifiedReason = VerifierUnavailableReason | 'browser_blocked' | 'control_failed';

/** The browser verifier's job for one blocked round, as the runner found it. */
export type Verification =
  /** Queued less than 30 s ago, or leased and the lease still holds. */
  | { state: 'pending' }
  | { state: 'loaded'; jobId: string }
  | { state: 'failed'; jobId: string; completedAt: Date; detail: string | null }
  /** The browser got a WAF / challenge page too: the site may block real visitors (D-020). */
  | { state: 'blocked'; jobId: string }
  /** Not picked up in 30 s, or the lease ran out without a result. */
  | { state: 'unavailable'; reason: Exclude<VerifierUnavailableReason, 'no_poll'> };

/**
 * A round still incomplete this long after it ENDS is judged with what arrived. Vercel starts each
 * cron at its own second within the minute (seen on staging: probe-tyo :02, probe-sin :46), so a
 * check late in the round gets its recheck ~30 s into the next one: the probe's budget (55 s) plus
 * room for jitter.
 */
export const ROUND_DEADLINE_MS = 75_000;
/** A recheck belongs to the scheduled check it follows within this time (one probe invocation). */
export const RECHECK_WITHIN_MS = 60_000;

/**
 * How far back the runner must load results for a monitor so every round still to be judged is
 * complete in view: one interval, the deadline, a recheck, a blocked round's verify job at its
 * longest (queued 2 min while the verifier is busy, then a 60 s lease) and slack. Older rounds are
 * skipped, so none may still be waiting for its verdict. Streaks longer than this (slow, regional)
 * live in `monitor_status`, not in the lookback.
 */
export const VERIFY_WAIT_MAX_MS = 120_000 + 60_000;
export function lookbackMs(intervalSec: number): number {
  return intervalSec * 1000 + ROUND_DEADLINE_MS + RECHECK_WITHIN_MS + VERIFY_WAIT_MAX_MS + 30_000;
}

/**
 * How far back the runner loads results: the lookback plus one interval, so the round before the
 * oldest one still to be judged is in view too — a timeout alone reads it (D-049, `firstTimeoutRound`).
 */
export function historyMs(intervalSec: number): number {
  return lookbackMs(intervalSec) + intervalSec * 1000;
}

export interface Round {
  start: Date;
  /** The scheduled check per location. */
  scheduled: StoredCheck[];
  /** The recheck per location that followed its scheduled check. */
  rechecks: StoredCheck[];
}

/** The interval buckets of these checks after `lastRoundAt` and within the lookback, oldest first. */
export function roundStarts(
  checks: readonly StoredCheck[],
  intervalSec: number,
  now: Date,
  lastRoundAt: Date | null,
): number[] {
  const intervalMs = intervalSec * 1000;
  const oldestAllowed = now.getTime() - lookbackMs(intervalSec);
  const starts = new Set<number>();
  for (const c of checks) {
    if (c.attempt === 1 && !c.confirm)
      starts.add(Math.floor(c.checkedAt.getTime() / intervalMs) * intervalMs);
  }
  return [...starts]
    .filter((start) => start >= oldestAllowed && (!lastRoundAt || start > lastRoundAt.getTime()))
    .sort((a, b) => a - b);
}

/** Ready to judge: complete, already decided DOWN, or past its deadline. */
export function isReady(
  round: Round,
  locations: readonly ProbeLocation[],
  intervalSec: number,
  now: Date,
  /** Locations treated as no data this round (faulty, spec §15.3): they neither confirm nor hold it. */
  excluded: ReadonlySet<ProbeLocation> = new Set(),
): boolean {
  const pastDeadline = now.getTime() - (round.start.getTime() + intervalSec * 1000) >= ROUND_DEADLINE_MS;
  return isComplete(round, locations, excluded) || downDecided(round, excluded) || pastDeadline;
}

/**
 * Two locations failed the check and their rechecks: a third can't change the verdict, so the round
 * is judged without waiting for it (PRD §9: DOWN within 30 s of the confirm).
 */
export function downDecided(round: Round, excluded: ReadonlySet<ProbeLocation> = new Set()): boolean {
  const confirmed = round.scheduled.filter(
    (c) =>
      !excluded.has(c.location) &&
      isHardFail(c) &&
      round.rechecks.some((r) => r.location === c.location && isHardFail(r)),
  );
  return confirmed.length >= 2;
}

export function buildRound(checks: readonly StoredCheck[], start: number, intervalSec: number): Round {
  const intervalMs = intervalSec * 1000;
  const scheduled = new Map<ProbeLocation, StoredCheck>();
  for (const c of checks) {
    const t = c.checkedAt.getTime();
    // A D-051 confirm check never stands in for the round's own check (the latest would win).
    if (c.attempt !== 1 || c.confirm || t < start || t >= start + intervalMs) continue;
    const prev = scheduled.get(c.location);
    if (!prev || prev.checkedAt < c.checkedAt) scheduled.set(c.location, c);
  }
  const rechecks: StoredCheck[] = [];
  for (const first of scheduled.values()) {
    const recheck = recheckOf(checks, first, false);
    if (recheck) rechecks.push(recheck);
  }
  return { start: new Date(start), scheduled: [...scheduled.values()], rechecks };
}

/**
 * The first recheck of this check at its location within `RECHECK_WITHIN_MS`. `confirm` keeps the two
 * kinds apart: a D-051 confirm check pairs only with a confirm recheck, a scheduled check only with an
 * ordinary one.
 */
function recheckOf(
  checks: readonly StoredCheck[],
  first: StoredCheck,
  confirm: boolean,
): StoredCheck | undefined {
  const t0 = first.checkedAt.getTime();
  return checks
    .filter(
      (c) =>
        c.attempt === 2 &&
        !!c.confirm === confirm &&
        c.location === first.location &&
        c.checkedAt.getTime() > t0 &&
        c.checkedAt.getTime() <= t0 + RECHECK_WITHIN_MS,
    )
    .sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime())[0];
}

/**
 * D-051: the confirm checks of a Tier 2–3 timeout round — each expected location's latest confirm in the
 * round's bucket and its recheck. `failing`: the confirm rechecks of locations whose confirm and recheck
 * both hard-failed (the second round's evidence); `pending`: expected locations with no confirm yet, or a
 * failed confirm still waiting for its recheck. A location the round sat out (D-027) is neither.
 */
export function confirmOf(
  checks: readonly StoredCheck[],
  roundAt: Date,
  intervalSec: number,
  expected: readonly ProbeLocation[],
  sitsOut: (c: StoredCheck) => boolean = () => false,
): { failing: StoredCheck[]; pending: number } {
  const start = roundAt.getTime();
  const end = start + intervalSec * 1000;
  const failing: StoredCheck[] = [];
  let pending = 0;
  for (const location of expected) {
    const confirm = checks
      .filter(
        (c) =>
          c.confirm &&
          c.attempt === 1 &&
          c.location === location &&
          c.checkedAt.getTime() >= start &&
          c.checkedAt.getTime() < end,
      )
      .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime())[0];
    if (!confirm) {
      pending += 1;
      continue;
    }
    if (sitsOut(confirm) || !isHardFail(confirm)) continue;
    const recheck = recheckOf(checks, confirm, true);
    if (!recheck) pending += 1;
    else if (isHardFail(recheck)) failing.push(recheck);
  }
  return { failing, pending };
}

/** Complete: every expected location reported and every failure was rechecked. Nobody expected → never. */
function isComplete(
  round: Round,
  locations: readonly ProbeLocation[],
  excluded: ReadonlySet<ProbeLocation>,
): boolean {
  if (locations.length === 0) return false;
  return locations.every((location) => {
    if (excluded.has(location)) return true;
    const first = round.scheduled.find((c) => c.location === location);
    if (!first) return false;
    return !isHardFail(first) || round.rechecks.some((c) => c.location === location);
  });
}

/**
 * Spec §6: the incident starts at the first failed check. For each confirming location, walk back
 * from its confirming recheck through its consecutive failures (scheduled checks and rechecks); the
 * earliest of those across locations — even from a split round before the confirming one.
 */
export function firstFailedCheck(checks: readonly StoredCheck[], confirming: readonly StoredCheck[]): Date {
  let start = Infinity;
  for (const recheck of confirming) {
    const history = checks
      .filter((c) => c.location === recheck.location && c.checkedAt <= recheck.checkedAt)
      .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());
    for (const c of history) {
      if (!isHardFail(c)) break;
      start = Math.min(start, c.checkedAt.getTime());
    }
  }
  return new Date(start);
}

/**
 * DOWN is confirmed by the second failing recheck (spec §6: at least 2 locations agree); with three
 * locations a later third one doesn't move the confirm. With one location left, its recheck.
 */
export function confirmedAt(rechecks: readonly StoredCheck[]): Date {
  const times = rechecks.map((c) => c.checkedAt.getTime()).sort((a, b) => a - b);
  return new Date(times[Math.min(1, times.length - 1)]!);
}

export function earliest(checks: readonly StoredCheck[]): Date {
  return new Date(Math.min(...checks.map((c) => c.checkedAt.getTime())));
}
