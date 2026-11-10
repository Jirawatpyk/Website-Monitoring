import { nextOccurrences, seriesStateOf, type SeriesState } from '@dxt/engine';
import {
  formatDay,
  formatNameList,
  formatSeriesRule,
  formatTime,
  formatTimeWithSeconds,
  formatWhen,
  formatWindowLength,
  isSameBangkokDay,
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
  /** The windows its approval made ("4 windows created, to Thu 8 Oct" on the APPROVED line). */
  approvalWindows?: string[];
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

const OVERLAP = 'overlaps another window';

/**
 * The skipped-window notes, for the overlaps still ahead (§32.8; D-057 amended: Claude's reading) — "Skipped
 * Tue 6 Oct — overlaps the 18:00 → 23:00 window (Data-centre move)". A window too close to start is named on
 * the APPROVED line instead (D-057). An ended series has none (§32 7b).
 */
export function skipNotes(r: SeriesRow, windows: readonly WindowRow[], now: Date): string[] {
  return r.log
    .filter(
      (e) =>
        e.action === 'skipped' &&
        e.reason === OVERLAP &&
        e.starts_at &&
        Date.parse(e.starts_at) > now.getTime(),
    )
    .map((e) => {
      const start = new Date(e.starts_at!);
      const o = overlapOf(start, r, windows);
      if (!o) return `Skipped ${day(e.starts_at!)} — overlaps another window on this site`;
      const span = `${whenText(new Date(o.startsAt), start)} → ${whenText(new Date(o.endedAt ?? o.endsAt), start)}`;
      return `Skipped ${day(e.starts_at!)} — overlaps the ${span} window (${o.reason})`;
    });
}

/** The series' own log, in words (§32.6, 7a, 7b); lines it doesn't word (created, requested, skipped) stay out. */
function seriesLogLine(
  r: SeriesRow,
  e: LogEntry,
  now: Date,
  undone: boolean,
  latest: boolean,
): string | null {
  const when = whenText(new Date(e.at), now);
  const by = e.by ? ` by ${e.by}` : '';
  const why = e.reason ? ` · “${e.reason}”` : '';
  const posted = !undone && e.posts_at && Date.parse(e.posts_at) <= now.getTime();
  const state = stateOfSeries(r, now);
  switch (e.action) {
    case 'approved': {
      // Board: "Approved 10:07 by Tao · 4 windows created, to Thu 8 Oct · Arm told in Chat (posted 10:07:10)";
      // a window under 5 min away is named here, not as a skipped note (D-057).
      const made = latest && !undone ? (r.approvalWindows ?? []) : [];
      const tooClose = undone
        ? []
        : r.log.filter(
            (x) =>
              x.action === 'skipped' &&
              x.reason !== OVERLAP &&
              x.starts_at &&
              Math.abs(Date.parse(x.at) - Date.parse(e.at)) < 60_000,
          );
      const asker = r.byName && r.createdById !== r.approvedById ? r.byName : null;
      return [
        `Approved ${when}${by}`,
        ...(made.length
          ? [`${plural(made.length, 'window')} created, to ${day(made[made.length - 1]!)}`]
          : []),
        ...tooClose.map((x) => `${day(x.starts_at!)} too close to start, not created`),
        // An undone action keeps its line as it was (§32 7a). The windows an undone approval made are
        // deleted with it, so only its count can't be shown.
        ...(asker ? [`${asker} told in Chat`] : []),
      ]
        .join(' · ')
        .concat(posted ? ` (posted ${formatTimeWithSeconds(new Date(e.posts_at!))})` : '');
    }
    case 'declined':
      return `Declined ${when}${by}${why} · nothing was scheduled${r.byName ? ` · ${r.byName} told in Chat` : ''}`;
    case 'cancelled': {
      // Never approved: a withdraw, also once it was undone and the series waits again.
      if (state === 'withdrawn' || !r.approvedAt)
        return `Withdrawn ${when}${by}${why} · nothing was scheduled`;
      // Undone, its windows are back: the ones it took are those still to start that were then ahead.
      const took = undone ? r.upcoming.filter((s) => Date.parse(s) > Date.parse(e.at)) : r.cancelledWindows;
      const gone = took.length
        ? ` · ${took.length} not started cancelled (${took.map(day).join(', ')})`
        : ' · none scheduled';
      return `Series cancelled ${when}${by}${why}${gone}`;
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
  /** The phone row's second badge when `tag` is empty: "Series" on an ended series (§32 7b). */
  phoneTag: string | null;
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
  /**
   * The phone sheet's facts (§32.9): Repeats · Each window · From · Ends · Next · Reason · By (Asked by) ·
   * Site; an ended series: Repeats · Reason · Asked by / By (§32 7b).
   */
  facts: [string, string][];
}

type Fact = [string, string];

/** The sheet's facts, from the row's own parts — never parsed back out of its sentences. */
function factsOf(row: SeriesPageRow, len: string, by: Fact, next: string | null): Fact[] {
  const r = row.series;
  // Ended (MMaintenanceList): Repeats carries where it stopped — "· from Sat 26 Sep" (declined /
  // withdrawn), "· first Sat 19 Sep" (not approved).
  if (row.state !== 'waiting' && row.state !== 'repeating') {
    const where =
      row.state === 'not_approved'
        ? ` · first ${fromText(r)}`
        : row.state === 'declined' || row.state === 'withdrawn'
          ? ` · from ${fromText(r)}`
          : '';
    return [['Repeats', `${row.when}${where}`], ['Reason', r.reason], by];
  }
  return [
    ['Repeats', row.when],
    ['Each window', `${len} · not counted in uptime`],
    ['From', fromText(r)],
    ['Ends', r.untilOn ? bangkokDay(r.untilOn) : 'No end date'],
    ['Next', next ?? '—'],
    ['Reason', r.reason],
    by,
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

/** "approved by Tao Mon 14 Sep" (§32.4) — the time only when it was today. */
function approvedText(r: SeriesRow, now: Date): string {
  if (!r.approverName || !r.approvedAt) return '';
  const at = new Date(r.approvedAt);
  return ` · approved by ${r.approverName} ${isSameBangkokDay(at, now) ? formatTime(at) : formatDay(at, { weekday: true })}`;
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
  const askedWhen = formatWhen(new Date(r.createdAt), now, {
    midSentence: true,
  });
  const when = seriesWhen(r);
  const base = `Series · ${len} · from ${fromText(r)} · ${untilText(r)}`;
  const lastApproval = r.log.map((e) => e.action).lastIndexOf('approved');
  const logs = r.log
    .map((e, i) => seriesLogLine(r, e, now, r.log[i + 1]?.action === 'undone', i === lastApproval))
    .filter((x): x is string => !!x);
  const row: SeriesPageRow = {
    series: r,
    state,
    badge: {
      tone: 'neutral',
      variant: 'outline',
      icon: 'rotate-ccw',
      label: 'Repeating',
    },
    tag: null,
    phoneTag: null,
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
    Object.assign(row, {
      badge: {
        tone: 'neutral',
        variant: 'outline',
        icon: 'clock',
        label: 'Needs approval',
      },
      tag: 'Repeating',
      whenSub: `${base} · first ${fromText(r)}`,
      whySub: `asked by ${by} · ${askedWhen}`,
      line: `${when} · first ${fromText(r)} · ${by}`,
    });
    // Nothing is made before approval: Next is its first window (MMaintenanceList).
    row.facts = factsOf(row, len, ['Asked by', `${by} · ${askedWhen}`], fromText(r));
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
    const who = `${by}${asked ? approvedText(r, now) : ''}`;
    Object.assign(row, {
      whenSub: `${base}${next ? ` · next ${day(next)}` : ''}`,
      whySub: `by ${who} · not counted in uptime`,
      line: `${when}${next ? ` · next ${day(next)}` : ''}${row.skips.length ? ` · ${row.skips.length} skipped` : ''}`,
    });
    row.facts = factsOf(row, len, ['By', who], next ? day(next) : null);
    const asker = v.role === 'responder' && r.createdById === v.id;
    if (mayAct(r, v) || asker) row.endLabel = 'Cancel series…';
    else row.note = whoNote(r, v);
    return row;
  }
  // Ended (§32 7b): no skipped-window note, one log line, nothing to do; "Series" tag on phones.
  const label = ENDED_LABEL[state] ?? 'Ended';
  const neverRan = state === 'declined' || state === 'withdrawn';
  Object.assign(row, {
    badge: { tone: 'neutral', variant: 'outline', icon: 'rotate-ccw', label },
    phoneTag: 'Series',
    whenSub:
      state === 'not_approved'
        ? `Series · ${len} · first window ${r.firstStartsAt ? whenText(new Date(r.firstStartsAt), now) : fromText(r)} · didn’t start`
        : neverRan
          ? `Series · ${len} · from ${fromText(r)} · nothing scheduled`
          : base,
    whySub: asked ? `asked by ${by} · ${askedWhen}` : `by ${by}`,
    logs: logs.slice(-1),
    // Phone row (MMaintenanceList): "Every Sat 22:00 → 23:00 · declined"; not approved: "· nothing scheduled".
    line: `${when} · ${state === 'not_approved' ? 'nothing scheduled' : label.toLowerCase()}`,
  });
  row.facts = factsOf(row, len, asked ? ['Asked by', `${by} · ${askedWhen}`] : ['By', by], null);
  return row;
}

/** When an ended series settled, for Recent's order and its 30 days. */
export const seriesSettledAt = (r: SeriesRow): number =>
  Date.parse(r.declinedAt ?? r.cancelledAt ?? (r.untilOn ? `${r.untilOn}T23:59:59+07:00` : r.createdAt));

// ── The series dialogs' words (MaintenancePage STATE › Approve series / Cancel series; §32.6–7, 7a) ──

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
/** Windows are made this far ahead (D-057). */
const HORIZON_MS = 14 * 86_400_000;

/** Owner and backup, minus the person acting (they get the series' email, §32.11). */
function emailedOf(r: SeriesRow, viewer: string): string[] {
  return [...new Set([r.ownerName, r.backupName].filter((n): n is string => !!n && n !== viewer))];
}

/** "Arm and Ploy get an email" / "Ploy gets an email". */
const emailText = (to: string[]) => `${formatNameList(to)} ${to.length === 1 ? 'gets' : 'get'} an email`;

/** The dialogs' description: "Every Mon, Thu 22:00 → 23:00 · Plugin updates · asked by Arm". */
export function seriesDescription(r: SeriesRow): string {
  // Board: "asked by Arm" while it waits, "by Ploy" once approved.
  return `${seriesWhen(r)} · ${r.reason} · ${r.approvedAt ? 'by' : 'asked by'} ${r.byName ?? 'someone'}`;
}

/**
 * The windows an approval makes now: every start of the rule inside the 14 days (a daily series makes
 * 14, not the board's sample four; overlaps are SQL's).
 */
export function approvalPreview(r: SeriesRow, now: Date): Date[] {
  const rule = ruleOf(r);
  if (!rule) return [];
  return nextOccurrences(
    { rule, startTime: r.startTime, startsOn: r.startsOn, untilOn: r.untilOn },
    15,
    now,
  ).filter((d) => d.getTime() <= now.getTime() + HORIZON_MS);
}

/** Approve series (§32.7, board): the rule, the first windows, what each does, who hears. */
export function approveSeriesEffects(r: SeriesRow, viewer: string, now: Date): string[] {
  const first = approvalPreview(r, now);
  const len = formatWindowLength(r.durationMin);
  const told = formatNameList([
    ...new Set([r.byName, r.ownerName, r.backupName, viewer].filter((n): n is string => !!n)),
  ]);
  const to = emailedOf(r, viewer);
  const asker = r.byName && r.byName !== viewer ? r.byName : null;
  const who = [
    ...(asker ? [`${asker} gets a Chat message`] : []),
    ...(to.length ? [asker ? `${formatNameList(to)} an email` : emailText(to)] : []),
  ];
  return [
    `${seriesWhen(r)} (${len}), from ${fromText(r)}, ${untilText(r)}. ${r.siteName} is Tier ${r.tier}.`,
    `Windows are created 14 days ahead — ${
      first.length
        ? `the first ${first.length} now: ${first.map((d) => day(d.toISOString())).join(', ')}`
        : 'none falls in the next 14 days, so none is made now'
    }. One that overlaps another window on this site is skipped and noted on the series.`,
    `Each one: no alerts, checks still run, not counted in uptime. It doesn’t start if the site is DOWN or has an open incident — ${told} ${told.includes(' and ') ? 'are' : 'is'} told.`,
    `You approve the series once; its windows don’t ask again. ${
      who.length
        ? `${who.join(', ')}, and the Alerts Space one line for the series.`
        : 'The Alerts Space gets one line for the series.'
    } Logged in the audit log as ${viewer}.`,
  ];
}

/** Decline series (§32.7): nothing is made; the asker hears in Chat, owner and backup by email (§32.11). */
export function declineSeriesEffects(r: SeriesRow, viewer: string): string[] {
  const to = emailedOf(r, viewer);
  return [
    'Nothing is scheduled; the request moves to Recent as Declined.',
    `${r.byName ?? 'The asker'} gets your reason in a Chat message${to.length ? `; ${emailText(to)}` : ''}. Logged in the audit log as ${viewer}.`,
  ];
}

/** Cancel series (§32.6) or the asker's Withdraw (§32.7). */
export function endSeriesEffects(r: SeriesRow, viewer: string, withdraw: boolean): string[] {
  const logged = `Logged in the audit log as ${viewer}.`;
  if (withdraw)
    return [
      'Nothing was scheduled, so nothing is cancelled.',
      `The Admins get an email; the Alerts Space gets one line. ${logged}`,
    ];
  const n = r.upcoming.length;
  const days = r.upcoming.map(day).join(', ');
  const to = emailedOf(r, viewer);
  return [
    `${
      n === 0
        ? 'No occurrence is scheduled yet.'
        : n === 1
          ? `Cancels the occurrence that hasn’t started (${days}).`
          : `Cancels the ${n} occurrences that haven’t started (${days}).`
    } ${r.running ? 'One that is running finishes.' : 'Nothing is running now.'}`,
    'No new windows are created. Past ones stay under Recent.',
    `${to.length ? `${emailText(to)}; the Alerts Space gets one line for the series.` : 'The Alerts Space gets one line for the series.'} ${logged}`,
  ];
}

export type SeriesAction = 'approved' | 'declined' | 'withdrawn' | 'cancelled';

/** A series action's toast (§32 7a): its title, what Undo says, and the Too late line. */
export function seriesToast(
  r: SeriesRow,
  action: SeriesAction,
  windows: number,
): {
  title: string;
  undone: { title: string; text: string };
  late: (postedAt: string) => string;
} {
  const site = r.siteName;
  const posted = (at: string) => `posted ${formatTimeWithSeconds(new Date(at))}`;
  const waitingAgain = 'Nothing was posted. It’s waiting for approval again.';
  switch (action) {
    case 'approved':
      return {
        title: `${site} series approved · ${plural(windows, 'window')} scheduled`,
        undone: {
          title: `${site} series approval undone`,
          text: 'Nothing was posted and no windows were scheduled. It’s waiting for approval again.',
        },
        late: (at) => `${site} series approved — ${posted(at)}. To take it back, cancel the series.`,
      };
    case 'declined':
      return {
        title: `${site} series declined`,
        undone: {
          title: `${site} series declined — undone`,
          text: waitingAgain,
        },
        late: (at) => `${site} series declined — ${posted(at)}. ${r.byName ?? 'The asker'} can ask again.`,
      };
    case 'withdrawn':
      return {
        title: `${site} series request withdrawn`,
        undone: {
          title: `${site} series request withdrawn — undone`,
          text: waitingAgain,
        },
        late: (at) => `${site} series request withdrawn — ${posted(at)}. To go ahead, ask again.`,
      };
    case 'cancelled':
      return {
        title: windows
          ? `${site} series cancelled · ${plural(windows, 'window')} cancelled`
          : `${site} series cancelled`,
        undone: {
          title: `${site} series cancelled — undone`,
          text: `Nothing was posted. ${
            windows === 0
              ? 'The series is back.'
              : windows === 1
                ? 'The series and its window are back.'
                : `The series and its ${windows} windows are back.`
          }`,
        },
        late: (at) => `${site} series cancelled — ${posted(at)}. To repeat it, make a new series.`,
      };
  }
}
