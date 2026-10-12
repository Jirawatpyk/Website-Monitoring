import { describe, expect, it } from 'vitest';
import {
  bangkokDayStart,
  clockMinutes,
  confirmedByWafOf,
  formatConfirmedBy,
  formatCount,
  formatLocations,
  formatDay,
  formatMonth,
  bangkokMonthStart,
  formatDuration,
  formatDurationSeconds,
  formatWindowLength,
  formatNameList,
  formatIncidentId,
  formatMs,
  formatIncidentLine,
  formatPercent,
  formatTier,
  formatTime,
  formatTimeWithSeconds,
  formatWhen,
  isSameBangkokDay,
} from './format';

// Fri 25 Sep 2026 10:07 in Bangkok = 03:07 UTC (spec §1 snapshot time).
const snapshot = new Date('2026-09-25T03:07:12Z');

describe('formatConfirmedBy (ChatAlert "Confirmed by", D-027)', () => {
  it.each([
    [3, null, '3 locations, 2 checks'],
    [1, null, '1 location, 2 checks'],
    [
      1,
      { from: ['BKK'], blocked: ['SIN', 'TYO'] },
      'BKK only, 2 checks — SIN, TYO blocked by bot protection',
    ],
    [2, { from: ['BKK', 'SIN'], blocked: ['TYO'] }, 'BKK and SIN, 2 checks — TYO blocked by bot protection'],
    [2, { from: ['BKK', 'SIN'], blocked: [] }, '2 locations, 2 checks'],
  ] as const)('%i, %o → %s', (count, waf, expected) => {
    expect(formatConfirmedBy(count, waf)).toBe(expected);
  });

  it('formatLocations: "1 location", "3 locations"', () => {
    expect(formatLocations(1)).toBe('1 location');
    expect(formatLocations(3)).toBe('3 locations');
  });
});

describe('confirmedByWafOf', () => {
  it('reads both lists from an incident context, or nothing when either is missing', () => {
    expect(confirmedByWafOf({ confirmingFrom: ['BKK'], wafBlocked: ['SIN', 'TYO'] })).toEqual({
      from: ['BKK'],
      blocked: ['SIN', 'TYO'],
    });
    expect(confirmedByWafOf({ confirmingFrom: ['BKK'] })).toBeNull();
    expect(confirmedByWafOf({ confirmingFrom: 'BKK', wafBlocked: [1] })).toBeNull();
    expect(confirmedByWafOf(undefined)).toBeNull();
  });
});

describe('formatNameList', () => {
  it.each([
    [[], ''],
    [['Tao'], 'Tao'],
    [['Arm', 'Tao'], 'Arm and Tao'],
    [['you', 'Ploy', 'Tao'], 'you, Ploy and Tao'],
  ])('%j → %s', (names, text) => {
    expect(formatNameList(names)).toBe(text);
  });
});

describe('formatWindowLength (MaintenancePage, ChatAlert maintenance rows)', () => {
  it.each([
    [120, '2 h'],
    [560, '9 h 20 min'],
    [1440, '24 h'],
    [1560, '1 d 2 h'],
    [2880, '2 days'],
    [4320, '3 days'],
    [4319.6, '3 days'],
  ])('%s min → %s', (minutes, text) => {
    expect(formatWindowLength(minutes)).toBe(text);
  });
});

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

describe('formatDurationSeconds (Main3 MTTA / MTTD)', () => {
  it.each([
    [18, '18 s'],
    [0, '0 s'],
    [112, '1 min 52 s'],
    [400, '6 min 40 s'],
    [72.4, '1 min 12 s'],
    [900, '15 min'],
    [3720, '1 h 2 min'],
    [-5, '0 s'],
  ])('%d s → %s', (seconds, expected) => {
    expect(formatDurationSeconds(seconds)).toBe(expected);
  });
});

describe('formatMs (Main3 response times)', () => {
  it.each([
    [412, '412 ms'],
    [999.4, '999 ms'],
    [999.6, '1.0 s'],
    [1100, '1.1 s'],
    [5800, '5.8 s'],
  ])('%d ms → %s', (ms, expected) => {
    expect(formatMs(ms)).toBe(expected);
  });
});

