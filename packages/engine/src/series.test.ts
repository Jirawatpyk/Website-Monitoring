import { describe, expect, it } from 'vitest';
import { nextOccurrences, seriesMatches, seriesStateOf } from './series';

// The same days private.series_matches gives (supabase/tests/maintenance_series.test.sql).
describe('seriesMatches (Bangkok calendar days, D-057)', () => {
  const days = (from: string, to: string) => {
    const out: string[] = [];
    for (
      let d = new Date(`${from}T00:00:00Z`);
      d <= new Date(`${to}T00:00:00Z`);
      d = new Date(d.getTime() + 86_400_000)
    )
      out.push(d.toISOString().slice(0, 10));
    return out;
  };
  it('every Tuesday of Nov 2026', () => {
    expect(
      days('2026-11-01', '2026-11-30').filter((d) => seriesMatches({ freq: 'weekly', days: [2] }, d)),
    ).toHaveLength(4);
  });
  it('day 31 skips April', () => {
    expect(days('2026-04-01', '2026-04-30').some((d) => seriesMatches({ freq: 'monthly', day: 31 }, d))).toBe(
      false,
    );
  });
  it('the 2nd Tuesday of each month', () => {
    expect(
      days('2026-11-01', '2026-12-31').filter((d) =>
        seriesMatches({ freq: 'monthly', nth: 2, weekday: 2 }, d),
      ),
    ).toEqual(['2026-11-10', '2026-12-08']);
  });
});

describe('nextOccurrences (the dialog summary only — SQL makes the windows)', () => {
  const bkk = (s: string) => new Date(`${s}:00+07:00`);
  it('from the From day, at the Bangkok time, skipping what is under 5 min away', () => {
    expect(
      nextOccurrences(
        { rule: { freq: 'weekly', days: [2] }, startTime: '01:00', startsOn: '2026-09-28', untilOn: null },
        2,
        bkk('2026-09-25T10:07'),
      ),
    ).toEqual([bkk('2026-09-29T01:00'), bkk('2026-10-06T01:00')]);
    expect(
      nextOccurrences(
        {
          rule: { freq: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] },
          startTime: '10:10',
          startsOn: '2026-09-25',
          untilOn: null,
        },
        1,
        bkk('2026-09-25T10:07'),
      ),
    ).toEqual([bkk('2026-09-26T10:10')]);
  });
  it('a Bangkok 01:00 start is the day before in UTC', () => {
    const [first] = nextOccurrences(
      { rule: { freq: 'weekly', days: [2] }, startTime: '01:00:00', startsOn: '2026-09-29', untilOn: null },
      1,
      bkk('2026-09-25T10:00'),
    );
    expect(first?.toISOString()).toBe('2026-09-28T18:00:00.000Z');
  });
  it('stops at Ends on, and a month without the day is skipped', () => {
    expect(
      nextOccurrences(
        {
          rule: { freq: 'monthly', day: 31 },
          startTime: '20:00',
          startsOn: '2026-03-01',
          untilOn: '2026-06-30',
        },
        5,
        bkk('2026-03-01T00:00'),
      ),
    ).toEqual([bkk('2026-03-31T20:00'), bkk('2026-05-31T20:00')]);
  });
});

describe('seriesStateOf (one rule for the page)', () => {
  const now = new Date('2026-09-25T03:07:00Z');
  const base = {
    approvedAt: null,
    declinedAt: null,
    cancelledAt: null,
    outcome: null,
    untilOn: null,
  } as const;
  it.each([
    ['waiting', base],
    ['repeating', { ...base, approvedAt: '2026-09-14T04:20:00Z' }],
    ['finished', { ...base, approvedAt: '2026-09-01T00:00:00Z', untilOn: '2026-09-24' }],
    ['repeating', { ...base, approvedAt: '2026-09-01T00:00:00Z', untilOn: '2026-09-25' }],
    ['cancelled', { ...base, approvedAt: '2026-09-14T04:20:00Z', cancelledAt: '2026-09-25T03:07:00Z' }],
    ['withdrawn', { ...base, cancelledAt: '2026-09-25T03:07:00Z' }],
    ['declined', { ...base, declinedAt: '2026-09-21T09:05:00Z' }],
    ['not_approved', { ...base, cancelledAt: '2026-09-19T15:00:00Z', outcome: 'not_approved' }],
  ] as const)('%s', (state, s) => {
    expect(seriesStateOf(s, now)).toBe(state);
  });
});
