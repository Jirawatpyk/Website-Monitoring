import {
  windowEnd,
  windowState,
  type MaintenanceWindow,
  type WindowKind,
  type WindowOutcome,
  type WindowState,
} from '@dxt/engine';
import {
  formatDay,
  formatDuration,
  formatTime,
  formatWhen,
  isSameBangkokDay,
  type SiteStatus,
  type Tier,
} from '@dxt/shared';
import { whenText } from './model';

/**
 * `/maintenance` (boards MaintenancePage, MMaintenanceList; spec §23; D-036), the Overview card and the
 * Recent events lines. Pure — the loader hands it plain rows; times are ISO strings (server → client).
 */

/** One line of a window's log, as the SQL writes it (§23.5: lines are never replaced). */
export interface LogEntry {
  at: string;
  action: string;
  by?: string | null;
  reason?: string;
  from?: string;
  to?: string;
  incident?: string;
}

export interface WindowRow {
  id: string;
  siteId: string;
  siteName: string;
  tier: Tier;
  siteStatus: SiteStatus | null;
  kind: WindowKind;
  startsAt: string;
  endsAt: string;
  approvedAt: string | null;
  approvedById: string | null;
  endedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  createdById: string | null;
  outcome: WindowOutcome | null;
  outcomeDetail: string | null;
  reason: string;
  endReason: string | null;
  byName: string | null;
  ownerName: string | null;
  backupName: string | null;
  /** The site's owner and backup: who may act besides an Admin. */
  ownerIds: string[];
  /** An owner who is an Admin isn't named in "Only Nok, Ploy or an Admin" (§23.7). */
  ownerIsAdmin?: boolean;
  backupIsAdmin?: boolean;
  log: LogEntry[];
}

export interface Viewer {
  id: string;
  name: string;
  /** Admin: every action; Responder: own sites and own requests; everyone else reads only (§23.7). */
  role: 'admin' | 'responder' | 'readonly';
}

const MINUTE = 60_000;
const DAY = 1440;

export const asWindow = (r: WindowRow): MaintenanceWindow => ({
  kind: r.kind,
  startsAt: new Date(r.startsAt),
  endsAt: new Date(r.endsAt),
  approvedAt: r.approvedAt ? new Date(r.approvedAt) : null,
  endedAt: r.endedAt ? new Date(r.endedAt) : null,
  cancelledAt: r.cancelledAt ? new Date(r.cancelledAt) : null,
  outcome: r.outcome,
});

export const stateOf = (r: WindowRow, now: Date): WindowState => windowState(asWindow(r), now);
export const noun = (kind: WindowKind) => (kind === 'mute' ? 'mute' : 'maintenance');
const Noun = (kind: WindowKind) => (kind === 'mute' ? 'Mute' : 'Maintenance');

/** A request: asked for by a Responder (over 24 h) — approved by someone else, or not yet. */
const wasRequest = (r: WindowRow) => !r.approvedAt || (!!r.approvedById && r.approvedById !== r.createdById);

/** "3 days", "2 days", else "4 h 30 min" / "1 d 2 h" (§13). */
export function lengthText(minutes: number): string {
  const m = Math.round(minutes);
  if (m >= DAY && m % DAY === 0) return m === DAY ? '24 h' : `${m / DAY} days`;
  return formatDuration(m);
}

/** "starts in 1 d 12 h" — hours rounded; under a day "N h N min" (§23.3). */
export function countdown(minutes: number): string {
  if (minutes < DAY) return formatDuration(Math.max(1, Math.round(minutes)));
  const h = Math.round(minutes / 60);
  const d = Math.floor(h / 24);
  const r = h % 24;
  return `${d} d${r ? ` ${r} h` : ''}`;
}

/** "Today 09:30", "Sat 26 Sep 22:00". */
const at = (d: Date, now: Date) => (isSameBangkokDay(d, now) ? `Today ${formatTime(d)}` : whenText(d, now));

/** "Today 09:30 → 14:00", "Sat 26 Sep 22:00 → Tue 29 Sep 22:00" (the end's day only when it differs). */
export function spanText(start: Date, end: Date, now: Date): string {
  return `${at(start, now)} → ${isSameBangkokDay(start, end) ? formatTime(end) : at(end, now)}`;
}

/** "Sat 26", "Tue 29" — the phone row's short days (MMaintenanceList). */
const shortDay = (d: Date) => formatDay(d, { weekday: true }).replace(/ [A-Z][a-z]{2}$/, '');

/** When it ended or was set aside. */
const settled = (r: WindowRow) => new Date(r.endedAt ?? r.cancelledAt ?? r.endsAt);

