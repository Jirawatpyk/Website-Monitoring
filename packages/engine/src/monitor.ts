import type { IncidentState, ProbeLocation, Severity } from '@dxt/shared';
import { transition } from './lifecycle';
import { BLOCKED_NOTE, confirmsDown, evaluateRound, type LocationResult } from './round';

/**
 * One engine step for one primary monitor (spec §6, §16.4; PRD §5): judge the oldest unjudged check
 * round once it is complete, confirm a hard-fail DOWN with its immediate rechecks, and move an open incident through
 * recovery. Pure: the runner loads the facts, applies the decision and records `roundAt` (the round's
 * start) so a round is judged once.
 *
 * A round is one probe tick: the scheduled checks whose time falls in the same interval bucket
 * (`floor(checkedAt / intervalSec)`), plus each failing location's recheck. Rounds are judged only
 * when complete (every active location reported, every failure rechecked) or once the probes'
 * deadline has passed, so the engine never judges a round before its rechecks land and never mixes
 * two rounds' results.
 *
 * A blocked round (no pass or hard-fail majority, at least one location blocked) goes to the
 * browser verifier (spec §6, D-001, D-019): the runner queues a job, the round waits for it, and its
 * result decides — loaded → OK with a note, failed → DOWN, unavailable → PROBLEM (unverified).
 *
 * Not here yet: relapse while an incident is open (D-004, S04 — reported as `relapse`),
 * faulty-location exclusion and regional PROBLEM (S04), the Admin alert when fewer than 2 locations
 * report (PRD §5, S04).
 */

