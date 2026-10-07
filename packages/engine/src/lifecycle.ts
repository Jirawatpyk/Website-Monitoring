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
  | 'auto_resolve' // a < 5 min PROBLEM nobody acknowledged, at its first OK round (spec §16.1)
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
  unacked: { escalate: 'escalated', ack: 'acknowledged', recover: 'monitoring', auto_resolve: 'resolved' },
  escalated: { escalate: 'escalated', ack: 'acknowledged', recover: 'monitoring', auto_resolve: 'resolved' },
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
  if (event === 'auto_resolve' && ctx.severity !== 'problem') {
    return { ok: false, reason: 'A DOWN never auto-resolves.' };
  }
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
 * Incidents by default (spec §16.1). Call it at recovery: `minutesToRecover` counts from when the
 * PROBLEM was flagged (`detected_at`, spec §19.6) to its first OK check. DOWN never auto-resolves.
 */
export function autoResolves(input: {
  severity: Severity;
  recovered: boolean;
  minutesToRecover: number;
  acknowledged: boolean;
}): boolean {
  return input.severity === 'problem' && input.recovered && !input.acknowledged && input.minutesToRecover < 5;
}

/** States in which an open incident has recovered: a new problem there is a relapse (D-004, spec §19.3). */
export const RECOVERED_STATES: readonly IncidentState[] = ['monitoring', 'needs_root_cause'];

/**
 * Where a relapse puts the incident back (D-004, spec §19.3): Acknowledged if someone had acknowledged
 * it, Escalated if a level had fired, otherwise Unacked. Escalation keeps its original clock.
 */
export function relapseState(input: { acked: boolean; escalationLevel: number }): IncidentState {
  if (input.acked) return 'acknowledged';
  return input.escalationLevel > 0 ? 'escalated' : 'unacked';
}

/** Flapping (PRD §7, spec §19.4): ≥ 3 status changes in 30 min. */
export const FLAP_WINDOW_MS = 30 * 60_000;
export const FLAP_CHANGES = 3;
/** While flapping, RECOVERED becomes one summary after this long of continuous OK. */
export const FLAP_STABLE_MS = 15 * 60_000;

/**
 * Does a new drop at `at` tag the incident flapping? A flip is OK ↔ not-OK at an incident step
 * (`site_status.flips`, D-024); the drop is one only when the site's last flip was to OK (`flipOk`).
 * VOCA: open 03:12, recover 03:19, drop 03:24 → the 3rd change in 30 min.
 */
export function isFlapping(flips: readonly Date[], flipOk: boolean | null | undefined, at: Date): boolean {
  if (flipOk !== true) return false;
  const recent = flips.filter((f) => f.getTime() > at.getTime() - FLAP_WINDOW_MS && f <= at).length;
  return recent + 1 >= FLAP_CHANGES;
}

/** One drop of an incident: from its first failed check to its recovery (null = still down). */
export interface Episode {
  start: Date;
  end: Date | null;
  severity: Severity;
}

/** An incident's timeline events, as the episodes are read from them. */
export interface EpisodeEvent {
  type: 'detected' | 'relapsed' | 'escalated_to_down' | 'recovered' | (string & {});
  at: Date;
  /** The drop's first failed check: the incident's start for `detected`, the payload's for a relapse. */
  startedAt?: Date | null;
  severity?: Severity | null;
}

/**
 * The drops of one incident (spec §19.4 summary: "Down 4 times: 03:12–03:19 · … — 41 min down in
 * total"). A drop starts at `detected`, a `relapsed`, or an escalation after a recovery; it ends at
 * the next `recovered`. Events in any order.
 */
export function episodesOf(events: readonly EpisodeEvent[]): Episode[] {
  const out: Episode[] = [];
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const e of sorted) {
    const last = out.at(-1);
    const open = !!last && last.end === null;
    if (e.type === 'detected' || e.type === 'relapsed' || (e.type === 'escalated_to_down' && !open)) {
      if (open) continue;
      out.push({ start: e.startedAt ?? e.at, end: null, severity: e.severity ?? 'down' });
    } else if (e.type === 'escalated_to_down' && last) {
      last.severity = 'down';
    } else if (e.type === 'recovered' && open && last) {
      last.end = e.at;
    }
  }
  return out;
}

/** Minutes the episodes were down (or had a problem), the drop still in progress counted to `now`. */
export function episodeMinutes(episodes: readonly Episode[], now: Date): number {
  const ms = episodes.reduce((sum, e) => sum + Math.max(0, (e.end ?? now).getTime() - e.start.getTime()), 0);
  return Math.round(ms / 60_000);
}