/** A log line in words (board: "Ended early 10:07 by Tao · “reason”"); the create lines are left out. */
export function logLine(e: LogEntry, now: Date): string | null {
  const when = whenText(new Date(e.at), now);
  const by = e.by ? ` by ${e.by}` : '';
  const why = e.reason ? ` · “${e.reason}”` : '';
  switch (e.action) {
    case 'ended_early':
      return `Ended early ${when}${by}${why}`;
    case 'edited':
      return `End ${e.from ? whenText(new Date(e.from), now) : '—'} → ${e.to ? whenText(new Date(e.to), now) : '—'} · ${when}${by}${why}`;
    case 'approved':
      return `Approved ${when}${by}`;
    case 'declined':
      return `Declined ${when}${by}${why}`;
    case 'withdrawn':
      return `Withdrawn ${when}${by}${why}`;
    case 'cancelled':
      return `Cancelled ${when}${by}${why}`;
    case 'ended':
      return `Ended on time ${formatTime(new Date(e.at))}`;
    case 'ended_by_maintenance':
      return `Ended ${when} — maintenance started`;
    case 'not_approved':
      return `Not approved — didn’t start · nobody approved before ${when}`;
    case 'didnt_start':
      return `Didn’t start — site was DOWN${e.incident && e.incident !== 'down' ? ` (${e.incident})` : ''}`;
    default:
      return null;
  }
}

export interface Badge {
  tone: 'accent' | 'neutral';
  variant: 'soft' | 'outline';
  icon: 'calendar' | 'eye-off' | 'clock';
  label: string;
}

export interface PageRow {
  row: WindowRow;
  state: WindowState;
  /** null = the site's real status badge (an active mute), with `mutedLabel` beside it. */
  badge: Badge | null;
  mutedLabel: string | null;
  /** The phone row's short overlay word ("Muted", MMaintenanceList). */
  mutedShort: string | null;
  /** The sheet: "By" / "Asked by" and the name (with when it was asked). */
  by: { label: string; value: string };
  /** The sheet's Uptime fact: counted, not counted, or not affected (it never ran). */
  uptime: string;
  siteSub: string;
  when: string;
  whenSub: string;
  why: string;
  whySub: string;
  logs: string[];
  canApprove: boolean;
  canEnd: boolean;
  editLabel: string | null;
  /** "Only Nok, Ploy or an Admin" / "Waiting for an Admin" when this person can't act. */
  note: string | null;
  /** The phone row's second line. */
  line: string;
}

const RECENT_LABEL: Record<string, string> = {
  ended: 'Ended',
  ended_early: 'Ended early',
  cancelled: 'Cancelled',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  not_approved: 'Not approved',
  didnt_start: 'Didn’t start',
};

/** The request's action for an asker who can withdraw it but not edit it. */
export const WITHDRAW_ONLY = 'Withdraw request…';

/** May this person act on the row's site: an Admin, or its owner or backup (D-012). */
const mayAct = (r: WindowRow, v: Viewer) =>
  v.role === 'admin' || (v.role === 'responder' && r.ownerIds.includes(v.id));

function whoNote(r: WindowRow, v: Viewer): string | null {
  if (v.role === 'readonly') return null;
  const names = [!r.ownerIsAdmin && r.ownerName, !r.backupIsAdmin && r.backupName].filter(
    (n): n is string => !!n && n !== v.name,
  );
  return names.length ? `Only ${names.join(', ')} or an Admin` : 'Only an Admin';
}

