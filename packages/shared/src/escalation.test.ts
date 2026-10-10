import { describe, expect, it } from 'vitest';
import { formatResponseHours, timeToMinutes } from './escalation';

describe('formatResponseHours (spec §7, §14.14)', () => {
  it.each([
    ['Mon–Fri 09:00–18:00', { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5] }],
    ['Mon–Sat 08:30–17:00', { startMin: 510, endMin: 1020, days: [6, 1, 2, 3, 4, 5] }],
    ['Mon, Wed, Fri 09:00–18:00', { startMin: 540, endMin: 1080, days: [5, 1, 3] }],
    ['Tue 09:00–12:00', { startMin: 540, endMin: 720, days: [2] }],
  ])('%s', (want, h) => {
    expect(formatResponseHours(h)).toBe(want);
  });
});

describe('timeToMinutes', () => {
  it('reads a Postgres time', () => {
    expect(timeToMinutes('09:00:00')).toBe(540);
    expect(timeToMinutes('18:00')).toBe(1080);
  });
});
