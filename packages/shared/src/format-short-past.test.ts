import { describe, expect, it } from 'vitest';
import { formatShortPast, formatShortWhen } from './format';

// Fri 25 Sep 2026 10:08 Bangkok.
const NOW = new Date('2026-09-25T03:08:00Z');

describe('formatShortPast (D-062 item 12)', () => {
  it.each([
    ['2026-09-25T00:52:00Z', '07:52'], // today
    ['2026-09-24T09:40:00Z', 'Yesterday 16:40'],
    ['2026-09-23T11:30:00Z', 'Wed 18:30'],
    ['2026-09-19T03:00:00Z', 'Sat 10:00'], // 6 Bangkok days back
    ['2026-09-18T16:59:00Z', '18 Sep'], // Fri 18 Sep 23:59 Bangkok is 7 days back: the date
    ['2026-09-02T03:08:00Z', '2 Sep'],
  ])('%s → %s', (at, expected) => {
    expect(formatShortPast(new Date(at), NOW)).toBe(expected);
  });

  it.each([
    ['2026-09-25T02:35:00Z', '09:35'], // today: the time alone
    ['2026-09-24T16:41:00Z', 'Thu 23:41'], // yesterday is a weekday too ("Thu 23:41 → Fri 09:35")
    ['2026-09-19T03:00:00Z', 'Sat 10:00'], // 6 Bangkok days back
    ['2026-09-02T14:15:00Z', 'Wed 2 Sep 21:15'], // weeks back: the date, never a weekday alone
    ['2026-09-26T02:00:00Z', 'Sat 26 Sep 09:00'], // ahead: dated
  ])('formatShortWhen %s → %s (§37)', (at, expected) => {
    expect(formatShortWhen(new Date(at), NOW)).toBe(expected);
  });

  it('two times on the same Bangkok day read the same way', () => {
    const a = formatShortPast(new Date('2026-09-19T00:30:00Z'), NOW); // Sat 07:30
    const b = formatShortPast(new Date('2026-09-19T16:00:00Z'), NOW); // Sat 23:00
    expect([a, b]).toEqual(['Sat 07:30', 'Sat 23:00']);
  });
});