export function pageRow(r: WindowRow, v: Viewer, now: Date): PageRow {
  const state = stateOf(r, now);
  const start = new Date(r.startsAt);
  const end = new Date(r.endsAt);
  const realEnd = windowEnd(asWindow(r));
  const icon = r.kind === 'mute' ? 'eye-off' : 'calendar';
  const by = r.byName ?? 'someone';
  const asked = wasRequest(r) && r.kind === 'maintenance';
  const base: PageRow = {
    row: r,
    state,
    badge: null,
    mutedLabel: null,
    siteSub: [`Tier ${r.tier}`, r.ownerName, r.backupName && `backup ${r.backupName}`]
      .filter(Boolean)
      .join(' · '),
    when: spanText(start, end, now),
    whenSub: '',
    why: r.reason,
    whySub: '',
    logs: r.log.map((e) => logLine(e, now)).filter((x): x is string => !!x),
    canApprove: false,
    canEnd: false,
    editLabel: null,
    note: null,
    line: '',
    mutedShort: null,
    by: asked
      ? {
          label: 'Asked by',
          value: `${by} · ${formatWhen(new Date(r.createdAt), now, { midSentence: true })}`,
        }
      : { label: 'By', value: by },
    uptime: r.kind === 'mute' ? 'Still counted' : 'Not counted',
  };
  const lengthMin = (end.getTime() - start.getTime()) / MINUTE;
  const can = mayAct(r, v);

  if (state === 'active') {
    const inFor = formatDuration(Math.max(1, Math.round((now.getTime() - start.getTime()) / MINUTE)));
    if (r.kind === 'maintenance') {
      Object.assign(base, {
        badge: { tone: 'accent', variant: 'soft', icon: 'calendar', label: 'Maintenance' },
        whenSub: `${lengthText(lengthMin)} · ${inFor} in`,
        whySub: `by ${by} · not counted in uptime`,
        line: `${spanText(start, end, now).replace(/^Today /, '')} · ${r.reason}`,
      });
    } else {
      Object.assign(base, {
        mutedLabel: `Muted · until ${whenText(end, now)}`,
        whenSub: `until ${whenText(end, now)} (max 24 h) · ${inFor} in`,
        whySub: `by ${by} · still counted in uptime`,
        line: `Until ${whenText(end, now)} · ${r.reason}`,
        mutedShort: 'Muted',
      });
    }
    if (can) Object.assign(base, { canEnd: true, editLabel: 'Edit end' });
    else base.note = whoNote(r, v);
    return base;
  }

  const startsIn = `starts in ${countdown((start.getTime() - now.getTime()) / MINUTE)}`;
  if (state === 'waiting') {
    Object.assign(base, {
      badge: { tone: 'neutral', variant: 'outline', icon: 'clock', label: 'Needs approval' },
      whenSub: `${lengthText(lengthMin)} · ${startsIn}`,
      whySub: `asked by ${by} · ${formatWhen(new Date(r.createdAt), now, { midSentence: true })}`,
      line: `${shortDay(start)} → ${shortDay(end)} · ${lengthText(lengthMin)} · ${by}`,
    });
    if (v.role === 'admin') base.canApprove = true;
    else if (v.role === 'responder') {
      base.note = 'Waiting for an Admin';
      // The asker who no longer owns the site may still withdraw it, but not edit it (edit_window_end).
      if (can) base.editLabel = 'Edit / withdraw';
      else if (r.createdById === v.id) base.editLabel = WITHDRAW_ONLY;
    }
    return base;
  }
  if (state === 'scheduled') {
    Object.assign(base, {
      badge: { tone: 'neutral', variant: 'outline', icon, label: 'Scheduled' },
      whenSub: `${lengthText(lengthMin)} · ${startsIn}`,
      whySub: `${asked ? `asked by ${by}` : `by ${by}`} · not counted in uptime`,
      line: `${spanText(start, end, now)} · ${r.reason}`,
    });
    if (can) base.editLabel = 'Edit / cancel';
    else base.note = whoNote(r, v);
    return base;
  }

  // Recent (§23.2): ended, ended early, cancelled, withdrawn, declined, not approved, didn't start.
  const key = state === 'ended' && r.endedAt ? 'ended_early' : state;
  const ran = state === 'ended' || (state === 'cancelled' && !!r.endedAt);
  const ranMin = (realEnd.getTime() - start.getTime()) / MINUTE;
  Object.assign(base, {
    badge: { tone: 'neutral', variant: 'outline', icon, label: RECENT_LABEL[key] ?? key },
    when: ran ? spanText(start, realEnd, now) : spanText(start, end, now),
    whenSub: `${Noun(r.kind)} · ${lengthText(ran ? ranMin : lengthMin)}${ran ? '' : ' · didn’t start'}`,
    whySub: asked ? `asked by ${by}` : `by ${by}`,
    line: `${RECENT_LABEL[key] ?? key} ${whenText(settled(r), now)} · ${r.reason}`,
    uptime: ran ? base.uptime : 'Not affected — it never ran',
  });
  return base;
}

export interface Section {
  key: 'active' | 'waiting' | 'scheduled' | 'recent';
  title: string;
  hint: string;
  rows: PageRow[];
}