describe('dates in Bangkok time', () => {
  it('formats the time as 24-hour', () => {
    expect(formatTime(snapshot)).toBe('10:07');
  });

  it('formats the day without padding or "Sept"', () => {
    expect(formatDay(snapshot)).toBe('25 Sep');
    expect(formatDay(snapshot, { weekday: true })).toBe('Fri 25 Sep');
    expect(formatDay(snapshot, { weekday: true, year: true })).toBe('Fri 25 Sep 2026');
    // the Bangkok year: 31 Dec 17:30 UTC is already 1 Jan in Bangkok
    expect(formatDay(new Date('2026-12-31T17:30:00Z'), { year: true })).toBe('1 Jan 2027');
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

describe('alert times and incident ids (ChatAlert, D-013)', () => {
  it('formats a confirmation time with seconds', () => {
    expect(formatTimeWithSeconds(snapshot)).toBe('10:07:12');
    expect(formatTimeWithSeconds(new Date('2026-09-25T02:48:41Z'))).toBe('09:48:41');
  });

  it('compares calendar days in Bangkok, not UTC', () => {
    expect(isSameBangkokDay(new Date('2026-09-25T16:59:00Z'), new Date('2026-09-25T01:00:00Z'))).toBe(true);
    expect(isSameBangkokDay(new Date('2026-09-25T17:01:00Z'), new Date('2026-09-25T16:59:00Z'))).toBe(false);
  });

  it.each([
    [7, 'INC-0007'],
    [142, 'INC-0142'],
    [12345, 'INC-12345'],
  ])('incident %i → %s', (n, expected) => {
    expect(formatIncidentId(n)).toBe(expected);
  });
});

describe('formatIncidentLine (Sites list, spec §20)', () => {
  const base = { number: 142, level: 0, minutesOpen: 18, ackedBy: null };
  it.each([
    [{ ...base, state: 'unacked' as const }, 'INC-0142 · 18 min unacked'],
    [{ ...base, state: 'unacked' as const, minutesOpen: 0.4 }, 'INC-0142 · unacked just now'],
    [{ ...base, state: 'escalated' as const, level: 1 }, 'INC-0142 · Escalated L1 · 18 min unacked'],
    [
      { ...base, state: 'escalated' as const, level: 2, minutesOpen: 75 },
      'INC-0142 · Escalated L2 · 1 h 15 min unacked',
    ],
    [{ ...base, number: 141, state: 'acknowledged' as const, ackedBy: 'Ploy' }, 'INC-0141 · Acked by Ploy'],
    [{ ...base, state: 'acknowledged' as const }, 'INC-0142 · Acknowledged'],
    [{ ...base, state: 'monitoring' as const }, 'INC-0142 · Monitoring'],
    [{ ...base, number: 139, state: 'needs_root_cause' as const }, 'INC-0139 · Needs root cause'],
  ])('%o → %s', (i, expected) => {
    expect(formatIncidentLine(i)).toBe(expected);
  });
});

describe('formatWhen (spec §13)', () => {
  it.each([
    ['2026-09-25T02:48:00Z', {}, 'Today 09:48'],
    ['2026-09-24T09:40:00Z', {}, 'Yesterday 16:40'],
    ['2026-09-24T17:30:00Z', {}, 'Today 00:30'],
    ['2026-09-14T14:18:00Z', {}, 'Mon 14 Sep 21:18'],
    ['2026-09-25T02:48:00Z', { midSentence: true }, 'today 09:48'],
    ['2026-09-24T09:40:00Z', { midSentence: true }, 'yesterday 16:40'],
  ] as const)('%s %j → %s', (iso, options, out) => {
    expect(formatWhen(new Date(iso), snapshot, options)).toBe(out);
  });
});

describe('bangkokDayStart', () => {
  it('midnight Bangkok, even when UTC is still the day before', () => {
    expect(bangkokDayStart(snapshot).toISOString()).toBe('2026-09-24T17:00:00.000Z');
    expect(bangkokDayStart(new Date('2026-09-24T17:30:00Z')).toISOString()).toBe('2026-09-24T17:00:00.000Z');
    expect(bangkokDayStart(new Date('2026-09-24T16:59:00Z')).toISOString()).toBe('2026-09-23T17:00:00.000Z');
  });
});

describe('formatCount', () => {
  it('thousands separators', () => {
    expect(formatCount(2007)).toBe('2,007');
    expect(formatCount(8)).toBe('8');
  });
});

describe('clockMinutes (D-033: one minute rule for pages and messages)', () => {
  const t = (hhmmss: string) => new Date(`2026-09-25T${hhmmss}Z`);
  it.each([
    ['19:37:50 → 19:42:10 reads 5, as the range 19:37–19:42', '12:37:50', '12:42:10', 5],
    ['inside one minute reads 1, never 0', '12:37:10', '12:37:40', 1],
    ['across an hour', '12:58:30', '13:03:00', 5],
  ])('%s', (_, start, end, minutes) => {
    expect(clockMinutes(t(start), t(end))).toBe(minutes);
  });
});

describe('formatMonth / bangkokMonthStart', () => {
  it('names the Bangkok month and finds its first midnight', () => {
    // Wed 30 Sep 2026 23:30 UTC is Thu 1 Oct 06:30 in Bangkok.
    const late = new Date('2026-09-30T23:30:00Z');
    expect(formatMonth(late)).toBe('October');
    expect(bangkokMonthStart(late).toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(formatMonth(new Date('2026-09-25T03:07:00Z'))).toBe('September');
  });
});
