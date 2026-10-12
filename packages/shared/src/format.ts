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
  second: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
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
    second: get('second'),
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "10:07" — 24-hour, Bangkok time. */
export function formatTime(date: Date): string {
  const p = bangkokParts(date);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "09:48:41" — with seconds, for confirmation times in alerts (ChatAlert board). */
export function formatTimeWithSeconds(date: Date): string {
  const p = bangkokParts(date);
  return `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
}

/** True when both instants fall on the same calendar day in Bangkok. */
export function isSameBangkokDay(a: Date, b: Date): boolean {
  const pa = bangkokParts(a);
  const pb = bangkokParts(b);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/** "25 Sep", "Fri 25 Sep" with `weekday`, "Fri 25 Sep 2026" with `year` too. Never zero-padded, never "Sept". */
export function formatDay(date: Date, options: { weekday?: boolean; year?: boolean } = {}): string {
  const p = bangkokParts(date);
  const day = `${p.day} ${MONTHS[p.month]}${options.year ? ` ${p.year}` : ''}`;
  return options.weekday ? `${WEEKDAYS[p.weekday]} ${day}` : day;
}

/**
 * When something happened, relative to `now` (spec §13): "Today 10:07", "Yesterday 16:40", else
 * "Mon 14 Sep 21:18". `midSentence` lower-cases Today / Yesterday ("OK since today 10:50").
 */
export function formatWhen(date: Date, now: Date, options: { midSentence?: boolean } = {}): string {
  const yesterday = new Date(now.getTime() - 86_400_000);
  const word = isSameBangkokDay(date, now) ? 'Today' : isSameBangkokDay(date, yesterday) ? 'Yesterday' : null;
  if (!word) return `${formatDay(date, { weekday: true })} ${formatTime(date)}`;
  return `${options.midSentence ? word.toLowerCase() : word} ${formatTime(date)}`;
}

/** Midnight in Bangkok at the start of `now`'s Bangkok day ("checks today", today's log). */
/** Bangkok is UTC+7 all year (no daylight saving). */
export const BANGKOK_OFFSET_MS = 7 * 3_600_000;

export function bangkokDayStart(now: Date): Date {
  const p = bangkokParts(now);
  return new Date(Date.UTC(p.year, p.month, p.day) - BANGKOK_OFFSET_MS);
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "September" — the Bangkok month a moment falls in (Resolve's "September uptime 99.98%"). */
export function formatMonth(date: Date): string {
  return MONTH_NAMES[bangkokParts(date).month]!;
}

/** Midnight in Bangkok on the 1st of `now`'s Bangkok month (month-to-date uptime). */
export function bangkokMonthStart(now: Date): Date {
  const p = bangkokParts(now);
  return new Date(Date.UTC(p.year, p.month, 1) - BANGKOK_OFFSET_MS);
}

/** "2,007" — counts with thousands separators. */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * How many minutes a drop lasted, in whole clock minutes so the number matches the range shown
 * (19:37–19:42 = 5 min), and at least 1 — a confirmed drop always lasted some time and "0 min" reads
 * as no outage. The one rule for every page and message (D-033).
 */
export function clockMinutes(start: Date, end: Date): number {
  const minute = (d: Date) => Math.floor(d.getTime() / 60_000);
  return Math.max(1, minute(end) - minute(start));
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

/** "Tao", "Arm and Tao", "you, Ploy and Tao": people named in a sentence (no serial comma). */
export function formatNameList(names: readonly string[]): string {
  return names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * A maintenance window's or mute's length (MaintenancePage, ChatAlert maintenance rows): whole days
 * past one as "3 days", a day as "24 h", else `formatDuration` ("2 h", "9 h 20 min", "1 d 2 h").
 */
export function formatWindowLength(totalMinutes: number): string {
  const m = Math.round(totalMinutes);
  if (m >= 1440 && m % 1440 === 0) return m === 1440 ? '24 h' : `${m / 1440} days`;
  return formatDuration(m);
}

/**
 * A short duration with seconds, for KPIs like MTTA (Main3): "18 s", "1 min 52 s", "6 min 40 s",
 * "15 min"; from an hour on it reads as `formatDuration` ("1 h 2 min").
 */
export function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds >= 3600) return formatDuration(seconds / 60);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} s`;
  return s > 0 ? `${m} min ${s} s` : `${m} min`;
}

/** A response time: "412 ms" under a second, then one decimal — "1.1 s", "5.8 s" (Main3). */
export function formatMs(ms: number): string {
  const rounded = Math.round(ms);
  if (rounded < 1000) return `${rounded} ms`;
  return `${(rounded / 1000).toFixed(1)} s`;
}

/** 0.999764 → "99.98%". Two decimals, rounded, the % sign inside the value (spec §5, §14.12). */
export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

/** "Tier 1" in prose and pills; "T1" only inside dense table cells. */
export function formatTier(tier: number, options: { short?: boolean } = {}): string {
  return options.short ? `T${tier}` : `Tier ${tier}`;
}

/** Incident number → "INC-0007" (D-013): at least 4 digits, zero-padded, never truncated. */
export function formatIncidentId(number: number): string {
  return `INC-${String(number).padStart(4, '0')}`;
}

/**
 * An open incident in one line, as the Sites list (spec §20) and Overview show it next to the status:
 * "INC-0142 · Escalated L1 · 18 min unacked", "INC-0141 · Acked by Ploy", "INC-0139 · Needs root cause";
 * an incident under a minute old reads "INC-0142 · unacked just now".
 */
export function formatIncidentLine(i: {
  number: number;
  state: 'unacked' | 'escalated' | 'acknowledged' | 'monitoring' | 'needs_root_cause';
  level: number;
  /** Minutes since the incident was detected. */
  minutesOpen: number;
  ackedBy: string | null;
}): string {
  const id = formatIncidentId(i.number);
  // under a minute "0 min" reads like a glitch (Tao, /verify S05c)
  const unacked = i.minutesOpen < 1 ? 'unacked just now' : `${formatDuration(i.minutesOpen)} unacked`;
  switch (i.state) {
    case 'unacked':
      return `${id} · ${unacked}`;
    case 'escalated':
      return `${id} · Escalated L${i.level} · ${unacked}`;
    case 'acknowledged':
      return i.ackedBy ? `${id} · Acked by ${i.ackedBy}` : `${id} · Acknowledged`;
    case 'monitoring':
      return `${id} · Monitoring`;
    case 'needs_root_cause':
      return `${id} · Needs root cause`;
  }
}

/**
 * The "Confirmed by" fact of a DOWN (ChatAlert / EmailAlert / the incident page): "3 locations, 2 checks";
 * behind a WAF where only some locations could vote (D-027), who confirmed it and who was blocked —
 * "BKK only, 2 checks — SIN, TYO blocked by bot protection".
 */
export function formatConfirmedBy(
  count: number,
  waf?: { from: readonly string[]; blocked: readonly string[] } | null,
): string {
  if (waf && waf.blocked.length && waf.from.length) {
    const from =
      waf.from.length === 1
        ? `${waf.from[0]} only`
        : `${waf.from.slice(0, -1).join(', ')} and ${waf.from.at(-1)}`;
    return `${from}, 2 checks — ${waf.blocked.join(', ')} blocked by bot protection`;
  }
  return `${formatLocations(count)}, 2 checks`;
}

/** "1 location", "3 locations". */
export function formatLocations(count: number): string {
  return `${count} location${count === 1 ? '' : 's'}`;
}

/** Who confirmed a DOWN behind a WAF and who it blocked, read back from an incident's context (D-027). */
export function confirmedByWafOf(
  ctx: Record<string, unknown> | null | undefined,
): { from: string[]; blocked: string[] } | null {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const from = list(ctx?.confirmingFrom);
  const blocked = list(ctx?.wafBlocked);
  return from.length && blocked.length ? { from, blocked } : null;
}