/** The page's sections in order (§23.2); an empty one is left out, except Recent. */
export function sectionsOf(rows: readonly WindowRow[], v: Viewer, now: Date): Section[] {
  const all = rows.map((r) => pageRow(r, v, now));
  const of = (s: WindowState[]) => all.filter((p) => s.includes(p.state));
  const active = of(['active']).sort((a, b) => Date.parse(a.row.endsAt) - Date.parse(b.row.endsAt));
  const waiting = of(['waiting']).sort((a, b) => Date.parse(a.row.startsAt) - Date.parse(b.row.startsAt));
  const scheduled = of(['scheduled']).sort((a, b) => Date.parse(a.row.startsAt) - Date.parse(b.row.startsAt));
  const settledAt = (p: PageRow) => Date.parse(p.row.endedAt ?? p.row.cancelledAt ?? p.row.endsAt);
  const recent = of(['ended', 'cancelled', 'declined', 'withdrawn', 'not_approved', 'didnt_start'])
    .filter((p) => settledAt(p) >= now.getTime() - 30 * DAY * MINUTE)
    .sort((a, b) => settledAt(b) - settledAt(a));
  const out: Section[] = [];
  if (active.length)
    out.push({
      key: 'active',
      title: 'Active now',
      hint: `${active.length} · alerts off or muted, checks still run`,
      rows: active,
    });
  if (waiting.length)
    out.push({
      key: 'waiting',
      title: 'Waiting for approval',
      hint: `${waiting.length} · over 24 h, asked by a Responder — doesn’t start unless an Admin approves`,
      rows: waiting,
    });
  if (scheduled.length)
    out.push({
      key: 'scheduled',
      title: 'Scheduled',
      hint: `${scheduled.length} · approved, starts on its own`,
      rows: scheduled,
    });
  const kinds = [...new Set(recent.map((p) => p.badge!.label.toLowerCase()))];
  if (recent.length)
    out.push({
      key: 'recent',
      title: 'Recent · last 30 days',
      hint: `${recent.length} · ${kinds.join(', ')}`,
      rows: recent,
    });
  return out;
}

/** "2 active · 1 scheduled · 1 waiting for approval"; nothing → "Nothing active, scheduled or waiting". */
export function metaOf(sections: readonly Section[]): string {
  const n = (k: Section['key']) => sections.find((s) => s.key === k)?.rows.length ?? 0;
  const parts = [
    n('active') && `${n('active')} active`,
    n('scheduled') && `${n('scheduled')} scheduled`,
    n('waiting') && `${n('waiting')} waiting for approval`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing active, scheduled or waiting';
}

/** End now's effects (board MaintenancePage); the Alerts Space line comes with S09b's messages. */
export function endEffects(r: WindowRow, viewer: string, now: Date): string[] {
  const resume = `Alerts resume now${r.ownerName ? ` for ${r.ownerName} (owner)` : ''} and the Alerts Space.`;
  if (r.kind === 'mute')
    return [
      resume,
      'Uptime is unaffected — muted time was already counted.',
      `Logged in the audit log as ${viewer}.`,
    ];
  return [
    resume,
    `Checks from ${formatTime(now)} count in uptime again; ${formatTime(new Date(r.startsAt))}–${formatTime(now)} stays excluded.`,
    `Logged in the audit log as ${viewer}.`,
  ];
}

/** The dialogs' description: "09:30 → 14:00 · CMS upgrade · by Nok" / "Muted 08:40 → 18:00 · …". */
export function dialogDescription(r: WindowRow, now: Date): string {
  const start = new Date(r.startsAt);
  const end = new Date(r.endsAt);
  const span = r.kind === 'mute' ? `Muted ${spanText(start, end, now)}` : spanText(start, end, now);
  return `${span} · ${r.reason} · ${wasRequest(r) && r.kind === 'maintenance' ? 'asked by' : 'by'} ${r.byName ?? 'someone'}`;
}

/** The Ends choices: the current end and nearby hours that keep it valid (≥ 5 min away; a mute ≤ 24 h). */
export function endChoices(r: WindowRow, now: Date): { value: string; label: string }[] {
  const H = 60 * MINUTE;
  const start = Date.parse(r.startsAt);
  const current = Date.parse(r.endsAt);
  const floor = Math.max(now.getTime() + 5 * MINUTE, start);
  const cap = r.kind === 'mute' ? start + 24 * H : start + 31 * DAY * MINUTE;
  const offsets = [-24, -8, -4, -2, -1, 0, 1, 2, 4, 8, 24];
  return [...new Set(offsets.map((h) => current + h * H))]
    .filter((t) => t === current || (t > floor && t <= cap))
    .sort((a, b) => a - b)
    .map((t) => ({
      value: new Date(t).toISOString(),
      label: `${whenText(new Date(t), now)}${t === current ? ' (current)' : ''}`,
    }));
}

/** The approve confirm's effects; the asker's Chat message comes with S09b. */
export function approveEffects(r: WindowRow, viewer: string, now: Date): string[] {
  const start = new Date(r.startsAt);
  const end = new Date(r.endsAt);
  const len = lengthText((end.getTime() - start.getTime()) / MINUTE);
  return [
    `Starts ${whenText(start, now)}, ends ${whenText(end, now)} (${len}). ${r.siteName} is Tier ${r.tier}.`,
    'No alerts for this site during the window. Checks still run and are logged.',
    'Not counted in uptime.',
    'If the site is DOWN or has an incident that hasn’t recovered at the start, the window doesn’t start.',
    `Logged in the audit log as ${viewer}.`,
  ];
}

export const approveTitle = (r: WindowRow) =>
  `Approve ${lengthText((Date.parse(r.endsAt) - Date.parse(r.startsAt)) / MINUTE)} of maintenance?`;

/** What cancelling / withdrawing does. */
export function cancelText(state: WindowState, viewer: string): string {
  if (state === 'waiting')
    return `Withdraws the request — Admins stop seeing it and nothing is scheduled. Logged as ${viewer}.`;
  return `It hasn’t started, so cancelling removes it. Logged as ${viewer}.`;
}

// ── Overview (§23.8) ─────────────────────────────────────────────────────

export interface OverviewMaintenance {
  /** Active rows: "DxT Games — muted" / "until 18:00 · Redeploying build · by Tao · still counted in uptime". */
  active: { id: string; kind: WindowKind; title: string; detail: string }[];
  /** Admin only. */
  waiting: number;
  scheduled: number;
  nextScheduled: string | null;
}

/** The Overview card's facts; null = nothing active, waiting or scheduled (the card is left out). */
export function overviewOf(
  rows: readonly WindowRow[],
  isAdmin: boolean,
  now: Date,
): OverviewMaintenance | null {
  const active = rows
    .filter((r) => stateOf(r, now) === 'active')
    .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));
  const waiting = rows.filter((r) => stateOf(r, now) === 'waiting').length;
  const scheduled = rows
    .filter((r) => stateOf(r, now) === 'scheduled')
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  if (!active.length && !scheduled.length && !(isAdmin && waiting)) return null;
  return {
    active: active.map((r) => {
      const end = new Date(r.endsAt);
      return {
        id: r.id,
        kind: r.kind,
        title: `${r.siteName} — ${r.kind === 'mute' ? 'muted' : 'maintenance'}`,
        detail:
          r.kind === 'mute'
            ? `until ${whenText(end, now)} · ${r.reason} · by ${r.byName ?? 'someone'} · still counted in uptime`
            : `${whenText(new Date(r.startsAt), now)} → ${whenText(end, now)} · ${r.reason} · by ${r.byName ?? 'someone'} · not counted in uptime`,
      };
    }),
    waiting: isAdmin ? waiting : 0,
    scheduled: scheduled.length,
    nextScheduled: scheduled[0] ? whenText(new Date(scheduled[0].startsAt), now) : null,
  };
}

