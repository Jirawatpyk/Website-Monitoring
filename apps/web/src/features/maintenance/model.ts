import { checkWindow, type WindowKind, type WindowProblem } from '@dxt/engine';
import {
  BANGKOK_OFFSET_MS,
  formatDay,
  formatIncidentId,
  formatTime,
  formatNameList,
  formatWindowLength,
  isSameBangkokDay,
  type SiteStatus,
  type Tier,
} from '@dxt/shared';
import type { IncidentLinkData } from '@/components/site-cells';

/**
 * The Maintenance / Mute dialog's words and rules (boards Maintenance, MMaintenance; spec §14.5, §15.1;
 * D-036). Pure: the guardrails are `checkWindow` from @dxt/engine, the same rules the SQL enforces.
 */

/** A site someone may mute or schedule maintenance on, with what the guard needs to know. */
export interface PausableSite {
  id: string;
  name: string;
  tier: Tier;
  owner: string | null;
  status: SiteStatus | null;
  mutedUntil: string | null;
  openIncident: IncidentLinkData | null;
}

export interface Duration {
  label: string;
  minutes: number;
}

const H = 60;
export const DURATIONS: Record<WindowKind, Duration[]> = {
  maintenance: [
    { label: '1 h', minutes: H },
    { label: '4 h', minutes: 4 * H },
    { label: '8 h', minutes: 8 * H },
    { label: '24 h', minutes: 24 * H },
    { label: '3 days', minutes: 72 * H },
  ],
  // At most 24 h (spec §11).
  mute: [
    { label: '1 h', minutes: H },
    { label: '4 h', minutes: 4 * H },
    { label: '8 h', minutes: 8 * H },
    { label: '24 h', minutes: 24 * H },
  ],
};

export const durationOf = (kind: WindowKind, label: string): Duration =>
  DURATIONS[kind].find((d) => d.label === label) ?? DURATIONS[kind][DURATIONS[kind].length - 1]!;

/** "Sat 26 Sep 22:00", or "22:00" when it's today. */
export function whenText(at: Date, now: Date): string {
  return isSameBangkokDay(at, now) ? formatTime(at) : `${formatDay(at, { weekday: true })} ${formatTime(at)}`;
}

/** The Start date choices: today and the next 6 days, as Bangkok dates ("2026-09-26"). */
export function startDays(now: Date): { value: string; label: string }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(now.getTime() + i * 86_400_000);
    const b = new Date(day.getTime() + BANGKOK_OFFSET_MS);
    const value = b.toISOString().slice(0, 10);
    return { value, label: `${formatDay(day, { weekday: true })}${i === 0 ? ' (today)' : ''}` };
  });
}

/** A Bangkok date ("2026-09-26") and time ("22:00") as an instant. */
export function bangkokInstant(date: string, time: string): Date {
  return new Date(Date.parse(`${date}T${time}:00Z`) - BANGKOK_OFFSET_MS);
}

/** The open incident or DOWN status that blocks maintenance now (§14.5); null when the site is free. */
export function busyOf(site: Pick<PausableSite, 'status' | 'openIncident'>): string | null {
  // An incident back up (Monitoring / Needs root cause) doesn't block (D-036 as amended).
  if (site.openIncident && NOT_RECOVERED.includes(site.openIncident.state))
    return formatIncidentId(site.openIncident.number);
  return site.status === 'down' ? 'down' : null;
}

const NOT_RECOVERED: readonly string[] = ['unacked', 'escalated', 'acknowledged'];

/** Still waiting for an acknowledgement: its ladder runs (D-034). */
export const escalating = (i: IncidentLinkData | null) => i?.state === 'unacked' || i?.state === 'escalated';

/** The guard alert's bold line: "MuvMi is DOWN now (INC-0142)." (Maintenance board). */
export function guardTitle(site: Pick<PausableSite, 'name' | 'status' | 'openIncident'>): string {
  const id = site.openIncident ? ` (${formatIncidentId(site.openIncident.number)})` : '';
  if (site.status === 'down') return `${site.name} is DOWN now${id}.`;
  if (site.status === 'problem') return `${site.name} has an open PROBLEM${id}.`;
  return `${site.name} has an open incident${id}.`;
}

export const GUARD_TEXT =
  'A window started now won’t hide this incident — it stays open and keeps counting. Mute the alerts instead, or schedule the window for later.';
/** The guard on a site already muted: no second mute to offer (spec-check). */
export const GUARD_TEXT_MUTED =
  'A window started now won’t hide this incident — it stays open and keeps counting. Schedule the window for later.';

/** "Mute stops new alerts only — INC-0142 keeps escalating until someone acknowledges." (§15.1) */
export function muteRule(i: IncidentLinkData): { title: string; text: string } {
  const id = formatIncidentId(i.number);
  if (escalating(i))
    return {
      title: `Mute stops new alerts only — ${id} keeps escalating until someone acknowledges.`,
      text: 'Its escalation ladder carries on. Muting is not an acknowledgement.',
    };
  return {
    title: `Mute stops new alerts only — ${id} stays open until it is resolved.`,
    text: `${i.ackedBy ? `Already acknowledged by ${i.ackedBy}. ` : ''}Muting is not an acknowledgement and doesn’t resolve it.`,
  };
}

