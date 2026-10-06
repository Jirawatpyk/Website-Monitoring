import type { IncidentState, ProbeLocation, Severity } from '@dxt/shared';
import { transition } from './lifecycle';
import { confirmsDown, evaluateRound, type LocationResult } from './round';

/**
 * One engine step for one primary monitor (spec §6, §16.4; PRD §5): judge the newest complete check
 * round, confirm a hard-fail DOWN with its immediate rechecks, and move an open incident through
 * recovery. Pure: the runner loads the facts, applies the decision and records `roundAt` (the round's
 * start) so a round is judged once.
 *
 * A round is one probe tick: the scheduled checks whose time falls in the same interval bucket
 * (`floor(checkedAt / intervalSec)`), plus each failing location's recheck. Rounds are judged only
 * when complete (every active location reported, every failure rechecked) or once the probes'
 * deadline has passed, so the engine never judges a round before its rechecks land and never mixes
 * two rounds' results.
 *
 * Not here yet: relapse while an incident is open (D-004, S04 — reported as `relapse`), blocked /
 * verifier (S03–S04), faulty-location exclusion and regional PROBLEM (S04), the Admin alert when
 * fewer than 2 locations report (PRD §5, S04).
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
}

export type MonitorDecision =
  /** No complete round to judge yet: look again next run. */
  | { kind: 'wait' }
  /** Judged; no incident change. Record the round and the OK-round count. */
  | { kind: 'none'; roundAt: Date; okRounds: number; relapse?: true }
  /** DOWN confirmed on the check and its recheck: open an incident. */
  | {
      kind: 'open';
      roundAt: Date;
      /** First failed check: the incident's duration starts here (spec §6). */
      startedAt: Date;
      /** The recheck results that confirmed it, for the cause line. */
      failing: readonly StoredCheck[];
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
    }
  /** Second OK round in a row: the site is OK; incident → Needs root cause (or stays in Monitoring). */
  | { kind: 'settle'; roundAt: Date; from: IncidentState; to: IncidentState };

/**
 * A round still incomplete this long after it started is judged with what arrived: the probe's
 * budget (55 s) plus room for cron start jitter.
 */
export const ROUND_DEADLINE_MS = 75_000;
/** A recheck belongs to the scheduled check it follows within this time (one probe invocation). */
export const RECHECK_WITHIN_MS = 60_000;

const RECOVERABLE: readonly IncidentState[] = ['unacked', 'escalated', 'acknowledged'];

interface Round {
  start: Date;
  /** The scheduled check per location. */
  scheduled: StoredCheck[];
  /** The recheck per location that followed its scheduled check. */
  rechecks: StoredCheck[];
}

export function decideMonitor(s: MonitorSnapshot): MonitorDecision {
  const round = newestReadyRound(s);
  if (!round) return { kind: 'wait' };
  const roundAt = round.start;
  // The rows are already chosen; the window only has to include them all.
  const windowSec =
    (s.now.getTime() - round.start.getTime()) / 1000 + s.intervalSec + RECHECK_WITHIN_MS / 1000;

  const first = evaluateRound({ results: round.scheduled, now: s.now, windowSec });

  if (first.kind === 'hard_fail') {
    // A relapse while an incident is open joins it (D-004) — S04. Nothing new to open; flag it.
    if (s.open) return { kind: 'none', roundAt, okRounds: 0, relapse: true };

    const startedAt = earliest(round.scheduled.filter((c) => first.failing.includes(c.location)));
    // Only rechecks vote in the second round, each after its own scheduled check: a location that
    // didn't recheck can't vote twice with its scheduled result.
    const second = evaluateRound({ results: round.rechecks, now: s.now, windowSec, after: startedAt });
    if (confirmsDown(first, second) && second.kind === 'hard_fail') {
      const failing = round.rechecks.filter((c) => second.failing.includes(c.location));
      return { kind: 'open', roundAt, startedAt, failing };
    }
    return { kind: 'none', roundAt, okRounds: 0 };
  }

  // An OK round needs every reporting location to pass: one pass and one fail is no majority (PRD §5).
  if (first.kind === 'pass' && first.failing.length === 0) {
    const passing = round.scheduled.filter((c) => c.outcome === 'pass');
    const open = s.open;
    if (open && RECOVERABLE.includes(open.state)) {
      const next = transition(open.state, 'recover', open);
      if (next.ok) {
        return {
          kind: 'recover',
          roundAt,
          recoveredAt: earliest(passing),
          from: open.state,
          to: next.state,
          okLocations: passing.length,
        };
      }
    }
    if (open && open.state === 'monitoring' && s.okRounds === 1) {
      const next = transition(open.state, 'ok_two_rounds', open);
      if (next.ok) return { kind: 'settle', roundAt, from: open.state, to: next.state };
    }
    return { kind: 'none', roundAt, okRounds: Math.min(s.okRounds + 1, 2) };
  }

  // Too few locations reported: keep the current status (PRD §5). Split or blocked: not an OK round.
  return { kind: 'none', roundAt, okRounds: first.kind === 'insufficient_data' ? s.okRounds : 0 };
}

/** The newest round after `lastRoundAt` that is complete or past its deadline. */
function newestReadyRound(s: MonitorSnapshot): Round | null {
  const intervalMs = s.intervalSec * 1000;
  const starts = new Set<number>();
  for (const c of s.checks) {
    if (c.attempt === 1) starts.add(Math.floor(c.checkedAt.getTime() / intervalMs) * intervalMs);
  }
  const newestFirst = [...starts].sort((a, b) => b - a);
  for (const start of newestFirst) {
    if (s.lastRoundAt && start <= s.lastRoundAt.getTime()) return null;
    const round = buildRound(s.checks, start, intervalMs);
    if (isComplete(round, s.locations) || s.now.getTime() - start >= ROUND_DEADLINE_MS) return round;
  }
  return null;
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

function isComplete(round: Round, locations: readonly ProbeLocation[]): boolean {
  return locations.every((location) => {
    const first = round.scheduled.find((c) => c.location === location);
    if (!first) return false;
    return first.outcome !== 'fail' || round.rechecks.some((c) => c.location === location);
  });
}

function earliest(checks: readonly StoredCheck[]): Date {
  return new Date(Math.min(...checks.map((c) => c.checkedAt.getTime())));
}
