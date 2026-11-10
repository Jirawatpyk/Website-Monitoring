import { describe, expect, it } from 'vitest';
import { monthOptions, repeatPlanOf, ruleOf, seriesDoneOf, untilMax, type RepeatInput } from './series-form';

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
  it('weekly: the rule, from, no end date, next 2', () => {
    expect(repeatPlanOf(weekly)).toMatchObject({
      rule: { freq: 'weekly', days: [2] },
      summary:
        'Every Tue 01:00 → 03:00 (UTC+7) · from Tue 29 Sep · no end date · next 2: Tue 29 Sep, Tue 6 Oct',
      words: 'Every Tue 01:00 → 03:00',
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
  it('an end in a later year carries the year', () => {
    expect(repeatPlanOf({ ...weekly, untilOn: '2027-03-30' }).summary).toContain('· until Tue 30 Mar 2027 ·');
  });
  it('refuses no day, an end before From or over two years after it, and nothing between the days', () => {
    expect(repeatPlanOf({ ...weekly, days: [] })).toMatchObject({
      daysError: 'Pick at least one day.',
      blocked: true,
    });
    expect(repeatPlanOf({ ...weekly, untilOn: '2026-09-28' })).toMatchObject({
      untilError: 'The last day is before the first.',
      summary: 'Fix Ends on — the last day is before the first.',
      blocked: true,
    });
    expect(repeatPlanOf({ ...weekly, untilOn: '2028-09-30' })).toMatchObject({
      untilError: 'Pick a day up to two years after the first.',
      blocked: true,
    });
    expect(repeatPlanOf({ ...weekly, untilOn: '2028-09-29' }).blocked).toBe(false);
    expect(repeatPlanOf({ ...weekly, days: [3], untilOn: '2026-09-29' }).blocked).toBe(true);
  });
  it('two years after 29 Feb is 28 Feb', () => {
    expect(untilMax('2028-02-29')).toBe('2030-02-28');
  });
});

describe('the monthly choice (§32.2)', () => {
  it('day N and the Nth weekday; a 5th weekday is left out; over 28 says a month is skipped', () => {
    expect(monthOptions('2026-09-26')).toEqual([
      { value: 'day', label: 'Day 26 of each month', description: 'Same date every month.' },
      { value: 'nth', label: 'The 4th Saturday of each month', description: 'Same weekday every month.' },
    ]);
    expect(monthOptions('2026-09-29')).toEqual([
      {
        value: 'day',
        label: 'Day 29 of each month',
        description: 'Same date every month. A month without day 29 is skipped.',
      },
    ]);
  });
});

describe('the success line (§32.2, board Maintenance)', () => {
  const base = { words: 'Every Tue 01:00 → 03:00', reason: 'WordPress plugin updates', admins: null };
  it('an Admin’s series: the rule, from, the windows made, the audit and the reason', () => {
    expect(
      seriesDoneOf({
        ...base,
        site: 'Tubtong',
        waiting: false,
        windows: ['2026-09-28T18:00:00Z', '2026-10-05T18:00:00Z'],
        first: new Date('2026-09-28T18:00:00Z'),
        viewer: 'Tao',
      }),
    ).toEqual({
      title: 'Series scheduled · Tubtong',
      text: 'Every Tue 01:00 → 03:00 · from Tue 29 Sep · 2 windows scheduled now (Tue 29 Sep, Tue 6 Oct); the rest are added 14 days ahead · not counted in uptime · recorded in the audit log as Tao. Reason: “WordPress plugin updates”. Cancel the series, or edit or cancel one window, on Maintenance & mutes (sidebar › Maintenance).',
    });
  });
  it('a first window over 14 days away: no "0 windows" (code review)', () => {
    expect(
      seriesDoneOf({
        ...base,
        site: 'ORCA Thailand',
        waiting: false,
        windows: [],
        first: new Date('2026-11-06T13:00:00Z'),
        viewer: 'Tao',
      }).text,
    ).toContain('· from Fri 6 Nov · no window in the next 14 days yet; the rest are added 14 days ahead');
  });
  it('a Responder’s request names the Admins and where to follow it', () => {
    expect(
      seriesDoneOf({
        ...base,
        words: 'Every Mon, Thu 22:00 → 23:00',
        site: 'BA Taiwan',
        waiting: true,
        windows: [],
        admins: ['Tao'],
        first: new Date('2026-09-28T15:00:00Z'),
        reason: 'Plugin updates',
        viewer: 'Arm',
      }),
    ).toEqual({
      title: 'Series request sent to Tao · BA Taiwan',
      text: 'Every Mon, Thu 22:00 → 23:00 · from Mon 28 Sep · waiting for an Admin — nothing is scheduled until it’s approved. Recorded in the audit log as Arm. Reason: “Plugin updates”. Follow it under Waiting for approval on Maintenance & mutes.',
    });
  });
});
