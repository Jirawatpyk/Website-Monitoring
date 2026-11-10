import { seriesStateOf, type SeriesState } from '@dxt/engine';
import {
  formatDay,
  formatSeriesRule,
  formatWhen,
  formatWindowLength,
  seriesRuleSchema,
  type SeriesRule,
  type SiteStatus,
  type Tier,
} from '@dxt/shared';
import { whenText } from './model';
import type { Badge, LogEntry, Viewer, WindowRow } from './page-model';

/**
 * A repeating series on `/maintenance` (boards MaintenancePage STATE › Series…, MMaintenanceList; spec
 * §32.4–9, 7b; D-057). Pure — the loader hands it plain rows; times are ISO strings. Its windows are
 * ordinary WindowRows (tagged "Part of a series"); this words the series row itself.
 */

export interface SeriesRow {
  id: string;
  siteId: string;
  siteName: string;
  tier: Tier;
  siteStatus: SiteStatus | null;
  rule: unknown;
  /** Bangkok wall-clock start ("01:00:00") and length. */
  startTime: string;
  durationMin: number;
  /** Bangkok days; `untilOn` null = no end. */
  startsOn: string;
  untilOn: string | null;
  firstStartsAt: string | null;
  reason: string;
  createdAt: string;
  createdById: string | null;
  byName: string | null;
  approvedAt: string | null;
  approvedById: string | null;
  approverName: string | null;
  declinedAt: string | null;
  cancelledAt: string | null;
  outcome: string | null;
  ownerName: string | null;
  backupName: string | null;
  ownerIds: string[];
  ownerIsAdmin?: boolean;
  backupIsAdmin?: boolean;
  log: LogEntry[];
  /** Its windows still to start, in order. */
  upcoming: string[];
  /** The windows its cancel took ("2 not started cancelled (Tue 29 Sep, Tue 6 Oct)"). */
  cancelledWindows: string[];
  /** One of its windows is running now: a cancel lets it finish (§32.6). */
  running?: boolean;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const bangkokDay = (s: string) => formatDay(new Date(`${s}T12:00:00+07:00`), { weekday: true });
const day = (iso: string) => formatDay(new Date(iso), { weekday: true });

/** The stored rule, or null when it can't be read (never shown as a guess). */
export const ruleOf = (r: SeriesRow): SeriesRule | null => {
  const parsed = seriesRuleSchema.safeParse(r.rule);
  return parsed.success ? parsed.data : null;
};

/** "Every Tue 01:00 → 03:00", "Monthly on day 6 · 20:00 → 22:00" (§32.4). */
export function seriesWhen(r: SeriesRow): string {
  const rule = ruleOf(r);
  return rule
    ? capital(
        formatSeriesRule({ rule, startTime: r.startTime, durationMin: r.durationMin }, { length: false }),
      )
    : '—';
}

export const stateOfSeries = (r: SeriesRow, now: Date): SeriesState =>
  seriesStateOf(
    {
      approvedAt: r.approvedAt,
      declinedAt: r.declinedAt,
      cancelledAt: r.cancelledAt,
      outcome: r.outcome,
      untilOn: r.untilOn,
    },
    now,
  );

/** A series' first day: its first window when known, else the first day asked for. */
const fromText = (r: SeriesRow) => (r.firstStartsAt ? day(r.firstStartsAt) : bangkokDay(r.startsOn));
const untilText = (r: SeriesRow) => (r.untilOn ? `until ${bangkokDay(r.untilOn)}` : 'no end date');

/** The overlap a skipped window ran into, from the windows on the page (§32.8). */
function overlapOf(start: Date, r: SeriesRow, windows: readonly WindowRow[]): WindowRow | null {
  const end = start.getTime() + r.durationMin * 60_000;
  return (
    windows.find(
      (w) =>
        w.siteId === r.siteId &&
        w.kind === 'maintenance' &&
        w.seriesId !== r.id &&
        !w.cancelledAt &&
        Date.parse(w.startsAt) < end &&
        Date.parse(w.endedAt ?? w.endsAt) > start.getTime(),
    ) ?? null
  );
}

/**
 * The skipped-window notes, for the windows still ahead (D-057 amended: Claude's reading) — "Skipped Tue
 * 6 Oct — overlaps the 18:00 → 23:00 window (Data-centre move)". An ended series has none (§32 7b).
 */
export function skipNotes(r: SeriesRow, windows: readonly WindowRow[], now: Date): string[] {
  return r.log
    .filter((e) => e.action === 'skipped' && e.starts_at && Date.parse(e.starts_at) > now.getTime())
    .map((e) => {
      const start = new Date(e.starts_at!);
      if (e.reason !== 'overlaps another window') return `Skipped ${day(e.starts_at!)} — too close to start`;
      const o = overlapOf(start, r, windows);
      if (!o) return `Skipped ${day(e.starts_at!)} — overlaps another window on this site`;
      const span = `${whenText(new Date(o.startsAt), start)} → ${whenText(new Date(o.endedAt ?? o.endsAt), start)}`;
      return `Skipped ${day(e.starts_at!)} — overlaps the ${span} window (${o.reason})`;
    });
}

/** The series' own log, in words (§32.6, 7a, 7b); lines it doesn't word (created, requested, skipped) stay out. */
function seriesLogLine(r: SeriesRow, e: LogEntry, now: Date, undone: boolean): string | null {
  const when = whenText(new Date(e.at), now);
  const by = e.by ? ` by ${e.by}` : '';
  const why = e.reason ? ` · “${e.reason}”` : '';
  const posted =
    !undone && e.posts_at && Date.parse(e.posts_at) <= now.getTime()
      ? ` · posted ${whenText(new Date(e.posts_at), now)}`
      : '';
  const state = stateOfSeries(r, now);
  switch (e.action) {
    case 'approved':
      return `Approved ${when}${by}${posted}`;
    case 'declined':
      return `Declined ${when}${by}${why} · nothing was scheduled${r.byName && !undone ? ` · ${r.byName} told in Chat` : ''}`;
    case 'cancelled': {
      // Never approved: a withdraw, also once it was undone and the series waits again.
      if (state === 'withdrawn' || !r.approvedAt)
        return `Withdrawn ${when}${by}${why} · nothing was scheduled`;
      const n = r.cancelledWindows.length;
      const gone = n ? ` · ${n} not started cancelled (${r.cancelledWindows.map(day).join(', ')})` : '';
      return `Series cancelled ${when}${by}${why}${undone ? '' : gone}`;
    }
    case 'not_approved':
      return `Not approved — nothing scheduled · nobody approved before the first window, ${r.firstStartsAt ? whenText(new Date(r.firstStartsAt), now) : '—'} · ask again on Maintenance & mutes`;
    case 'undone':
      return `Undone ${when}${by} — nothing was posted`;
    default:
      return null;
  }
}

export interface SeriesPageRow {
  series: SeriesRow;
  state: SeriesState;
  badge: Badge;
  /** The second badge: "Repeating" on a waiting series (§32.7). */
  tag: string | null;
  siteSub: string;
  when: string;
  whenSub: string;
  why: string;
  whySub: string;
  logs: string[];
  skips: string[];
  /** Approve / Decline (an Admin, a waiting series). */
  canApprove: boolean;
  /** "Cancel series…" or "Withdraw…", the one action (§32.5). */
  endLabel: string | null;
  note: string | null;
  /** The phone row's second line. */
  line: string;
  /** The phone sheet's facts (§32.9): Repeats · Each window · From · Ends · Next · Reason · By · Site. */
  facts: [string, string][];
}

/** The sheet's facts, from the row's own parts — never parsed back out of its sentences. */
function factsOf(row: SeriesPageRow, len: string, who: string): [string, string][] {
  const r = row.series;
  const next = row.state === 'repeating' ? r.upcoming[0] : undefined;
  return [
    ['Repeats', row.when],
    ['Each window', len],
    ['From', fromText(r)],
    ['Ends', r.untilOn ? bangkokDay(r.untilOn) : 'No end date'],
    ...(next ? ([['Next', day(next)]] as [string, string][]) : []),
    ['Reason', r.reason],
    ['By', who],
    ['Site', row.siteSub],
  ];
}

const ENDED_LABEL: Partial<Record<SeriesState, string>> = {
  cancelled: 'Cancelled',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  not_approved: 'Not approved',
  finished: 'Ended',
};

const mayAct = (r: SeriesRow, v: Viewer) =>
  v.role === 'admin' || (v.role === 'responder' && r.ownerIds.includes(v.id));

function whoNote(r: SeriesRow, v: Viewer): string | null {
  if (v.role === 'readonly') return null;
  const names = [!r.ownerIsAdmin && r.ownerName, !r.backupIsAdmin && r.backupName].filter(
    (n): n is string => !!n && n !== v.name,
  );
  return names.length ? `Only ${names.join(', ')} or an Admin` : 'Only an Admin';
}

export function seriesPageRow(
  r: SeriesRow,
  windows: readonly WindowRow[],
  v: Viewer,
  now: Date,
): SeriesPageRow {
  const state = stateOfSeries(r, now);
  const len = formatWindowLength(r.durationMin);
  const by = r.byName ?? 'someone';
  const asked = !!r.createdById && r.approvedById !== r.createdById;
  const askedWhen = formatWhen(new Date(r.createdAt), now, { midSentence: true });
  const when = seriesWhen(r);
  const base = `Series · ${len} · from ${fromText(r)} · ${untilText(r)}`;
  const logs = r.log
    .map((e, i) => seriesLogLine(r, e, now, r.log[i + 1]?.action === 'undone'))
    .filter((x): x is string => !!x);
  const row: SeriesPageRow = {
    series: r,
    state,
    badge: { tone: 'neutral', variant: 'outline', icon: 'rotate-ccw', label: 'Repeating' },
    tag: null,
    siteSub: [`Tier ${r.tier}`, r.ownerName, r.backupName && `backup ${r.backupName}`]
      .filter(Boolean)
      .join(' · '),
    when,
    whenSub: base,
    why: r.reason,
    whySub: '',
    logs,
    skips: [],
    canApprove: false,
    endLabel: null,
    note: null,
    line: '',
    facts: [],
  };
  if (state === 'waiting') {
    const who = `asked by ${by} · ${askedWhen}`;
    Object.assign(row, {
      badge: { tone: 'neutral', variant: 'outline', icon: 'clock', label: 'Needs approval' },
      tag: 'Repeating',
      whenSub: `${base} · first ${fromText(r)}`,
      whySub: who,
      line: `${when} · first ${fromText(r)} · ${by}`,
    });
    row.facts = factsOf(row, len, who);
    if (v.role === 'admin') row.canApprove = true;
    else {
      row.note = 'Waiting for an Admin';
      if (r.createdById === v.id) row.endLabel = 'Withdraw…';
    }
    return row;
  }
  if (state === 'repeating') {
    const next = r.upcoming[0];
    row.skips = skipNotes(r, windows, now);
    const who = `${asked ? `asked by ${by}` : `by ${by}`}${asked && r.approverName && r.approvedAt ? ` · approved by ${r.approverName} ${whenText(new Date(r.approvedAt), now)}` : ''}`;
    Object.assign(row, {
      whenSub: `${base}${next ? ` · next ${day(next)}` : ''}`,
      whySub: `${who} · not counted in uptime`,
      line: `${when}${next ? ` · next ${day(next)}` : ''}${row.skips.length ? ` · ${row.skips.length} skipped` : ''}`,
    });
    row.facts = factsOf(row, len, who);
    const asker = v.role === 'responder' && r.createdById === v.id;
    if (mayAct(r, v) || asker) row.endLabel = 'Cancel series…';
    else row.note = whoNote(r, v);
    return row;
  }
  // Ended (§32 7b): no skipped-window note, one log line, nothing to do.
  const label = ENDED_LABEL[state] ?? 'Ended';
  const neverRan = state === 'declined' || state === 'withdrawn';
  Object.assign(row, {
    badge: { tone: 'neutral', variant: 'outline', icon: 'rotate-ccw', label },
    whenSub:
      state === 'not_approved'
        ? `Series · ${len} · first window ${r.firstStartsAt ? whenText(new Date(r.firstStartsAt), now) : fromText(r)} · didn’t start`
        : neverRan
          ? `Series · ${len} · from ${fromText(r)} · nothing scheduled`
          : base,
    whySub: asked ? `asked by ${by} · ${askedWhen}` : `by ${by}`,
    logs: logs.slice(-1),
    line: `${when} · ${label.toLowerCase()}`,
  });
  row.facts = factsOf(row, len, row.whySub);
  return row;
}

/** When an ended series settled, for Recent's order and its 30 days. */
export const seriesSettledAt = (r: SeriesRow): number =>
  Date.parse(r.declinedAt ?? r.cancelledAt ?? (r.untilOn ? `${r.untilOn}T23:59:59+07:00` : r.createdAt));
