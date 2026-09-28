import type { IncidentState, Severity, Tier } from '@dxt/shared';

/**
 * Incident lifecycle (spec §15.4, §16; PRD §8).
 * DOWN: Unacked → Escalated · Lx → Acknowledged → Monitoring → Needs root cause → Resolved → In review → Closed.
 * PROBLEM ends at Resolved. Resolve is always a manual action once its 3 conditions are met.
 */
export type IncidentEvent =
  | 'escalate' // L1/L2 fired without an ack
  | 'ack'
  | 'recover' // first OK round → RECOVERED message
  | 'ok_two_rounds' // second OK round in a row
  | 'resolve'
  | 'submit_review' // post-incident review draft submitted for sign-off
  | 'sign_off';

export interface TransitionContext {
  severity: Severity;
  hasRootCause: boolean;
}

export type TransitionResult = { ok: true; state: IncidentState } | { ok: false; reason: string };

const TRANSITIONS: Partial<Record<IncidentState, Partial<Record<IncidentEvent, IncidentState>>>> = {
  unacked: { escalate: 'escalated', ack: 'acknowledged', recover: 'monitoring' },
  escalated: { escalate: 'escalated', ack: 'acknowledged', recover: 'monitoring' },
  acknowledged: { recover: 'monitoring' },
  monitoring: { ok_two_rounds: 'needs_root_cause', resolve: 'resolved' },
  needs_root_cause: { resolve: 'resolved' },
  resolved: { submit_review: 'in_review' },
  in_review: { sign_off: 'closed' },
};

/** Pure state step. Guards that need more data (the resolve gate) live in `canResolve`. */
export function transition(
  state: IncidentState,
  event: IncidentEvent,
  ctx: TransitionContext,
): TransitionResult {
  if (event === 'submit_review' && ctx.severity !== 'down') {
    return { ok: false, reason: 'Only DOWN incidents get a post-incident review; PROBLEM ends at Resolved.' };
  }
  // Two OK rounds with a root cause already written: stay in Monitoring, ready to resolve.
  if (state === 'monitoring' && event === 'ok_two_rounds' && ctx.hasRootCause) {
    return { ok: true, state: 'monitoring' };
  }
  const next = TRANSITIONS[state]?.[event];
  return next ? { ok: true, state: next } : { ok: false, reason: `Can't ${event} an incident in ${state}.` };
}

export type ClientUpdateState = 'not_required' | 'pending' | 'marked' | 'not_needed';

export interface ResolveConditions {
  /** Consecutive OK rounds since recovery. */
  okRounds: number;
  clientUpdate: ClientUpdateState;
  /** null = not written yet. */
  rootCauseCategory: string | null;
}

export type ResolveBlocker = 'recovery' | 'client_update' | 'root_cause';

/** "Unknown — keep investigating" keeps the incident open (spec §16.3). */
export const UNKNOWN_ROOT_CAUSE = 'unknown';

export function canResolve(c: ResolveConditions): { ok: boolean; unmet: ResolveBlocker[] } {
  const unmet: ResolveBlocker[] = [];
  const category = c.rootCauseCategory?.trim().toLowerCase();
  if (c.okRounds < 2) unmet.push('recovery');
  if (c.clientUpdate === 'pending') unmet.push('client_update');
  if (!category || category === UNKNOWN_ROOT_CAUSE) unmet.push('root_cause');
  return { ok: unmet.length === 0, unmet };
}

/**
 * The client-update track fires when a Tier 1 DOWN reaches 15 min, or a Tier 2 DOWN reaches 60 min
 * counted inside response hours. Tier 3 goes to the report only (spec §9, §16.2).
 * Minutes are incident duration — counted from the FIRST FAILED CHECK, not from "Confirmed down":
 * INC-0142 first failed 09:48:12 → client update due 10:03:12 (Incident, AuditLog, AlertChannels boards),
 * while escalation L1 counts from confirmed down (09:48:41 → 10:03:41).
 * "Reaching" means `>=`. Decision record: docs/decisions.md D-002.
 */
export function clientUpdateRequired(input: {
  tier: Tier;
  severity: Severity;
  /** Minutes since the first failed check. */
  downMinutes: number;
  /** The same, counted only inside the tier's response hours. */
  downMinutesInsideHours: number;
}): boolean {
  if (input.severity !== 'down') return false;
  if (input.tier === 1) return input.downMinutes >= 15;
  if (input.tier === 2) return input.downMinutesInsideHours >= 60;
  return false;
}

/**
 * A PROBLEM that recovers within 5 min and was never acknowledged auto-resolves and is hidden from
 * Incidents by default (spec §16.1). Call it at recovery: `minutesToRecover` is first failed check → first
 * OK round. DOWN never auto-resolves.
 */
export function autoResolves(input: {
  severity: Severity;
  recovered: boolean;
  minutesToRecover: number;
  acknowledged: boolean;
}): boolean {
  return input.severity === 'problem' && input.recovered && !input.acknowledged && input.minutesToRecover < 5;
}
