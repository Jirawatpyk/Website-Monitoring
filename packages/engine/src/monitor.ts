import type { IncidentState, ProbeLocation, Severity } from '@dxt/shared';
import { transition } from './lifecycle';
import { CLOCK_SKEW_TOLERANCE_MS, confirmsDown, evaluateRound, type LocationResult } from './round';

/**
 * One engine step for one primary monitor (spec §6, §16.4; PRD §5): judge the latest scheduled round,
 * confirm a hard-fail DOWN with the immediate recheck, and move an open incident through recovery.
 * Pure: the runner loads the facts, applies the decision and records `roundAt` so a round is judged once.
 *
 * Not here yet: relapse while an incident is open (D-004, S04), blocked / verifier (S03–S04),
 * faulty-location exclusion and regional PROBLEM (S04).
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
  windowSec: number;
  /** Scheduled-check time of the last round already judged (site_status.last_round_at). */
  lastRoundAt: Date | null;
  /** OK rounds in a row since the last failure (site_status.ok_rounds). */
  okRounds: number;
  open: OpenIncident | null;
}

export type MonitorDecision =
  /** Nothing new to judge, or the recheck may still be on its way: look again next run. */
  | { kind: 'wait' }
  /** Judged; no incident change. Record the round and the OK-round count. */
  | { kind: 'none'; roundAt: Date; okRounds: number }
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
  | { kind: 'recover'; roundAt: Date; from: IncidentState; to: IncidentState; okLocations: number }
  /** Second OK round in a row: the site is OK; incident → Needs root cause (or stays in Monitoring). */
  | { kind: 'settle'; roundAt: Date; from: IncidentState; to: IncidentState };

/** The probe rechecks within one invocation (≤ 60 s); until then a missing recheck may still arrive. */
export const RECHECK_GRACE_MS = 60_000;

const RECOVERABLE: readonly IncidentState[] = ['unacked', 'escalated', 'acknowledged'];

export function decideMonitor(s: MonitorSnapshot): MonitorDecision {
  const scheduled = latestPerLocation(
    s.checks.filter((c) => c.attempt === 1),
    s.now,
    s.windowSec,
  );
  if (scheduled.length === 0) return { kind: 'wait' };

  const roundAt = new Date(Math.max(...scheduled.map((c) => c.checkedAt.getTime())));
  if (s.lastRoundAt && roundAt.getTime() <= s.lastRoundAt.getTime()) return { kind: 'wait' };

  const first = evaluateRound({ results: scheduled, now: s.now, windowSec: s.windowSec });

  if (first.kind === 'hard_fail') {
    // A relapse while an incident is open joins it (D-004) — handled in S04; nothing new to open.
    if (s.open) return { kind: 'none', roundAt, okRounds: 0 };

    const failingFirst = scheduled.filter((c) => first.failing.includes(c.location));
    const startedAt = new Date(Math.min(...failingFirst.map((c) => c.checkedAt.getTime())));
    // Only rechecks count in the second round, and only those after the first failure: a location
    // that didn't recheck can't vote twice with its scheduled result.
    const rechecks = s.checks.filter((c) => c.attempt === 2);
    const second = evaluateRound({ results: rechecks, now: s.now, windowSec: s.windowSec, after: startedAt });

    if (confirmsDown(first, second) && second.kind === 'hard_fail') {
      const confirming = latestPerLocation(rechecks, s.now, s.windowSec, startedAt).filter((c) =>
        second.failing.includes(c.location),
      );
      return { kind: 'open', roundAt, startedAt, failing: confirming };
    }
    if (second.kind === 'insufficient_data' && s.now.getTime() - startedAt.getTime() < RECHECK_GRACE_MS) {
      return { kind: 'wait' };
    }
    return { kind: 'none', roundAt, okRounds: 0 };
  }

  if (first.kind === 'pass') {
    const okLocations = scheduled.filter((c) => c.outcome === 'pass').length;
    const open = s.open;
    if (open && RECOVERABLE.includes(open.state)) {
      const next = transition(open.state, 'recover', open);
      if (next.ok) return { kind: 'recover', roundAt, from: open.state, to: next.state, okLocations };
    }
    if (open && open.state === 'monitoring' && s.okRounds === 1) {
      const next = transition(open.state, 'ok_two_rounds', open);
      if (next.ok) return { kind: 'settle', roundAt, from: open.state, to: next.state };
    }
    return { kind: 'none', roundAt, okRounds: Math.min(s.okRounds + 1, 2) };
  }

  // Too few locations reported: keep the current status (PRD §5). Blocked: the verifier decides (S03).
  return { kind: 'none', roundAt, okRounds: first.kind === 'insufficient_data' ? s.okRounds : 0 };
}

/** The newest check per location inside the window (and after `after`, when given). */
function latestPerLocation(
  checks: readonly StoredCheck[],
  now: Date,
  windowSec: number,
  after?: Date,
): StoredCheck[] {
  const latest = new Map<ProbeLocation, StoredCheck>();
  for (const c of checks) {
    const age = now.getTime() - c.checkedAt.getTime();
    if (age < -CLOCK_SKEW_TOLERANCE_MS || age > windowSec * 1000) continue;
    if (after && c.checkedAt.getTime() <= after.getTime()) continue;
    const prev = latest.get(c.location);
    if (!prev || prev.checkedAt < c.checkedAt) latest.set(c.location, c);
  }
  return [...latest.values()];
}

