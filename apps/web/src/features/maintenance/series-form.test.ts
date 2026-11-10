import { describe, expect, it } from 'vitest';
import { monthOptions, repeatPlanOf, ruleOf, seriesDoneOf, type RepeatInput } from './series-form';

// Maintenance STATE › Weekly · Admin / Monthly · Admin / Weekly · Responder, MMaintenance (spec §32.2–3).
const now = new Date('2026-09-25T03:07:00Z'); // Fri 25 Sep 10:07 Bangkok
const weekly: RepeatInput = {
  repeat: 'weekly',
  from: '2026-09-29',
  untilOn: null,
  time: '01:00',
  durationMin: 120,
  days: [2],
  monthMode: 'day',
  now,
};

describe('the Repeat summary (§32.2)', () => {
  it('weekly: the rule, from, next 2', () => {
    expect(repeatPlanOf(weekly)).toMatchObject({
      rule: { freq: 'weekly', days: [2] },
      summary: 'Every Tue 01:00 → 03:00 (UTC+7) · from Tue 29 Sep · next 2: Tue 29 Sep, Tue 6 Oct',
      blocked: false,
    });
  });
  it('monthly on day N or the Nth weekday, with an end', () => {
    const m = {
      ...weekly,
      repeat: 'monthly' as const,
      from: '2026-09-26',
      time: '20:00',
      untilOn: '2026-12-31',
    };
    expect(repeatPlanOf(m).summary).toBe(
      'Monthly on day 26 · 20:00 → 22:00 (UTC+7) · from Sat 26 Sep · until Thu 31 Dec · next 2: Sat 26 Sep, Mon 26 Oct',
    );
    expect(ruleOf({ ...m, monthMode: 'nth' })).toEqual({ freq: 'monthly', nth: 4, weekday: 6 });
  });
  it('refuses no day, an end before From, and nothing between the days', () => {
    expect(repeatPlanOf({ ...weekly, days: [] })).toMatchObject({
      daysError: 'Pick at least one day.',
      blocked: true,
    });
    expect(repeatPlanOf({ ...weekly, untilOn: '2026-09-28' })).toMatchObject({
      untilError: 'The last day is before the first.',
      summary: 'Fix Ends on — the last day is before the first.',
      blocked: true,
    });
    expect(repeatPlanOf({ ...weekly, days: [3], untilOn: '2026-09-29' }).blocked).toBe(true);
  });
});

describe('the monthly choice (§32.2)', () => {
  it('day N and the Nth weekday; a 5th weekday is left out; over 28 says a month is skipped', () => {
    expect(monthOptions('2026-09-26').map((o) => o.label)).toEqual([
      'Day 26 of each month',
      'The 4th Saturday of each month',
    ]);
    expect(monthOptions('2026-09-29')).toEqual([
      { value: 'day', label: 'Day 29 of each month', description: 'A month without day 29 is skipped.' },
    ]);
  });
});

describe('the success line (§32.2)', () => {
  it('an Admin’s series and a Responder’s request', () => {
    expect(
      seriesDoneOf({
        site: 'Tubtong',
        waiting: false,
        windows: ['2026-09-28T18:00:00Z', '2026-10-05T18:00:00Z'],
        admins: null,
        summary: '',
      }),
    ).toEqual({
      title: 'Series scheduled · Tubtong',
      text: '2 windows scheduled now (Tue 29 Sep, Tue 6 Oct); the rest are added 14 days ahead. Cancel it any time from Maintenance & mutes.',
    });
    expect(
      seriesDoneOf({
        site: 'BA Taiwan',
        waiting: true,
        windows: [],
        admins: ['Tao'],
        summary: 'Every Mon, Thu 22:00 → 23:00 (UTC+7) · from Mon 28 Sep · next 2: …',
      }).title,
    ).toBe('Series request sent to Tao · BA Taiwan');
  });

  it('a series whose first window is over 14 days away names it instead of "0 windows" (code review)', () => {
    expect(
      seriesDoneOf({
        site: 'ORCA Thailand',
        waiting: false,
        windows: [],
        admins: null,
        summary: '',
        first: new Date('2026-11-06T13:00:00Z'),
      }).text,
    ).toBe(
      'Its first window, Fri 6 Nov, is added 14 days before it starts. Cancel it any time from Maintenance & mutes.',
    );
  });
});
