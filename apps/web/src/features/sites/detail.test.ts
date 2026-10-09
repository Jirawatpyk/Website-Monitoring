import { describe, expect, it } from 'vitest';
import {
  axisLabels,
  chartLines,
  clientWord,
  incidentsCaption,
  intervalLabel,
  rangeOf,
  rangeStats,
  responseHoursLabel,
  severityLine,
  weightedMedian,
  type IncidentSummaryRow,
  type SeriesRow,
} from './detail';

const row = (r: Partial<SeriesRow>): SeriesRow => ({
  location: null,
  bucket_start: null,
  checks: 0,
  hard_fails: 0,
  p50_ms: null,
  p95_ms: null,
  ...r,
});

describe('rangeOf', () => {
  it.each([
    ['7d', '7d'],
    ['90d', '90d'],
    [undefined, '24h'],
    ['1y', '24h'],
    [['30d', '7d'], '30d'],
  ] as const)('%j → %s', (input, out) => {
    expect(rangeOf(input as string | string[] | undefined)).toBe(out);
  });
});

describe('rangeStats (D-031)', () => {
  it('24 h takes the exact whole-range total', () => {
    const rows = [
      row({ location: null, bucket_start: null, checks: 4320, p50_ms: 412, p95_ms: 690 }),
      row({ location: null, bucket_start: '2026-09-25T02:00:00Z', checks: 30, p50_ms: 999, p95_ms: 999 }),
    ];
    expect(rangeStats(rows)).toEqual({ p50: 412, p95: 690 });
  });

  it('longer ranges weigh the all-locations buckets by their checks', () => {
    const rows = [
      row({ location: null, bucket_start: '2026-09-23T17:00:00Z', checks: 4320, p50_ms: 400, p95_ms: 700 }),
      row({ location: null, bucket_start: '2026-09-24T17:00:00Z', checks: 1000, p50_ms: 900, p95_ms: 1200 }),
      row({
        location: 'BKK',
        bucket_start: '2026-09-24T17:00:00Z',
        checks: 9999,
        p50_ms: 5000,
        p95_ms: 5000,
      }),
    ];
    expect(rangeStats(rows)).toEqual({ p50: 400, p95: 700 });
  });

  it('no data → nulls', () => {
    expect(rangeStats([])).toEqual({ p50: null, p95: null });
  });
});

describe('weightedMedian', () => {
  it('skips nulls and zero weights', () => {
    expect(
      weightedMedian([
        [null, 10],
        [300, 1],
        [100, 1],
        [200, 0],
      ]),
    ).toBe(100);
    expect(weightedMedian([[null, 5]])).toBeNull();
  });
});

describe('chartLines', () => {
  it('one line per location, oldest first, a failed bucket stays a gap', () => {
    const lines = chartLines(
      [
        row({ location: 'BKK', bucket_start: '2026-09-25T02:15:00Z', p50_ms: 220 }),
        row({ location: 'BKK', bucket_start: '2026-09-25T02:00:00Z', p50_ms: null }),
        row({ location: 'BKK', bucket_start: null, p50_ms: 210 }),
        row({ location: null, bucket_start: '2026-09-25T02:00:00Z', p50_ms: 300 }),
      ],
      ['BKK', 'SIN'],
    );
    expect(lines.BKK).toEqual([
      { t: Date.parse('2026-09-25T02:00:00Z'), ms: null },
      { t: Date.parse('2026-09-25T02:15:00Z'), ms: 220 },
    ]);
    expect(lines.SIN).toEqual([]);
  });
});

describe('labels (SiteDetail header, spec §7)', () => {
  it('Tier 1 is 24/7 and every minute; Tier 2–3 respond in office hours', () => {
    expect(responseHoursLabel(1)).toBe('24/7 response');
    expect(responseHoursLabel(2)).toBe('Mon–Fri 09:00–18:00');
    expect(intervalLabel(1)).toBe('Every 1 min');
    expect(intervalLabel(3)).toBe('Every 5 min');
  });
});

describe('client wording (spec §12)', () => {
  it.each([
    ['down', 'hard_fail', 'Down · Outage'],
    ['problem', 'regional', 'Problem · Degraded'],
    ['problem', 'slow', 'Problem · Degraded'],
    ['problem', 'key_page', 'Problem · Degraded'],
    ['problem', 'ssl', 'Problem · internal only'],
    ['problem', 'blocked_unverified', 'Problem · internal only'],
    ['problem', 'tls_chain', 'Problem'],
  ] as const)('%s %s → %s', (sev, trigger, line) => {
    expect(severityLine(sev, trigger)).toBe(line);
  });
  it('a TLS chain PROBLEM has no client word yet (D-029 → S21)', () => {
    expect(clientWord('problem', 'tls_chain')).toBeNull();
  });
});

describe('incident summaries (SiteDetail board, BA – Taiwan)', () => {
  const at = new Date('2026-09-14T14:12:00Z');
  const inc131: IncidentSummaryRow = { severity: 'problem', startedAt: at, minutes: 6 };
  const inc118: IncidentSummaryRow = { severity: 'down', startedAt: at, minutes: 11 };

  it('none → "None in range"', () => {
    expect(incidentsCaption([])).toBe('None in range');
  });
  it('30 d: one of each names its length, then the MTTR', () => {
    expect(incidentsCaption([inc131, inc118])).toBe(
      '1 DOWN 11 min · 1 PROBLEM 6 min · MTTR 11 min (DOWN only · median)',
    );
  });
  it('90 d: more than one of a kind are counted', () => {
    const p = { severity: 'problem' as const, startedAt: at, minutes: 14 };
    expect(incidentsCaption([inc131, inc118, p, p])).toBe(
      '1 DOWN 11 min · 3 PROBLEM · MTTR 11 min (DOWN only · median)',
    );
  });
  it('a DOWN still open has no MTTR', () => {
    expect(incidentsCaption([{ severity: 'down', startedAt: at, minutes: null }])).toBe('1 DOWN');
  });
});

describe('axisLabels (spec §13)', () => {
  const to = Date.parse('2026-09-25T03:07:00Z'); // Fri 25 Sep 10:07 Bangkok
  it('24 h: times, then now', () => {
    expect(axisLabels('24h', to - 86_400_000, to)).toEqual(['11:00', '17:00', '23:00', '05:00', 'now']);
  });
  it('7 d: weekday and day', () => {
    expect(axisLabels('7d', to - 7 * 86_400_000, to)[0]).toBe('Fri 18');
  });
  it('30 d: dates', () => {
    expect(axisLabels('30d', to - 30 * 86_400_000, to)[0]).toBe('26 Aug');
  });
});
