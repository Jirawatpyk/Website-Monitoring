import { describe, expect, it } from 'vitest';
import {
  bangkokToday,
  holidayYears,
  lastHolidayDay,
  removeEffect,
  takenLine,
  type Holiday,
} from './holidays';

// The board's clock: Fri 25 Sep 2026 10:08 Bangkok.
const NOW = new Date('2026-09-25T03:08:00Z');
const MON_FRI = { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5] };
const MON_SAT = { ...MON_FRI, days: [1, 2, 3, 4, 5, 6] };

const h = (day: string, name: string, kind: Holiday['kind'] = 'public'): Holiday => ({
  id: day,
  day,
  name,
  kind,
});
const LIST = [
  h('2026-09-01', 'Gone already'),
  h('2026-12-05', 'Father’s Day'),
  h('2026-12-07', 'Father’s Day (substitute)'),
  h('2026-12-30', 'Company day off — year-end', 'company'),
  h('2026-10-13', 'King Bhumibol Memorial Day'),
  h('2027-01-01', 'New Year’s Day'),
  h('2027-05-01', 'Labour Day'),
];

describe('holiday list', () => {
  it('this year from today and all of next year, by date, with the board’s heads', () => {
    const [y26, y27] = holidayYears(LIST, MON_FRI, NOW);
    expect(y26!.head).toBe('2026 · 4 left this year · 3 on weekdays');
    expect(y26!.rows.map((r) => [r.date, r.name, r.kindLabel])).toEqual([
      ['Tue 13 Oct', 'King Bhumibol Memorial Day', 'Public holiday'],
      ['Sat 5 Dec', 'Father’s Day', 'Public holiday'],
      ['Mon 7 Dec', 'Father’s Day (substitute)', 'Public holiday'],
      ['Wed 30 Dec', 'Company day off — year-end', 'Company day off'],
    ]);
    expect(y26!.rows[1]!.sub).toBe('Weekend — no effect on Mon–Fri hours');
    expect(y26!.note).toBeNull();
    expect(y27!.head).toBe('2027 · 2 days · 1 on weekdays');
    expect(y27!.note).toMatch(/^Makha Bucha, Visakha Bucha and Asanha Bucha 2027 follow the lunar calendar/);
  });

  it('follows the hours setting: with Mon–Sat a Saturday counts', () => {
    const [y26] = holidayYears(LIST, MON_SAT, NOW);
    expect(y26!.head).toBe('2026 · 4 left this year · 4 on working days');
    expect(y26!.rows[1]!.sub).toBeNull();
  });

  it('today is the Bangkok date, also between 00:00 and 07:00', () => {
    // 23:30 UTC on 24 Sep is 06:30 on 25 Sep in Bangkok.
    expect(bangkokToday(new Date('2026-09-24T23:30:00Z'))).toBe('2026-09-25');
    expect(lastHolidayDay(NOW)).toBe('2027-12-31');
  });
});

describe('remove a holiday', () => {
  it('a working day says what it turns into, with the hours as set (D-069: open incidents too)', () => {
    const e = removeEffect({ day: '2026-12-30' }, MON_FRI);
    expect(e.title).toBe('Wed 30 Dec 2026 becomes a working day.');
    expect(e.body).toMatch(/^Tier 2–3 timers run 09:00–18:00 and Tier 1 DOWN goes to the owner/);
    expect(e.body).toMatch(
      /open incidents included; a PROBLEM already held keeps the time it was held until\.$/,
    );
  });

  it('a day outside the hours changes nothing', () => {
    expect(removeEffect({ day: '2026-12-05' }, MON_FRI).title).toBe('Sat 5 Dec 2026 stays a day off.');
  });

  it('the taken-day line', () => {
    expect(takenLine('2026-12-07', 'Father’s Day (substitute)')).toBe(
      'Mon 7 Dec is already Father’s Day (substitute)',
    );
  });
});
