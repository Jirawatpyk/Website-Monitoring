import type { SeriesRule } from '@dxt/shared';

/**
 * Repeating maintenance series (D-057, spec §32). The windows themselves are made in SQL
 * (`private.expand_series`: overlaps, the 5-min rule and the 14-day horizon); these are the pure rules
 * the page and the Schedule dialog need. `seriesMatches` mirrors `private.series_matches`.
 */

const DAY_MS = 86_400_000;
const BKK_OFFSET_MS = 7 * 3_600_000;

/** ISO weekday 1 (Mon) … 7 (Sun) of a Bangkok day "2026-09-29". */
const isoWeekday = (day: string) => ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Whether a Bangkok calendar day matches the rule. A month without day N never matches it. */
export function seriesMatches(rule: SeriesRule, day: string): boolean {
  if (rule.freq === 'weekly') return rule.days.includes(isoWeekday(day));
  const dom = Number(day.slice(8, 10));
  if ('day' in rule) return dom === rule.day;
  return isoWeekday(day) === rule.weekday && Math.floor((dom - 1) / 7) + 1 === rule.nth;
}

/** The instant a Bangkok day's wall-clock time falls on ("01:00" or "01:00:00"). */
export function bangkokStart(day: string, startTime: string): Date {
  const [h = 0, m = 0] = startTime.split(':').map(Number);
  return new Date(Date.parse(`${day}T00:00:00Z`) + (h * 60 + m) * 60_000 - BKK_OFFSET_MS);
}

const bangkokDay = (d: Date) => new Date(d.getTime() + BKK_OFFSET_MS).toISOString().slice(0, 10);

export interface SeriesSchedule {
  rule: SeriesRule;
  startTime: string;
  /** Bangkok days; `untilOn` null = no end. */
  startsOn: string;
  untilOn: string | null;
}

/**
 * The next `n` starts by the rule, at least 5 min after `now` — for the dialog's summary ("next 2: …")
 * before anything is saved. Overlaps and the 14-day horizon are SQL's; never word the windows made from this.
 */
export function nextOccurrences(s: SeriesSchedule, n: number, now: Date, horizonDays = 400): Date[] {
  const out: Date[] = [];
  const first = s.startsOn > bangkokDay(now) ? s.startsOn : bangkokDay(now);
  const start = Date.parse(`${first}T00:00:00Z`);
  for (let i = 0; i <= horizonDays && out.length < n; i++) {
    const day = new Date(start + i * DAY_MS).toISOString().slice(0, 10);
    if (s.untilOn && day > s.untilOn) break;
    if (!seriesMatches(s.rule, day)) continue;
    const at = bangkokStart(day, s.startTime);
    if (at.getTime() >= now.getTime() + 5 * 60_000) out.push(at);
  }
  return out;
}

export type SeriesState =
  'waiting' | 'repeating' | 'finished' | 'cancelled' | 'withdrawn' | 'declined' | 'not_approved';

export interface SeriesFacts {
  approvedAt: string | null;
  declinedAt: string | null;
  cancelledAt: string | null;
  outcome: string | null;
  untilOn: string | null;
}

/**
 * Where a series stands (§32.4–7, 7b). Not approved, withdrawn and cancelled all set `cancelled_at`:
 * not approved has the outcome, withdrawn was never approved. A series past its last day is finished.
 */
export function seriesStateOf(s: SeriesFacts, now: Date): SeriesState {
  if (s.outcome === 'not_approved') return 'not_approved';
  if (s.declinedAt) return 'declined';
  if (s.cancelledAt) return s.approvedAt ? 'cancelled' : 'withdrawn';
  if (!s.approvedAt) return 'waiting';
  if (s.untilOn && s.untilOn < bangkokDay(now)) return 'finished';
  return 'repeating';
}