/** The phone Overview row: "1 active · 1 scheduled"; null when nothing is active or scheduled. */
export function phoneLine(o: OverviewMaintenance | null): string | null {
  if (!o || (!o.active.length && !o.scheduled)) return null;
  return [o.active.length && `${o.active.length} active`, o.scheduled && `${o.scheduled} scheduled`]
    .filter(Boolean)
    .join(' · ');
}

export interface WindowEvent {
  id: string;
  at: string;
  text: string;
}

/** Recent events lines from the last day's windows (Main3: "DxT Games muted until 18:00 — Tao"). */
export function windowEvents(rows: readonly WindowRow[], now: Date): WindowEvent[] {
  const since = now.getTime() - DAY * MINUTE;
  const out: WindowEvent[] = [];
  for (const r of rows) {
    if (Date.parse(r.createdAt) >= since) {
      const what =
        r.kind === 'mute'
          ? `${r.siteName} muted until ${whenText(new Date(r.endsAt), now)}`
          : `${r.siteName} maintenance ${whenText(new Date(r.startsAt), now)} → ${whenText(new Date(r.endsAt), now)}`;
      out.push({ id: `${r.id}:c`, at: r.createdAt, text: `${what}${r.byName ? ` — ${r.byName}` : ''}` });
    }
    for (const e of r.log) {
      if (Date.parse(e.at) < since) continue;
      const by = e.by ? ` — ${e.by}` : '';
      const n = noun(r.kind);
      const text =
        e.action === 'ended_early'
          ? `${r.siteName} ${n} ended early${by}`
          : e.action === 'cancelled'
            ? `${r.siteName} ${n} cancelled${by}`
            : e.action === 'edited' && e.to
              ? `${r.siteName} ${n} now ends ${whenText(new Date(e.to), now)}${by}`
              : null;
      if (text) out.push({ id: `${r.id}:${e.at}`, at: e.at, text });
    }
  }
  return out;
}
