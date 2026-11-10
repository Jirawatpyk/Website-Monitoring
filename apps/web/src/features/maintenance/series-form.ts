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
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Today, in Bangkok. */
export const bangkokToday = bangkokDayOf;
/** From: today to a year ahead; Ends on: From to two years after it (§32.2, as the SQL allows). */
export const fromMax = (now: Date) => addDays(bangkokToday(now), 366);
export const untilMax = (from: string) => addDays(from, 366 * 2);

/** The monthly choice from the From date (§32.2): day N, or the Nth weekday (none for a 5th). */
export function monthOptions(from: string): { value: 'day' | 'nth'; label: string; description?: string }[] {
  const dom = Number(from.slice(8, 10));
  const nth = Math.ceil(dom / 7);
  const wd = isoWeekdayOf(from);
  return [
    {
      value: 'day',
      label: `Day ${dom} of each month`,
      ...(dom > 28 ? { description: `A month without day ${dom} is skipped.` } : {}),
    },
    ...(nth <= 4
      ? [{ value: 'nth' as const, label: `The ${ORDINAL[nth - 1]} ${LONG[wd - 1]} of each month` }]
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
}

const day = (d: Date) => formatDay(d, { weekday: true });
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function repeatPlanOf(i: RepeatInput): RepeatPlan {
  const rule = ruleOf(i);
  const daysError = i.repeat === 'weekly' && !i.days.length ? 'Pick at least one day.' : null;
  const untilError = i.untilOn && i.untilOn < i.from ? 'The last day is before the first.' : null;
  if (!rule || daysError)
    return { rule, daysError, untilError, summary: 'Pick at least one day.', blocked: true, next: [] };
  if (untilError)
    return {
      rule,
      daysError,
      untilError,
      summary: 'Fix Ends on — the last day is before the first.',
      blocked: true,
      next: [],
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
    };
  const words = capital(
    formatSeriesRule({ rule, startTime: i.time, durationMin: i.durationMin }, { length: false }),
  );
  const until = i.untilOn ? ` · until ${day(new Date(`${i.untilOn}T12:00:00+07:00`))}` : '';
  return {
    rule,
    daysError,
    untilError,
    summary: `${words} (UTC+7) · from ${day(next[0]!)}${until} · next ${next.length}: ${next.map(day).join(', ')}`,
    blocked: false,
    next,
  };
}

/** The success line (§32.2): an Admin's series with the windows made now; a Responder's request. */
export function seriesDoneOf(o: {
  site: string;
  waiting: boolean;
  windows: string[];
  admins: string[] | null | undefined;
  summary: string;
  /** Its first window by the rule: named when none is made yet (more than 14 days away). */
  first?: Date;
}): { title: string; text: string } {
  if (o.waiting) {
    const who = o.admins?.length ? o.admins.join(', ') : 'the Admins';
    return {
      title: `Series request sent to ${who} · ${o.site}`,
      text: `${o.summary.split(' · next')[0]}. Waiting for an Admin — nothing is scheduled until it’s approved. Withdraw it any time from Maintenance & mutes.`,
    };
  }
  const n = o.windows.length;
  const made = n
    ? `${n} window${n === 1 ? '' : 's'} scheduled now (${o.windows.map((w) => day(new Date(w))).join(', ')}); the rest are added 14 days ahead.`
    : `Its first window${o.first ? `, ${day(o.first)},` : ''} is added 14 days before it starts.`;
  return {
    title: `Series scheduled · ${o.site}`,
    text: `${made} Cancel it any time from Maintenance & mutes.`,
  };
}