export function submitLabel(
  kind: WindowKind,
  later: boolean,
  duration: string,
  needsApproval = false,
): string {
  if (kind === 'mute') return `Mute for ${duration}`;
  if (needsApproval) return 'Ask for approval';
  return later ? 'Schedule' : 'Start now';
}

export const EFFECT: Record<WindowKind, { title: string; text: string }> = {
  maintenance: {
    title: 'Checks keep running',
    text: 'Results are still stored. Alerts are suppressed, DOWN inside the window does not count against uptime, and the site shows as Maintenance on the dashboard. If the site is still DOWN when the window ends, an incident opens immediately.',
  },
  mute: {
    title: 'Mute only suppresses new alerts',
    text: 'New alerts are suppressed, but the site keeps its real status and still counts toward uptime. The mute shows on the dashboard while it lasts.',
  },
};

export const REASON_HINT = 'Shown on the dashboard and in the audit log.';
export const reasonHint = (reason: string, submit: string) =>
  reason.trim() ? REASON_HINT : `Required — type a reason to enable “${submit}”. ${REASON_HINT}`;

export function reasonPlaceholder(kind: WindowKind, busy: boolean): string {
  if (kind === 'maintenance') return 'e.g. Server migration with hosting provider';
  return busy ? 'e.g. Known outage, host restarting' : 'e.g. Investigating slow booking page';
}

export type DialogProblem = WindowProblem | 'already_muted' | 'in_maintenance';

/** Shown by their own field or alert: the reason hint, the start time, the guard. */
const SHOWN_ELSEWHERE: readonly DialogProblem[] = [
  'reason_required',
  'starts_in_past',
  'ends_before_start',
  'maintenance_open_incident',
];

export interface DialogPlan {
  kind: WindowKind;
  startsAt: Date;
  endsAt: Date;
  problems: DialogProblem[];
  /** Why Submit is off, in words, when the field itself doesn't say (§14.16); null otherwise. */
  notice: string | null;
  needsApproval: boolean;
  /** Maintenance now on a busy site: the guard alert with Mute instead. */
  blocked: boolean;
  submit: string;
}

/** What the dialog's choices add up to, checked by the same rules as the SQL. */
export function planOf(input: {
  kind: WindowKind;
  site: PausableSite;
  later: boolean;
  startDate: string;
  startTime: string;
  duration: string;
  reason: string;
  now: Date;
  isAdmin: boolean;
}): DialogPlan {
  const later = input.kind === 'maintenance' && input.later;
  const startsAt = later ? bangkokInstant(input.startDate, input.startTime) : input.now;
  const d = durationOf(input.kind, input.duration);
  const endsAt = new Date(startsAt.getTime() + d.minutes * 60_000);
  const check = checkWindow({
    kind: input.kind,
    startsAt,
    endsAt,
    reason: input.reason,
    now: input.now,
    siteBusy: busyOf(input.site),
    isAdmin: input.isAdmin,
  });
  // A mute the server would refuse anyway: say so before the round trip (§23.10, spec-check).
  const extra: DialogProblem[] = [];
  if (input.kind === 'mute' && input.site.status === 'maintenance') extra.push('in_maintenance');
  else if (
    input.kind === 'mute' &&
    input.site.mutedUntil &&
    Date.parse(input.site.mutedUntil) > input.now.getTime()
  )
    extra.push('already_muted');
  const problems: DialogProblem[] = [...check.problems, ...extra];
  const shown = problems.find((p) => !SHOWN_ELSEWHERE.includes(p));
  return {
    kind: input.kind,
    startsAt,
    endsAt,
    problems,
    notice: shown ? PROBLEM_WORDS[shown] : null,
    needsApproval: check.needsApproval,
    blocked: check.problems.includes('maintenance_open_incident'),
    submit: submitLabel(input.kind, later, d.label, check.needsApproval),
  };
}

/** The refusals in words, shared by the dialog and the server action's hint mapping. */
export const PROBLEM_WORDS: Record<
  | WindowProblem
  | 'overlap'
  | 'already_muted'
  | 'needs_admin'
  | 'not_active'
  | 'not_open'
  | 'not_waiting'
  | 'unchanged'
  | 'reason_too_long'
  | 'in_maintenance'
  | 'decline_instead'
  | 'end_instead'
  | 'withdraw_instead'
  | 'changed'
  | 'undo_expired'
  | 'undo_overlap'
  | 'undo_needs_admin'
  | 'site_not_live',
  string
