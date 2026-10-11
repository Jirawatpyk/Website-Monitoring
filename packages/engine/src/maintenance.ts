/**
 * Maintenance windows and mutes (spec §5, §11, §14.5, §15.1; FR-10a, FR-14; D-036). Pure: the SQL
 * RPCs enforce the same rules (`create_maintenance`, `mute_site`, `window_state`); the dialog shows
 * them before the round trip.
 *   · A mute starts now and lasts at most 24 h; it stops new alerts only and is counted in uptime.
 *   · A window can't start now (or overlap now) on a site that is DOWN or has an open incident.
 *   · A window over 24 h waits for an Admin's approval (an Admin's own is approved); unapproved by
 *     its start, it never starts.
 *   · A window removes its minutes from uptime on both sides — unless an incident was open when it
 *     started: a window never hides an open incident.
 */

export type WindowKind = 'maintenance' | 'mute';

export interface MaintenanceWindow {
  kind: WindowKind;
  startsAt: Date;
  endsAt: Date;
  approvedAt: Date | null;
  /** Ended early (End now), or the moment a running window was cancelled. */
  endedAt: Date | null;
  cancelledAt: Date | null;
  /** Why one that never ran ended (§23.2 Recent): withdrawn, declined, not approved, didn't start. */
  outcome?: WindowOutcome | null;
}

export type WindowOutcome = 'withdrawn' | 'declined' | 'not_approved' | 'didnt_start';
export type WindowState = 'waiting' | 'scheduled' | 'active' | 'ended' | 'cancelled' | WindowOutcome;

const MINUTE = 60_000;
export const MUTE_MAX_MIN = 24 * 60;
export const APPROVAL_OVER_MIN = 24 * 60;
export const WINDOW_MAX_MIN = 31 * 24 * 60;
/** "Now" from the dialog lands a moment later; a start this far back still counts as now. */
const NOW_SLACK_MS = 5 * MINUTE;
/** A new end is at least this far away (§23.10). */
export const MIN_END_AHEAD_MS = 5 * MINUTE;

/** The window's real end: when it was ended early or cancelled while running, else as planned. */
export function windowEnd(w: Pick<MaintenanceWindow, 'endsAt' | 'endedAt'>): Date {
  return w.endedAt ?? w.endsAt;
}

/** Same words and order as SQL `window_state(w, at)`. */
export function windowState(w: MaintenanceWindow, at: Date): WindowState {
  if (w.outcome) return w.outcome;
  if (w.cancelledAt) return 'cancelled';
  if (!w.approvedAt) return at < w.startsAt ? 'waiting' : 'not_approved';
  if (at < w.startsAt) return 'scheduled';
  return at < windowEnd(w) ? 'active' : 'ended';
}

/** The running window of a kind at `at`, if any (one kind never overlaps on a site). */
export function activeWindow<W extends MaintenanceWindow>(
  windows: readonly W[],
  kind: WindowKind,
  at: Date,
): W | null {
  return windows.find((w) => w.kind === kind && windowState(w, at) === 'active') ?? null;
}

export type WindowProblem =
  | 'reason_required'
  | 'ends_before_start'
  | 'ends_too_soon'
  | 'starts_in_past'
  | 'mute_too_long'
  | 'too_long'
  | 'maintenance_open_incident';

export interface WindowDraft {
  kind: WindowKind;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  now: Date;
  /** The open incident ("INC-0142") or "down" when the site is DOWN with none; null otherwise. */
  siteBusy: string | null;
  isAdmin: boolean;
}

/**
 * The guardrails a new window or mute must pass, and whether it will wait for an Admin. `siteBusy` is
 * the site DOWN or an incident that hasn't recovered (Monitoring / Needs root cause don't block, D-036).
 */
export function checkWindow(d: WindowDraft): { problems: WindowProblem[]; needsApproval: boolean } {
  const problems: WindowProblem[] = [];
  if (!d.reason.trim()) problems.push('reason_required');
  const start = Math.max(d.startsAt.getTime(), d.now.getTime());
  const lengthMin = (d.endsAt.getTime() - start) / MINUTE;
  if (d.startsAt.getTime() < d.now.getTime() - NOW_SLACK_MS) problems.push('starts_in_past');
  else if (lengthMin <= 0) problems.push('ends_before_start');
  else if (d.endsAt.getTime() < d.now.getTime() + MIN_END_AHEAD_MS) problems.push('ends_too_soon');
  else if (d.kind === 'mute' && lengthMin > MUTE_MAX_MIN) problems.push('mute_too_long');
  else if (d.kind === 'maintenance' && lengthMin > WINDOW_MAX_MIN) problems.push('too_long');
  if (d.kind === 'maintenance' && start <= d.now.getTime() && d.siteBusy)
    problems.push('maintenance_open_incident');
  const needsApproval = d.kind === 'maintenance' && !d.isAdmin && lengthMin > APPROVAL_OVER_MIN;
  return { problems, needsApproval };
}

export interface Span {
  start: Date;
  end: Date;
}

/**
 * The spans a site's windows remove from uptime (spec §5): approved maintenance windows that ran, from
 * their start to their real end. A mute, a window nobody approved, one cancelled before it started and
 * one that started while an incident was open (`openSpans`: each incident from its start to when it
 * was resolved, null while open) remove nothing (D-036).
 */
export function maintenanceSpans(
  windows: readonly MaintenanceWindow[],
  openSpans: readonly { start: Date; end: Date | null }[],
): Span[] {
  const spans: Span[] = [];
  for (const w of windows) {
    if (w.kind !== 'maintenance' || !w.approvedAt) continue;
    if (w.cancelledAt && !w.endedAt) continue;
    const end = windowEnd(w);
    if (end <= w.startsAt) continue;
    const s = w.startsAt.getTime();
    if (openSpans.some((o) => o.start.getTime() <= s && (o.end === null || o.end.getTime() > s))) continue;
    spans.push({ start: w.startsAt, end });
  }
  return spans.sort((a, b) => a.start.getTime() - b.start.getTime());
}
