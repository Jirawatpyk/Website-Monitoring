/**
 * Display formats (spec §13). Data is stored in UTC; everything shown to people is Asia/Bangkok.
 * Month names are hand-written because some ICU builds print "Sept", which the spec forbids.
 */

export const DISPLAY_TIME_ZONE = 'Asia/Bangkok';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface BangkokParts {
  year: number;
  month: number; // 0-11
  day: number;
  weekday: number; // 0 = Sunday
  hour: number;
  minute: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

function bangkokParts(date: Date): BangkokParts {
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(partsFormatter.formatToParts(date).find((p) => p.type === type)?.value);
  const year = get('year');
  const month = get('month') - 1;
  const day = get('day');
  return {
    year,
    month,
    day,
    weekday: new Date(Date.UTC(year, month, day)).getUTCDay(),
    hour: get('hour'),
    minute: get('minute'),
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "10:07" — 24-hour, Bangkok time. */
export function formatTime(date: Date): string {
  const p = bangkokParts(date);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "25 Sep", or "Fri 25 Sep" with `weekday`. Never zero-padded, never "Sept". */
export function formatDay(date: Date, options: { weekday?: boolean } = {}): string {
  const p = bangkokParts(date);
  const day = `${p.day} ${MONTHS[p.month]}`;
  return options.weekday ? `${WEEKDAYS[p.weekday]} ${day}` : day;
}

/** "43 min", "1 h 2 min", "2 h", "1 d 2 h". Minutes are dropped once a duration reaches a day. */
export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.floor(totalMinutes));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

/** 0.999764 → "99.98%". Two decimals, rounded, the % sign inside the value (spec §5, §14.12). */
export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

/** "Tier 1" in prose and pills; "T1" only inside dense table cells. */
export function formatTier(tier: number, options: { short?: boolean } = {}): string {
  return options.short ? `T${tier}` : `Tier ${tier}`;
}
