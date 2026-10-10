import { describe, expect, it } from 'vitest';
import { addInsideMinutes, isInsideHours, minutesInsideHours, nextOpening } from './response-hours';

/** Bangkok wall time → the instant (UTC+7). */
const bkk = (iso: string) => new Date(`${iso}+07:00`);

// Spec §7: Tier 2–3 respond Mon–Fri 09:00–18:00, company holidays skipped (PRD §4).
const HOURS = { startMin: 9 * 60, endMin: 18 * 60, days: [1, 2, 3, 4, 5], holidays: new Set<string>() };
// Fri 25 Sep 2026 as a company holiday.
const FRIDAY_OFF = { ...HOURS, holidays: new Set(['2026-09-25']) };

describe('isInsideHours — Mon–Fri 09:00–18:00 (spec §7)', () => {
  it.each([
    ['Thu 24 Sep 22:14 (INC-0139)', '2026-09-24T22:14:00', HOURS, false],
    ['Fri 25 Sep 09:00, the opening minute', '2026-09-25T09:00:00', HOURS, true],
    ['Fri 25 Sep 10:07', '2026-09-25T10:07:12', HOURS, true],
    ['Fri 25 Sep 17:59:59', '2026-09-25T17:59:59', HOURS, true],
    ['Fri 25 Sep 18:00, closed', '2026-09-25T18:00:00', HOURS, false],
    ['Sat 26 Sep 10:00', '2026-09-26T10:00:00', HOURS, false],
    ['Fri 25 Sep 10:00 on a company holiday', '2026-09-25T10:00:00', FRIDAY_OFF, false],
  ])('%s', (_case, at, hours, inside) => {
    expect(isInsideHours(bkk(at), hours)).toBe(inside);
  });
});

describe('nextOpening', () => {
  it.each([
    ['inside hours: now', '2026-09-25T10:07:00', HOURS, '2026-09-25T10:07:00'],
    ['Thu night → Fri 09:00', '2026-09-24T22:14:00', HOURS, '2026-09-25T09:00:00'],
    ['before 09:00 the same day', '2026-09-25T06:30:00', HOURS, '2026-09-25T09:00:00'],
    ['Fri after 18:00 → Mon 09:00', '2026-09-25T18:30:00', HOURS, '2026-09-28T09:00:00'],
    [
      'Thu night before a Friday holiday → Mon 09:00',
      '2026-09-24T22:14:00',
      FRIDAY_OFF,
      '2026-09-28T09:00:00',
    ],
  ])('%s', (_case, at, hours, want) => {
    expect(nextOpening(bkk(at), hours)).toEqual(bkk(want));
  });
});

describe('addInsideMinutes — when a paused timer comes due', () => {
  it.each([
    ['INC-0139: Thu 22:14 + 15 → Fri 09:15', '2026-09-24T22:14:00', 15, HOURS, '2026-09-25T09:15:00'],
    [
      'the same on a Friday holiday → Mon 09:15',
      '2026-09-24T22:14:00',
      15,
      FRIDAY_OFF,
      '2026-09-28T09:15:00',
    ],
    ['inside hours it is the wall clock', '2026-09-25T09:48:41', 15, HOURS, '2026-09-25T10:03:41'],
    ['17:50 + 15 → the next working day 09:05', '2026-09-24T17:50:00', 15, HOURS, '2026-09-25T09:05:00'],
    ['Fri 17:50 + 15 → Mon 09:05', '2026-09-25T17:50:00', 15, HOURS, '2026-09-28T09:05:00'],
    ['17:45 + 15 lands on 18:00', '2026-09-25T17:45:00', 15, HOURS, '2026-09-25T18:00:00'],
    ['a weekend start → Mon 09:00 + n', '2026-09-26T11:00:00', 60, HOURS, '2026-09-28T10:00:00'],
    ['across a whole working day', '2026-09-24T17:00:00', 60 + 540 + 30, HOURS, '2026-09-28T09:30:00'],
    ['zero minutes inside hours is now', '2026-09-25T10:00:00', 0, HOURS, '2026-09-25T10:00:00'],
  ])('%s', (_case, from, minutes, hours, want) => {
    expect(addInsideMinutes(bkk(from), minutes, hours)).toEqual(bkk(want));
  });
});

describe('minutesInsideHours — how long a paused timer has run', () => {
  it.each([
    ['Thu 22:14 → Fri 09:15', '2026-09-24T22:14:00', '2026-09-25T09:15:00', HOURS, 15],
    ['all inside', '2026-09-25T09:48:41', '2026-09-25T10:03:41', HOURS, 15],
    ['over a weekend', '2026-09-25T17:30:00', '2026-09-28T09:30:00', HOURS, 60],
    ['a holiday counts nothing', '2026-09-24T17:30:00', '2026-09-28T09:00:00', FRIDAY_OFF, 30],
    ['to before from is 0', '2026-09-25T10:00:00', '2026-09-25T09:00:00', HOURS, 0],
  ])('%s', (_case, from, to, hours, want) => {
    expect(minutesInsideHours(bkk(from), bkk(to), hours)).toBeCloseTo(want, 6);
  });

  it('agrees with addInsideMinutes', () => {
    const from = bkk('2026-09-24T22:14:00');
    for (const n of [1, 15, 60, 545, 600, 1200]) {
      expect(minutesInsideHours(from, addInsideMinutes(from, n, FRIDAY_OFF), FRIDAY_OFF)).toBeCloseTo(n, 6);
    }
  });
});
