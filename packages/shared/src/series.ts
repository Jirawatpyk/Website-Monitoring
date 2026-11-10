import { z } from 'zod';
import { formatWindowLength } from './format';

/**
 * A repeating maintenance series' rule (D-057), as `maintenance_series.rule` stores it and
 * `valid_series_rule` checks it: weekly on ISO weekdays (1 = Mon … 7 = Sun), or monthly on day N or
 * the 1st–4th weekday. Days and times are Bangkok wall-clock.
 */
const isoDay = z.number().int().min(1).max(7);
export const seriesRuleSchema = z.union([
  z
    .object({
      freq: z.literal('weekly'),
      days: z
        .array(isoDay)
        .min(1)
        .max(7)
        .refine((d) => new Set(d).size === d.length, 'a day twice'),
    })
    .strict(),
  z.object({ freq: z.literal('monthly'), day: z.number().int().min(1).max(31) }).strict(),
  z.object({ freq: z.literal('monthly'), nth: z.number().int().min(1).max(4), weekday: isoDay }).strict(),
]);
export type SeriesRule = z.infer<typeof seriesRuleSchema>;

const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ORDINAL = ['1st', '2nd', '3rd', '4th'];

/** "every Tue", "every Mon, Thu", "every day", "monthly on day 6", "monthly on the 4th Saturday" (ChatAlert). */
export function seriesRepeatText(rule: SeriesRule): string {
  if (rule.freq === 'weekly') {
    if (rule.days.length === 7) return 'every day';
    return `every ${[...rule.days]
      .sort((a, b) => a - b)
      .map((d) => SHORT[d - 1])
      .join(', ')}`;
  }
  if ('day' in rule) return `monthly on day ${rule.day}`;
  return `monthly on the ${ORDINAL[rule.nth - 1]} ${LONG[rule.weekday - 1]}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "01:00 → 03:00", or "22:00 → 02:00 next day" — `startTime` as Postgres `time` gives it ("01:00:00"). */
export function seriesTimeText(startTime: string, durationMin: number): string {
  const [h = 0, m = 0] = startTime.split(':').map(Number);
  const start = h * 60 + m;
  const end = start + durationMin;
  const clock = (x: number) => `${pad(Math.floor((x % 1440) / 60))}:${pad(x % 60)}`;
  return `${clock(start)} → ${clock(end)}${end >= 1440 ? ' next day' : ''}`;
}

export interface SeriesShape {
  rule: SeriesRule;
  startTime: string;
  durationMin: number;
}

/**
 * The rule with its window: "every Tue 01:00 → 03:00 (2 h)", "monthly on day 6 · 20:00 → 22:00 (2 h)"
 * (the monthly words end on a number, so a dot keeps the time apart). `length: false` drops "(2 h)".
 */
export function formatSeriesRule(s: SeriesShape, options: { length?: boolean } = {}): string {
  const sep = s.rule.freq === 'weekly' ? ' ' : ' · ';
  const length = options.length === false ? '' : ` (${formatWindowLength(s.durationMin)})`;
  return `${seriesRepeatText(s.rule)}${sep}${seriesTimeText(s.startTime, s.durationMin)}${length}`;
}
