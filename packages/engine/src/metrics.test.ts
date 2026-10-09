import { describe, expect, it } from 'vitest';
import { formatDurationSeconds } from '@dxt/shared';
import { kpiChange, mttrMinutes, responseKpis, type MetricIncident } from './metrics';

// Spec §1: Fri 25 Sep 2026 10:07 (UTC+7). The window is the last 30 days (spec §21.3).
const NOW = new Date('2026-09-25T03:07:12Z');
const FROM = new Date(NOW.getTime() - 30 * 86_400_000);
const at = (iso: string) => new Date(`${iso}+07:00`);

// INC-0142 MuvMi (spec §14.3, §15.6): first failed check ~09:47:41, confirmed down 09:48:41,
// acknowledged by Arm 10:07:00 → MTTD 60 s, MTTA 18 min 19 s.
const muvmi: MetricIncident = {
  severity: 'down',
  tier: 1,
  startedAt: at('2026-09-25T09:47:41'),
  detectedAt: at('2026-09-25T09:48:41'),
  ackedAt: at('2026-09-25T10:07:00'),
  isManual: false,
};
const inc = (over: Partial<MetricIncident>): MetricIncident => ({ ...muvmi, ...over });

describe('responseKpis (spec §21.3, PRD §2 means, D-032)', () => {
  it.each<[string, MetricIncident[], { downCount: number; mtta: string | null; mttd: string | null }]>([
    ['no incidents → not enough', [], { downCount: 0, mtta: null, mttd: null }],
    ['2 DOWN incidents → "—" (needs 3)', [muvmi, muvmi], { downCount: 2, mtta: null, mttd: null }],
    [
      'PROBLEM incidents never count toward the 3',
      [muvmi, muvmi, inc({ severity: 'problem' })],
      { downCount: 2, mtta: null, mttd: null },
    ],
    [
      '3 DOWN incidents → the means',
      [muvmi, muvmi, muvmi],
      { downCount: 3, mtta: '18 min 19 s', mttd: '1 min' },
    ],
    [
      'an open, unacknowledged DOWN counts toward the 3 but not toward MTTA',
      [muvmi, muvmi, inc({ ackedAt: null })],
      { downCount: 3, mtta: '18 min 19 s', mttd: '1 min' },
    ],
    [
      'MTTA covers every tier; MTTD only Tier 1',
      [
        inc({
          tier: 2,
          startedAt: at('2026-09-20T10:00:00'),
          detectedAt: at('2026-09-20T10:05:00'),
          ackedAt: at('2026-09-20T10:10:00'),
        }),
        inc({
          tier: 3,
          startedAt: at('2026-09-21T10:00:00'),
          detectedAt: at('2026-09-21T10:05:00'),
          ackedAt: at('2026-09-21T10:20:00'),
        }),
        inc({
          startedAt: at('2026-09-22T10:00:00'),
          detectedAt: at('2026-09-22T10:01:30'),
          ackedAt: at('2026-09-22T10:04:30'),
        }),
      ],
      // MTTA (300 + 900 + 180) / 3 = 460 s; MTTD = the Tier 1 one only, 90 s
      { downCount: 3, mtta: '7 min 40 s', mttd: '1 min 30 s' },
    ],
    [
      'a manual incident is left out of MTTD',
      [muvmi, muvmi, inc({ isManual: true, startedAt: at('2026-09-25T09:00:00') })],
      { downCount: 3, mtta: '18 min 19 s', mttd: '1 min' },
    ],
    [
      'no Tier 1 DOWN → MTTD has no value',
      [inc({ tier: 2 }), inc({ tier: 2 }), inc({ tier: 3 })],
      { downCount: 3, mtta: '18 min 19 s', mttd: null },
    ],
    [
      'incidents started before the window are left out',
      [muvmi, muvmi, inc({ startedAt: at('2026-08-20T10:00:00') })],
      { downCount: 2, mtta: null, mttd: null },
    ],
  ])('%s', (_name, incidents, expected) => {
    const k = responseKpis(incidents, FROM, NOW);
    expect(k.downCount).toBe(expected.downCount);
    expect(k.enough).toBe(expected.downCount >= 3);
    expect(k.mttaSeconds === null ? null : formatDurationSeconds(k.mttaSeconds)).toBe(expected.mtta);
    expect(k.mttdSeconds === null ? null : formatDurationSeconds(k.mttdSeconds)).toBe(expected.mttd);
  });

  it('a PROBLEM raised to DOWN (D-021): MTTD from the outage start, not the PROBLEM start', () => {
    const raised = inc({
      startedAt: at('2026-09-25T09:30:00'), // slow since 09:30
      downStartedAt: at('2026-09-25T09:47:41'),
      detectedAt: at('2026-09-25T09:48:41'),
    });
    const k = responseKpis([raised, muvmi, muvmi], FROM, NOW);
    expect(formatDurationSeconds(k.mttdSeconds!)).toBe('1 min'); // not 18 min 41 s
    expect(formatDurationSeconds(k.mttaSeconds!)).toBe('18 min 19 s');
  });

  it('acknowledged while still a PROBLEM, then raised to DOWN: left out of MTTA, not counted as 0', () => {
    const ackedEarly = inc({ ackedAt: at('2026-09-25T09:40:00') });
    const k = responseKpis([ackedEarly, muvmi, muvmi], FROM, NOW);
    expect(k.downCount).toBe(3);
    expect(formatDurationSeconds(k.mttaSeconds!)).toBe('18 min 19 s');
  });

  it('an outage that started inside the window counts, even if its PROBLEM began before it', () => {
    const k = responseKpis(
      [inc({ startedAt: at('2026-08-20T10:00:00'), downStartedAt: at('2026-09-20T10:00:00') }), muvmi, muvmi],
      FROM,
      NOW,
    );
    expect(k.downCount).toBe(3);
  });
});

describe('kpiChange ("vs last 30d")', () => {
  it.each<[number | null, number | null, ReturnType<typeof kpiChange>]>([
    [400, 472, { seconds: 72, direction: 'down' }],
    [472, 400, { seconds: 72, direction: 'up' }],
    [400, 400.2, { seconds: 0, direction: 'flat' }],
    [400, null, null],
    [null, 400, null],
  ])('%s vs %s', (current, previous, expected) => {
    expect(kpiChange(current, previous)).toEqual(expected);
  });
});

describe('mttrMinutes (MTTR · DOWN only · median, D-033)', () => {
  const d = (minutes: number | null) => ({ severity: 'down' as const, minutes });
  it.each([
    ['odd count: the middle one', [d(10), d(30), d(20)], 20],
    ['even count: the mean of the middle two, rounded', [d(10), d(31)], 21],
    ['open DOWN incidents (no recovery yet) are left out', [d(null), d(12)], 12],
    ['PROBLEM incidents are left out', [{ severity: 'problem' as const, minutes: 5 }, d(40)], 40],
    ['none recovered: no MTTR', [d(null)], null],
    ['no incidents: no MTTR', [], null],
  ])('%s', (_name, rows, expected) => {
    expect(mttrMinutes(rows)).toBe(expected);
  });
});
