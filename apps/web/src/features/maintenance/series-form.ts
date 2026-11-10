import { bangkokDayOf, isoWeekdayOf, nextOccurrences } from '@dxt/engine';
import { formatDay, formatSeriesRule, type SeriesRule } from '@dxt/shared';

/**
 * The Schedule dialog's Repeat (boards Maintenance STATE › Weekly · Admin / Monthly · Admin / Weekly ·
 * Responder, MMaintenance; spec §32.2–3; D-057). Pure: what the fields mean and what the summary says.
 * The windows themselves are made in SQL — this only previews the next two.
 */

export type Repeat = 'none' | 'weekly' | 'monthly';
export const REPEATS: { value: Repeat; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];
/** A series' window lengths: no "3 days" (each window ≤ 24 h, §32.2). */
export const SERIES_DURATIONS = [
  { label: '1 h', minutes: 60 },
  { label: '2 h', minutes: 120 },
  { label: '4 h', minutes: 240 },
  { label: '8 h', minutes: 480 },
  { label: '24 h', minutes: 1440 },
];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th'];

export interface RepeatInput {
  repeat: Exclude<Repeat, 'none'>;
  /** Bangkok days "2026-09-29"; `untilOn` null = No end date. */
  from: string;
  untilOn: string | null;
  /** "01:00". */
  time: string;
  durationMin: number;
  /** ISO weekdays 1 (Mon) … 7 (Sun). */
  days: number[];
  monthMode: 'day' | 'nth';
  now: Date;
}

export { isoWeekdayOf };
/** Today, in Bangkok. */
export const bangkokToday = bangkokDayOf;
/** The same date n years on; 29 Feb falls back to 28 Feb in a year without it. */
const addYears = (day: string, n: number) => {
  const out = `${Number(day.slice(0, 4)) + n}${day.slice(4)}`;
  return new Date(`${out}T00:00:00Z`).toISOString().slice(0, 10) === out ? out : `${out.slice(0, 8)}28`;
};
/** From: today to a year ahead; Ends on: From to two years after it (§32.2; the SQL allows a day or two more). */
export const fromMax = (now: Date) => addYears(bangkokToday(now), 1);
export const untilMax = (from: string) => addYears(from, 2);

/** The monthly choice from the From date (§32.2): day N, or the Nth weekday (none for a 5th). */
export function monthOptions(from: string): { value: 'day' | 'nth'; label: string; description: string }[] {
  const dom = Number(from.slice(8, 10));
  const nth = Math.ceil(dom / 7);
  const wd = isoWeekdayOf(from);
  return [
    {
      value: 'day',
      label: `Day ${dom} of each month`,
      description:
        dom > 28 ? `Same date every month. A month without day ${dom} is skipped.` : 'Same date every month.',
    },
    ...(nth <= 4
      ? [
          {
            value: 'nth' as const,
            label: `The ${ORDINAL[nth - 1]} ${LONG[wd - 1]} of each month`,
            description: 'Same weekday every month.',
          },
        ]
      : []),
  ];
}

export function ruleOf(i: RepeatInput): SeriesRule | null {
  if (i.repeat === 'weekly')
    return i.days.length ? { freq: 'weekly', days: [...i.days].sort((a, b) => a - b) } : null;
  const dom = Number(i.from.slice(8, 10));
  const nth = Math.ceil(dom / 7);
  if (i.monthMode === 'nth' && nth <= 4) return { freq: 'monthly', nth, weekday: isoWeekdayOf(i.from) };
  return { freq: 'monthly', day: dom };
}

export interface RepeatPlan {
  rule: SeriesRule | null;
  /** The field errors, as the board words them. */
  daysError: string | null;
  untilError: string | null;
  /** "Every Tue 01:00 → 03:00 (UTC+7) · from Tue 29 Sep · next 2: Tue 29 Sep, Tue 6 Oct", or what to fix. */
  summary: string;
  /** Submit stays off (§32.2). */
  blocked: boolean;
  /** The windows the summary names. */
  next: Date[];
  /** "Every Tue 01:00 → 03:00" (the success line). */
  words: string;
}

