import { bangkokDayOf, isoWeekdayOf } from '@dxt/engine';
import {
  formatDay,
  formatResponseDays,
  HOLIDAY_KINDS as KINDS,
  minutesToClock,
  type HolidayKind,
  type ResponseHours,
} from '@dxt/shared';

/** A company holiday as stored (`company_holidays`): a Bangkok day, its name and its kind. */
export interface Holiday {
  id: string;
  /** `YYYY-MM-DD`, a Bangkok date. */
  day: string;
  name: string;
  kind: HolidayKind;
}

export type Hours = Pick<ResponseHours, 'startMin' | 'endMin' | 'days'>;

/** The Add dialog's choices, company first (the usual add); values mirror `company_holidays.kind`. */
export const HOLIDAY_KINDS = [
  { value: 'company', label: 'Company day off' },
  { value: 'public', label: 'Public holiday' },
] as const satisfies readonly { value: (typeof KINDS)[number]; label: string }[];

export const HOLIDAY_NAME_MAX = 100;

/** A Bangkok day as the instant of its midnight, for the §13 formatters. */
export const dayDate = (day: string) => new Date(`${day}T00:00:00+07:00`);

/** Today in Bangkok, `YYYY-MM-DD` (never the UTC date: 00:00–07:00 is still yesterday in UTC). */
export const bangkokToday = bangkokDayOf;

/** The last day the list and the SQL take: 31 Dec next year. */
export const lastHolidayDay = (now: Date) => `${Number(bangkokToday(now).slice(0, 4)) + 1}-12-31`;

const weekdayOf = isoWeekdayOf;
const daysWord = (h: Hours) => formatResponseDays(h.days);
const kindLabel = (k: Holiday['kind']) => HOLIDAY_KINDS.find((x) => x.value === k)!.label;

export interface HolidayRow {
  id: string;
  day: string;
  /** "Mon 7 Dec" */
  date: string;
  name: string;
  kind: Holiday['kind'];
  kindLabel: string;
  /** Not one of the response-hours days, so it changes nothing ("Weekend — no effect on Mon–Fri hours"). */
  offDay: boolean;
  sub: string | null;
}

export interface HolidayYear {
  year: string;
  /** "2026 · 7 left this year · 6 on weekdays" / "2027 · 17 days · 14 on weekdays" */
  head: string;
  rows: HolidayRow[];
  /** Under next year: the lunar holidays aren't announced yet. */
  note: string | null;
}

/**
 * The holiday list (board OrganisationLists): this year from today and the whole of next year, by
 * date. A day outside the response-hours days says it changes nothing; the counts and that line follow
 * the setting, not the board's Mon–Fri.
 */
export function holidayYears(holidays: readonly Holiday[], hours: Hours, now: Date): HolidayYear[] {
  const today = bangkokToday(now);
  const thisYear = today.slice(0, 4);
  const nextYear = String(Number(thisYear) + 1);
  const working = (h: Hours) =>
    h.days.length === 5 && h.days.every((d, i) => d === i + 1) ? 'weekdays' : 'working days';
  // This year and next always; any later year a row was written for (by SQL) too, so it can be removed.
  const later = holidays.map((h) => h.day.slice(0, 4)).filter((y) => y > nextYear);
  const years = [...new Set([thisYear, nextYear, ...later])].sort();
  return years.map((year) => {
    const rows = holidays
      .filter((h) => h.day.slice(0, 4) === year && h.day >= today)
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
      .map((h): HolidayRow => {
        const offDay = !hours.days.includes(weekdayOf(h.day));
        return {
          id: h.id,
          day: h.day,
          date: formatDay(dayDate(h.day), { weekday: true }),
          name: h.name,
          kind: h.kind,
          kindLabel: kindLabel(h.kind),
          offDay,
          sub: offDay ? `Weekend — no effect on ${daysWord(hours)} hours` : null,
        };
      });
    const on = rows.filter((r) => !r.offDay).length;
    return {
      year,
      head:
        year === thisYear
          ? `${year} · ${rows.length} left this year · ${on} on ${working(hours)}`
          : `${year} · ${rows.length} ${rows.length === 1 ? 'day' : 'days'} · ${on} on ${working(hours)}`,
      rows,
      note:
        year === nextYear
          ? `Makha Bucha, Visakha Bucha and Asanha Bucha ${year} follow the lunar calendar and aren’t announced yet — add them when the dates are announced.`
          : null,
    };
  });
}

/**
 * What removing a day turns it into (the Remove dialog). A day outside the hours changes nothing.
 * New calendars apply from the next engine run, open incidents included (D-069 item 2, as the hours).
 */
export function removeEffect(h: Pick<Holiday, 'day'>, hours: Hours): { title: string; body: string } {
  const date = formatDay(dayDate(h.day), { weekday: true, year: true });
  if (!hours.days.includes(weekdayOf(h.day)))
    return {
      title: `${date} stays a day off.`,
      body: `It isn’t one of the response-hours days (${daysWord(hours)}), so removing it changes no timer.`,
    };
  return {
    title: `${date} becomes a working day.`,
    body: `Tier 2–3 timers run ${minutesToClock(hours.startMin)}–${minutesToClock(hours.endMin)} and Tier 1 DOWN goes to the owner during those hours, the on-call person outside them. This applies within a minute, open incidents included; a PROBLEM already held keeps the time it was held until.`,
  };
}

/** "Mon 7 Dec is already Father’s Day (substitute)" — the Add dialog's taken-day line. */
export const takenLine = (day: string, name: string) =>
  `${formatDay(dayDate(day), { weekday: true })} is already ${name}`;
