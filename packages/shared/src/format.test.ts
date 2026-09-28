import { describe, expect, it } from 'vitest';
import { formatDay, formatDuration, formatPercent, formatTier, formatTime } from './format';

// Fri 25 Sep 2026 10:07 in Bangkok = 03:07 UTC (spec §1 snapshot time).
const snapshot = new Date('2026-09-25T03:07:12Z');

describe('formatDuration (spec §13)', () => {
  it.each([
    [26, '26 min'],
    [43, '43 min'],
    [60, '1 h'],
    [62, '1 h 2 min'],
    [1440, '1 d'],
    [1440 + 120 + 5, '1 d 2 h'],
    [0, '0 min'],
  ])('%i minutes → %s', (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });
});

describe('dates in Bangkok time', () => {
  it('formats the time as 24-hour', () => {
    expect(formatTime(snapshot)).toBe('10:07');
  });

  it('formats the day without padding or "Sept"', () => {
    expect(formatDay(snapshot)).toBe('25 Sep');
    expect(formatDay(snapshot, { weekday: true })).toBe('Fri 25 Sep');
    expect(formatDay(new Date('2026-09-02T00:00:00Z'))).toBe('2 Sep');
  });

  it('rolls over to the next day after 17:00 UTC', () => {
    expect(formatDay(new Date('2026-09-25T17:30:00Z'), { weekday: true })).toBe('Sat 26 Sep');
  });
});

describe('formatPercent', () => {
  it('matches the spec §5 sample figures', () => {
    expect(formatPercent(1 - 101 / 43_200)).toBe('99.77%'); // MuvMi, 30 days
    expect(formatPercent(1 - 173 / 734_400)).toBe('99.98%'); // all sites, 30 days
    expect(formatPercent(1)).toBe('100.00%');
  });
});

describe('formatTier', () => {
  it('uses the long form in prose and the short form in tables', () => {
    expect(formatTier(1)).toBe('Tier 1');
    expect(formatTier(2, { short: true })).toBe('T2');
  });
});