export interface StoredCheck extends LocationResult {
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

/** The browser verifier's job for one blocked round, as the runner found it. */
export type Verification =
  /** Queued less than 30 s ago, or leased and the lease still holds. */
  | { state: 'pending' }
  | { state: 'loaded'; jobId: string }
  | { state: 'failed'; jobId: string; completedAt: Date; detail: string | null }
  /** Not picked up in 30 s, or the lease ran out without a result. */
  | { state: 'unavailable'; reason: Exclude<VerifierUnavailableReason, 'no_poll'> };

export interface MonitorSnapshot {
  checks: readonly StoredCheck[];
  now: Date;
  /** The monitor's tier interval: one round per interval. */
  intervalSec: number;
  /** Locations expected to report (active probe_locations). */
  locations: readonly ProbeLocation[];
  /** Start of the last round already judged (site_status.last_round_at). */
  lastRoundAt: Date | null;
  /** OK rounds in a row since the last failure (site_status.ok_rounds). */
  okRounds: number;
  open: OpenIncident | null;
  /** The verify job of each blocked round, by round start (epoch ms). */
  verifications?: ReadonlyMap<number, Verification>;
  /** The verifier polled the Job API in the last 2 min (D-019). */
  verifierAvailable?: boolean;
}

export type MonitorDecision =
  /** No complete round to judge yet: look again next run. */
  | { kind: 'wait' }
  /** Judged; no incident change. Record the round, the OK-round count and the site note. */
  | { kind: 'none'; roundAt: Date; okRounds: number; relapse?: true; note?: string }
  /** A blocked round with no job yet: queue one for the browser verifier; the round waits for it. */
  | { kind: 'verify'; roundAt: Date }
  /**
   * A blocked round the verifier can't decide (D-001): PROBLEM (unverified) at once — open the
   * incident unless one is open — and tell the Admin. The next blocked round tries again.
   */
  | {
      kind: 'unverified';
      roundAt: Date;
      /** The first blocked check of the round. */
      startedAt: Date;
      reason: VerifierUnavailableReason;
      note: string;
    }
  /** DOWN confirmed on the check and its recheck: open an incident. */
  | {
      kind: 'open';
      roundAt: Date;
      /** First failed check: the incident's duration starts here (spec §6). */
      startedAt: Date;
      /** The last confirming recheck: "Confirmed down" — the 30 s alert clock starts here (PRD §9). */
      confirmedAt: Date;
      /** The recheck results that confirmed it (or the blocked round's checks), for the cause line. */
      failing: readonly StoredCheck[];
      /** Blocked, then the page failed in the browser: that job (its screenshot is the evidence). */
      verifyJobId?: string;
      browserDetail?: string | null;
    }
  /** First OK round: RECOVERED, incident → Monitoring (spec §16.4). */
  | {
      kind: 'recover';
      roundAt: Date;
      /** The first OK check of the round: the downtime ends here. */
      recoveredAt: Date;
      from: IncidentState;
      to: IncidentState;
      okLocations: number;
      note?: string;
    }
  /** Second OK round in a row: the site is OK; incident → Needs root cause (or stays in Monitoring). */
  | { kind: 'settle'; roundAt: Date; from: IncidentState; to: IncidentState; note?: string };

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
 * complete in view: one interval, the deadline, a recheck and slack. Older rounds are skipped.
 */
export function lookbackMs(intervalSec: number): number {
  return intervalSec * 1000 + ROUND_DEADLINE_MS + RECHECK_WITHIN_MS + 30_000;
}

const RECOVERABLE: readonly IncidentState[] = ['unacked', 'escalated', 'acknowledged'];

interface Round {
  start: Date;
  /** The scheduled check per location. */
  scheduled: StoredCheck[];
  /** The recheck per location that followed its scheduled check. */
  rechecks: StoredCheck[];
}

export function decideMonitor(s: MonitorSnapshot): MonitorDecision {
  const round = oldestReadyRound(s);
  if (!round) return { kind: 'wait' };
  const roundAt = round.start;
  // The rows are already chosen; the window only has to include them all.
  const windowSec =
    (s.now.getTime() - round.start.getTime()) / 1000 + s.intervalSec + RECHECK_WITHIN_MS / 1000;

  const first = evaluateRound({ results: round.scheduled, now: s.now, windowSec });

  if (first.kind === 'hard_fail') {
    const firstFail = earliest(round.scheduled.filter((c) => first.failing.includes(c.location)));
    // Only rechecks vote in the second round, each after its own scheduled check: a location that
    // didn't recheck can't vote twice with its scheduled result.
    const second = evaluateRound({ results: round.rechecks, now: s.now, windowSec, after: firstFail });
    if (!(confirmsDown(first, second) && second.kind === 'hard_fail')) {
      return { kind: 'none', roundAt, okRounds: 0 };
    }
    // A confirmed relapse while an incident is open joins it (D-004) — S04. Nothing new to open.
    if (s.open) return { kind: 'none', roundAt, okRounds: 0, relapse: true };
    const failing = round.rechecks.filter((c) => second.failing.includes(c.location));
    return {
      kind: 'open',
      roundAt,
      startedAt: firstFailedCheck(s.checks, failing),
      confirmedAt: confirmedAt(failing),
      failing,
    };
  }

  // An OK round needs a majority of the reporting locations to pass (PRD §5): one pass and one fail
  // is no majority; two passes and a regional failure is.
  const passing = round.scheduled.filter((c) => c.outcome === 'pass');
  if (first.kind === 'pass' && passing.length * 2 > round.scheduled.length) {
    return okRound(s, roundAt, passing);
  }

  if (first.kind === 'needs_verification') {
    const notPassing = round.scheduled.filter((c) => c.outcome !== 'pass');
    const startedAt = earliest(notPassing);
    const v = s.verifications?.get(round.start.getTime());
    if (!v) {
      if (s.verifierAvailable) return { kind: 'verify', roundAt };
      return { kind: 'unverified', roundAt, startedAt, reason: 'no_poll', note: UNVERIFIED_NOTE };
    }
    switch (v.state) {
      case 'pending':
        return { kind: 'wait' };
      case 'unavailable':
        return { kind: 'unverified', roundAt, startedAt, reason: v.reason, note: UNVERIFIED_NOTE };
      case 'loaded':
        // The browser saw the page: every location counts as reachable this round.
        return okRound(s, roundAt, round.scheduled, BLOCKED_NOTE);
      case 'failed':
        if (s.open) return { kind: 'none', roundAt, okRounds: 0, relapse: true };
        return {
          kind: 'open',
          roundAt,
          startedAt,
          confirmedAt: v.completedAt,
          failing: notPassing,
          verifyJobId: v.jobId,
          browserDetail: v.detail,
        };
    }
  }

  // Too few locations reported: keep the current status (PRD §5). Split or blocked: not an OK round.
  return { kind: 'none', roundAt, okRounds: first.kind === 'insufficient_data' ? s.okRounds : 0 };
}

/** An OK round (a pass majority, or a blocked round the browser verified): recover, settle or count it. */
function okRound(
  s: MonitorSnapshot,
  roundAt: Date,
  reachable: readonly StoredCheck[],
  note?: string,
): MonitorDecision {
  const withNote = note ? { note } : {};
  const open = s.open;
  if (open && RECOVERABLE.includes(open.state)) {
    const next = transition(open.state, 'recover', open);
    if (next.ok) {
      return {
        kind: 'recover',
        roundAt,
        recoveredAt: earliest(reachable),
        from: open.state,
        to: next.state,
        okLocations: reachable.length,
        ...withNote,
      };
    }
  }
  if (open && open.state === 'monitoring' && s.okRounds === 1) {
    const next = transition(open.state, 'ok_two_rounds', open);
    if (next.ok) return { kind: 'settle', roundAt, from: open.state, to: next.state, ...withNote };
  }
  return { kind: 'none', roundAt, okRounds: Math.min(s.okRounds + 1, 2), ...withNote };
}

/**
 * The oldest round after `lastRoundAt` (within the lookback), if it is complete or past its deadline.
 * Rounds are judged in order, so a confirmed DOWN in one round is never skipped for a later one; the
 * runner calls again until it gets `wait`.
 */
function oldestReadyRound(s: MonitorSnapshot): Round | null {
  const intervalMs = s.intervalSec * 1000;
  const oldestAllowed = s.now.getTime() - lookbackMs(s.intervalSec);
  const starts = new Set<number>();
  for (const c of s.checks) {
    if (c.attempt === 1) starts.add(Math.floor(c.checkedAt.getTime() / intervalMs) * intervalMs);
  }
  const oldestFirst = [...starts]
    .filter((start) => start >= oldestAllowed && (!s.lastRoundAt || start > s.lastRoundAt.getTime()))
    .sort((a, b) => a - b);
  const start = oldestFirst[0];
  if (start === undefined) return null;
  const round = buildRound(s.checks, start, intervalMs);
  const pastDeadline = s.now.getTime() - (start + intervalMs) >= ROUND_DEADLINE_MS;
  return isComplete(round, s.locations) || pastDeadline ? round : null;
}

function buildRound(checks: readonly StoredCheck[], start: number, intervalMs: number): Round {
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
function firstFailedCheck(checks: readonly StoredCheck[], confirming: readonly StoredCheck[]): Date {
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
function confirmedAt(rechecks: readonly StoredCheck[]): Date {
  const times = rechecks.map((c) => c.checkedAt.getTime()).sort((a, b) => a - b);
  return new Date(times[Math.min(1, times.length - 1)]!);
}

function earliest(checks: readonly StoredCheck[]): Date {
  return new Date(Math.min(...checks.map((c) => c.checkedAt.getTime())));
}