> = {
  ends_too_soon: 'The end must be at least 5 min from now.',
  in_maintenance: 'The site is in maintenance — its alerts are already off.',
  decline_instead: 'Admins answer a request — decline it with a reason to ask for changes.',
  end_instead: 'It is running — end it now instead.',
  withdraw_instead: 'It is a request — withdraw it instead.',
  reason_required: 'Type a reason — it goes in the audit log with the change.',
  reason_too_long: 'The reason is too long (500 characters at most).',
  ends_before_start: 'The end must be after the start.',
  starts_in_past: 'The start is in the past — pick Now or a later time.',
  mute_too_long: 'A mute lasts at most 24 h — schedule maintenance for longer.',
  too_long: 'A window lasts at most 31 days.',
  maintenance_open_incident:
    'A window started now won’t hide this incident — mute instead, or schedule it for later.',
  overlap: 'Another window on this site overlaps that time.',
  already_muted: 'This site is already muted — end or edit that mute on Maintenance & mutes.',
  needs_approval_now: 'Over 24 h needs an Admin’s approval first — pick a later start.',
  changed: 'The request changed since you opened it — reload and check it again.',
  needs_admin: 'Over 24 h needs an Admin — ask one to extend it.',
  not_active: 'It isn’t running — cancel it instead.',
  not_open: 'It has already ended.',
  not_waiting: 'It isn’t waiting for approval.',
  unchanged: 'Pick a different end time.',
  undo_expired: 'Too late to undo — it has been posted.',
  undo_overlap: 'Another window now overlaps that time — it can’t be undone.',
  site_not_live: 'Maintenance and mutes are for live sites — start monitoring first.',
  undo_needs_admin: 'Over 24 h with the windows next to it — it can’t be undone; ask an Admin.',
};

const lengthOf = (a: Date, b: Date) => formatWindowLength((b.getTime() - a.getTime()) / 60_000);

/** "Tao", "Ann and Tao", "Ann, Bee and Tao"; "every Admin" while the names aren't known. */
export function adminsText(names: readonly string[] | null | undefined): string {
  return names?.length ? formatNameList(names) : 'every Admin';
}

/** Why a Responder's window over 24 h offers only Later (§24.14, MaintenancePage board). */
export const FORCED_LATER_HINT =
  'Over 24 h needs an Admin’s approval first, so it can’t start now — pick a date below';

/** The Responder's long-window alert (§24.9): "Needs an Admin's approval — Tao gets a request now; …". */
export function approvalNotice(
  names: readonly string[] | null | undefined,
  startsAt: Date,
  now: Date,
): string {
  const who = adminsText(names);
  const verb = names && names.length === 1 ? 'gets' : 'get';
  return `${who === 'every Admin' ? 'Every Admin gets' : `${who} ${verb}`} a request now; it starts only if approved before ${whenText(startsAt, now)}.`;
}

/** The Responder's long window under Duration (§24.9): "Starts … if approved before then · ends … (3 days)". */
export function approvalSpan(startsAt: Date, endsAt: Date, now: Date): string {
  return `Starts ${whenText(startsAt, now)} if approved before then · ends ${whenText(endsAt, now)} (${lengthOf(startsAt, endsAt)})`;
}

/** The success line after Save (boards Maintenance, MMaintenance). */
export function doneOf(p: {
  kind: WindowKind;
  site: PausableSite;
  startsAt: Date;
  endsAt: Date;
  later: boolean;
  needsApproval: boolean;
  reason: string;
  viewer: string;
  now: Date;
  /** Who a request went to (§24.9: "Request sent to Tao"). */
  admins?: readonly string[] | null;
}): { title: string; text: string } {
  // A running one has no Cancel (§23.5): it is ended early or edited.
  const running = p.kind === 'mute' || !p.later;
  const why = ` Reason: “${p.reason.trim()}”. ${running ? 'End early or edit it' : 'Edit or cancel it'} on Maintenance & mutes.`;
  const span = `${whenText(p.startsAt, p.now)} → ${whenText(p.endsAt, p.now)}`;
  if (p.kind === 'mute') {
    const inc = p.site.openIncident;
    const still = inc
      ? escalating(inc)
        ? ` ${formatIncidentId(inc.number)} is still escalating — acknowledge it to stop the escalation.`
        : ` ${formatIncidentId(inc.number)} stays open.`
      : '';
    return {
      title: `Muted · ${p.site.name}`,
      text: `Until ${whenText(p.endsAt, p.now)} · new alerts suppressed, still counted in uptime · recorded in the audit log as ${p.viewer}.${still}${why}`,
    };
  }
  if (p.needsApproval)
    return {
      title: `Request sent to ${adminsText(p.admins)} · ${p.site.name}`,
      text: `${span} (${lengthOf(p.startsAt, p.endsAt)}) · waiting for an Admin — it doesn’t start unless approved before ${whenText(p.startsAt, p.now)}. Recorded in the audit log as ${p.viewer}. Reason: “${p.reason.trim()}”. Follow it under Waiting for approval on Maintenance & mutes.`,
    };
  return {
    title: `${p.later ? 'Maintenance scheduled' : 'Maintenance started'} · ${p.site.name}`,
    text: `${span} · alerts suppressed, not counted in uptime · recorded in the audit log as ${p.viewer}.${why}`,
  };
}
