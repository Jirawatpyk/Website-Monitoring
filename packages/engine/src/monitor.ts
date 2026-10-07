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
}

export interface OpenIncident {
  id: string;
  state: IncidentState;
  severity: Severity;
  hasRootCause: boolean;
}

/** The site note while a blocked site can't be verified (D-019; trigger label, spec §11). */
export const UNVERIFIED_NOTE = 'Blocked, not verified';

/** Why the verifier counts as unavailable for a round (D-019). */
export type VerifierUnavailableReason = 'no_poll' | 'not_picked_up' | 'lease_expired';
/** Why a blocked round couldn't be verified: the verifier was unavailable, or the browser was blocked too (D-020). */
export type UnverifiedReason = VerifierUnavailableReason | 'browser_blocked';

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
    if (c.attempt === 1) starts.add(Math.floor(c.checkedAt.getTime() / intervalMs) * intervalMs);
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
): boolean {
  const pastDeadline = now.getTime() - (round.start.getTime() + intervalSec * 1000) >= ROUND_DEADLINE_MS;
  return isComplete(round, locations) || downDecided(round) || pastDeadline;
}

/**
 * Two locations failed the check and their rechecks: a third can't change the verdict, so the round
 * is judged without waiting for it (PRD §9: DOWN within 30 s of the confirm).
 */
export function downDecided(round: Round): boolean {
  const confirmed = round.scheduled.filter(
    (c) =>
      c.outcome === 'fail' && round.rechecks.some((r) => r.location === c.location && r.outcome === 'fail'),
  );
  return confirmed.length >= 2;
}

export function buildRound(checks: readonly StoredCheck[], start: number, intervalSec: number): Round {
  const intervalMs = intervalSec * 1000;
  const scheduled = new Map<ProbeLocation, StoredCheck>();
  for (const c of checks) {
    const t = c.checkedAt.getTime();
    if (c.attempt !== 1 || t < start || t >= start + intervalMs) continue;
    const prev = scheduled.get(c.location);
    if (!prev || prev.checkedAt < c.checkedAt) scheduled.set(c.location, c);
  }
  const rechecks: StoredCheck[] = [];
  for (const first of scheduled.values()) {
    const t0 = first.checkedAt.getTime();
    const recheck = checks
      .filter(
        (c) =>
          c.attempt === 2 &&
          c.location === first.location &&
          c.checkedAt.getTime() > t0 &&
          c.checkedAt.getTime() <= t0 + RECHECK_WITHIN_MS,
      )
      .sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime())[0];
    if (recheck) rechecks.push(recheck);
  }
  return { start: new Date(start), scheduled: [...scheduled.values()], rechecks };
}

/** Complete: every expected location reported and every failure was rechecked. Nobody expected → never. */
function isComplete(round: Round, locations: readonly ProbeLocation[]): boolean {
  if (locations.length === 0) return false;
  return locations.every((location) => {
    const first = round.scheduled.find((c) => c.location === location);
    if (!first) return false;
    return first.outcome !== 'fail' || round.rechecks.some((c) => c.location === location);
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
      if (c.outcome !== 'fail') break;
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