/** "Tue 29 Sep", with the year when it isn’t this year's (Ends on can be two years out). */
const dayIn = (now: Date) => (d: Date) =>
  formatDay(d, { weekday: true, year: d.getUTCFullYear() !== now.getUTCFullYear() });
const day = (d: Date) => formatDay(d, { weekday: true });
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function repeatPlanOf(i: RepeatInput): RepeatPlan {
  const rule = ruleOf(i);
  const daysError = i.repeat === 'weekly' && !i.days.length ? 'Pick at least one day.' : null;
  const untilError = !i.untilOn
    ? null
    : i.untilOn < i.from
      ? 'The last day is before the first.'
      : i.untilOn > untilMax(i.from)
        ? 'Pick a day up to two years after the first.'
        : null;
  const none = { next: [], words: '' };
  if (!rule || daysError)
    return { rule, daysError, untilError, summary: 'Pick at least one day.', blocked: true, ...none };
  if (untilError)
    return {
      rule,
      daysError,
      untilError,
      summary: `Fix Ends on — ${untilError.charAt(0).toLowerCase()}${untilError.slice(1)}`,
      blocked: true,
      ...none,
    };
  const next = nextOccurrences({ rule, startTime: i.time, startsOn: i.from, untilOn: i.untilOn }, 2, i.now);
  if (!next.length)
    return {
      rule,
      daysError,
      untilError,
      summary: 'No window falls between those days — at least 5 min from now.',
      blocked: true,
      next,
      words: '',
    };
  const words = capital(
    formatSeriesRule({ rule, startTime: i.time, durationMin: i.durationMin }, { length: false }),
  );
  const d = dayIn(i.now);
  // "· no end date" or "· until Tue 29 Dec" (§32.2).
  const until = i.untilOn ? ` · until ${d(new Date(`${i.untilOn}T12:00:00+07:00`))}` : ' · no end date';
  return {
    rule,
    daysError,
    untilError,
    summary: `${words} (UTC+7) · from ${d(next[0]!)}${until} · next ${next.length}: ${next.map(d).join(', ')}`,
    blocked: false,
    next,
    words,
  };
}

/** The success line (§32.2, board Maintenance): the rule, the first day, what was made, the audit and the reason. */
export function seriesDoneOf(o: {
  site: string;
  waiting: boolean;
  windows: string[];
  admins: string[] | null | undefined;
  /** "Every Tue 01:00 → 03:00". */
  words: string;
  /** Its first window by the rule. */
  first?: Date;
  reason: string;
  viewer: string;
}): { title: string; text: string } {
  const head = `${o.words}${o.first ? ` · from ${day(o.first)}` : ''}`;
  const why = `Reason: “${o.reason.trim()}”.`;
  if (o.waiting) {
    const who = o.admins?.length ? o.admins.join(', ') : 'the Admins';
    return {
      title: `Series request sent to ${who} · ${o.site}`,
      text: `${head} · waiting for an Admin — nothing is scheduled until it’s approved. Recorded in the audit log as ${o.viewer}. ${why} Follow it under Waiting for approval on Maintenance & mutes.`,
    };
  }
  const n = o.windows.length;
  const made = n
    ? `${n} window${n === 1 ? '' : 's'} scheduled now (${o.windows.map((w) => day(new Date(w))).join(', ')})`
    : 'no window in the next 14 days yet';
  return {
    title: `Series scheduled · ${o.site}`,
    text: `${head} · ${made}; the rest are added 14 days ahead · not counted in uptime · recorded in the audit log as ${o.viewer}. ${why} Cancel the series, or edit or cancel one window, on Maintenance & mutes (sidebar › Maintenance).`,
  };
}
