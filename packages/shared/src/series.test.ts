import { describe, expect, it } from 'vitest';
import {
  formatSeriesRule,
  seriesRepeatText,
  seriesRuleSchema,
  seriesTimeText,
  type SeriesShape,
} from './series';

// Spec §32 / ChatAlert "Maintenance · repeating series" (made-up sample, the words are the board's).
describe('series rule words (spec §32.10)', () => {
  it.each([
    [{ freq: 'weekly', days: [2] }, 'every Tue'],
    [{ freq: 'weekly', days: [4, 1] }, 'every Mon, Thu'],
    [{ freq: 'weekly', days: [7, 6] }, 'every Sat, Sun'],
    [{ freq: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] }, 'every day'],
    [{ freq: 'monthly', day: 6 }, 'monthly on day 6'],
    [{ freq: 'monthly', nth: 4, weekday: 6 }, 'monthly on the 4th Saturday'],
    [{ freq: 'monthly', nth: 1, weekday: 1 }, 'monthly on the 1st Monday'],
  ] as const)('%j repeats "%s"', (rule, words) => {
    expect(seriesRepeatText(seriesRuleSchema.parse(rule))).toBe(words);
  });

  it('words the window time, a database time with seconds too, and one past midnight', () => {
    expect(seriesTimeText('01:00', 120)).toBe('01:00 → 03:00');
    expect(seriesTimeText('20:00:00', 120)).toBe('20:00 → 22:00');
    expect(seriesTimeText('22:00', 240)).toBe('22:00 → 02:00 next day');
    expect(seriesTimeText('00:00', 1440)).toBe('00:00 → 00:00 next day');
  });

  it('joins the rule and the time as the lines do: weekly runs on, monthly takes a dot', () => {
    const tubtong: SeriesShape = {
      rule: { freq: 'weekly', days: [2] },
      startTime: '01:00:00',
      durationMin: 120,
    };
    expect(formatSeriesRule(tubtong)).toBe('every Tue 01:00 → 03:00 (2 h)');
    expect(formatSeriesRule(tubtong, { length: false })).toBe('every Tue 01:00 → 03:00');
    const orca: SeriesShape = { rule: { freq: 'monthly', day: 6 }, startTime: '20:00', durationMin: 120 };
    expect(formatSeriesRule(orca)).toBe('monthly on day 6 · 20:00 → 22:00 (2 h)');
    const airways: SeriesShape = {
      rule: { freq: 'weekly', days: [1, 4] },
      startTime: '22:00',
      durationMin: 60,
    };
    expect(formatSeriesRule(airways)).toBe('every Mon, Thu 22:00 → 23:00 (1 h)');
  });

  it.each([
    ['no days', { freq: 'weekly', days: [] }],
    ['day 0', { freq: 'weekly', days: [0] }],
    ['a repeated day', { freq: 'weekly', days: [2, 2] }],
    ['day 32', { freq: 'monthly', day: 32 }],
    ['a 5th weekday', { freq: 'monthly', nth: 5, weekday: 1 }],
    ['day and nth together', { freq: 'monthly', day: 3, nth: 1, weekday: 1 }],
    ['a daily rule', { freq: 'daily' }],
  ])('refuses %s, as valid_series_rule does', (_name, rule) => {
    expect(seriesRuleSchema.safeParse(rule).success).toBe(false);
  });
});
