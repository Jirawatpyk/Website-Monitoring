import { checkWindow, type WindowKind, type WindowProblem } from '@dxt/engine';
import {
  BANGKOK_OFFSET_MS,
  formatDay,
  formatIncidentId,
  formatTime,
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
  if (site.openIncident) return formatIncidentId(site.openIncident.number);
  return site.status === 'down' ? 'down' : null;
}

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

export function submitLabel(kind: WindowKind, later: boolean, duration: string): string {
  if (kind === 'mute') return `Mute for ${duration}`;
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

export interface DialogPlan {
  kind: WindowKind;
  startsAt: Date;
  endsAt: Date;
  problems: WindowProblem[];
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
  return {
    kind: input.kind,
    startsAt,
    endsAt,
    problems: check.problems,
    needsApproval: check.needsApproval,
    blocked: check.problems.includes('maintenance_open_incident'),
    submit: submitLabel(input.kind, later, d.label),
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
  | 'reason_too_long',
  string
> = {
  reason_required: 'Type a reason — it goes in the audit log with the change.',
  reason_too_long: 'The reason is too long (500 characters at most).',
  ends_before_start: 'The end must be after the start.',
  starts_in_past: 'The start is in the past — pick Now or a later time.',
  mute_too_long: 'A mute lasts at most 24 h — schedule maintenance for longer.',
  too_long: 'A window lasts at most 31 days.',
  maintenance_open_incident:
    'A window started now won’t hide this incident — mute instead, or schedule it for later.',
  overlap: 'Another window on this site overlaps that time.',
  already_muted: 'This site is already muted — end or edit that mute from Overview › Maintenance & mutes.',
  needs_admin: 'Over 24 h needs an Admin — ask one to extend it.',
  not_active: 'It isn’t running — cancel it instead.',
  not_open: 'It has already ended.',
  not_waiting: 'It isn’t waiting for approval.',
  unchanged: 'Pick a different end time.',
};

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
}): { title: string; text: string } {
  const why = ` Reason: “${p.reason.trim()}”. End early, edit or cancel it from Overview › Maintenance & mutes.`;
  const span = `${whenText(p.startsAt, p.now)} → ${whenText(p.endsAt, p.now)}`;
  if (p.kind === 'mute') {
    const inc = p.site.openIncident;
    const still = inc
      ? escalating(inc)
        ? ` ${formatIncidentId(inc.number)} is still escalating — acknowledge it to stop it.`
        : ` ${formatIncidentId(inc.number)} stays open.`
      : '';
    return {
      title: `Muted · ${p.site.name}`,
      text: `Until ${whenText(p.endsAt, p.now)} · new alerts suppressed, still counted in uptime · recorded in the audit log as ${p.viewer}.${still}${why}`,
    };
  }
  if (p.needsApproval)
    return {
      title: `Waiting for approval · ${p.site.name}`,
      text: `${span} · an Admin must approve it before it starts; until then alerts carry on · recorded in the audit log as ${p.viewer}.${why}`,
    };
  return {
    title: `${p.later ? 'Maintenance scheduled' : 'Maintenance started'} · ${p.site.name}`,
    text: `${span} · alerts suppressed, not counted in uptime · recorded in the audit log as ${p.viewer}.${why}`,
  };
}
