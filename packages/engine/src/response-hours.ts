import { BANGKOK_OFFSET_MS, type ResponseHours } from '@dxt/shared';

/**
 * Response hours (spec §7, §14.14; PRD §4): Tier 2–3 escalation timers count only minutes inside
 * Mon–Fri 09:00–18:00 in Bangkok, skipping company holidays (D-034). An hour is [start, end): 18:00
 * is closed. Bangkok has no daylight saving, so a day is plain UTC+7 arithmetic.
 */

const MINUTE = 60_000;
const DAY = 86_400_000;
/** More than a year of closed days means the hours can never open (an empty `days` is refused in SQL). */
const MAX_DAYS = 400;

/** Midnight (as an instant) of the Bangkok day `at` falls in. */
function dayStart(at: Date): number {
  return Math.floor((at.getTime() + BANGKOK_OFFSET_MS) / DAY) * DAY - BANGKOK_OFFSET_MS;
}

function isWorkingDay(dayStartMs: number, hours: ResponseHours): boolean {
  const local = new Date(dayStartMs + BANGKOK_OFFSET_MS);
  const isoWeekday = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
  return hours.days.includes(isoWeekday) && !hours.holidays.has(local.toISOString().slice(0, 10));
}

/** The open interval of the Bangkok day starting at `dayStartMs`, or null on a closed day. */
function openOn(dayStartMs: number, hours: ResponseHours): { open: number; close: number } | null {
  if (!isWorkingDay(dayStartMs, hours)) return null;
  return { open: dayStartMs + hours.startMin * MINUTE, close: dayStartMs + hours.endMin * MINUTE };
}

export function isInsideHours(at: Date, hours: ResponseHours): boolean {
  const day = openOn(dayStart(at), hours);
  return day !== null && at.getTime() >= day.open && at.getTime() < day.close;
}

/** `at` itself when inside hours, else the next opening (Thu 22:14 → Fri 09:00). */
export function nextOpening(at: Date, hours: ResponseHours): Date {
  let day = dayStart(at);
  for (let i = 0; i < MAX_DAYS; i++, day += DAY) {
    const open = openOn(day, hours);
    if (!open || at.getTime() >= open.close) continue;
    return new Date(Math.max(at.getTime(), open.open));
  }
  throw new Error('response hours never open');
}

/**
 * The instant a timer started at `from` has run `minutes` inside response hours (INC-0139: Thu 22:14
 * + 15 → Fri 09:15). Landing exactly on closing time counts (17:45 + 15 = 18:00).
 */
export function addInsideMinutes(from: Date, minutes: number, hours: ResponseHours): Date {
  let left = minutes * MINUTE;
  let at = from.getTime();
  for (let i = 0; i < MAX_DAYS; i++) {
    const day = dayStart(new Date(at));
    const open = openOn(day, hours);
    if (open && at < open.close) {
      const start = Math.max(at, open.open);
      if (start + left <= open.close) return new Date(start + left);
      left -= open.close - start;
    }
    at = day + DAY;
  }
  throw new Error('response hours never open');
}

/** Minutes inside response hours between two instants (0 when `to` is not after `from`). */
export function minutesInsideHours(from: Date, to: Date, hours: ResponseHours): number {
  if (to.getTime() <= from.getTime()) return 0;
  let total = 0;
  for (let day = dayStart(from); day < to.getTime(); day += DAY) {
    const open = openOn(day, hours);
    if (!open) continue;
    const start = Math.max(open.open, from.getTime());
    const end = Math.min(open.close, to.getTime());
    if (end > start) total += end - start;
  }
  return total / MINUTE;
}
