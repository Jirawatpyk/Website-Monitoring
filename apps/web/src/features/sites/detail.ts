import { mttrMinutes } from '@dxt/engine';
/**
 * Site detail (spec §20 → `/sites/[siteId]`, boards SiteDetail / MSite): the pure rules the page uses —
 * ranges, how range stats are read from the response series, incident summaries and the client
 * wording of spec §12. No I/O, no clock (`now` is passed in).
 */
import {
  formatDay,
  formatDuration,
  formatTime,
  TIER_CONFIG,
  TRIGGER_LABELS,
  type Severity,
  type Tier,
  type Trigger,
} from '@dxt/shared';

export const SITE_RANGES = {
  '24h': { label: '24 h', minutes: 1440, bucket: '15m' },
  '7d': { label: '7 d', minutes: 7 * 1440, bucket: 'hour' },
  '30d': { label: '30 d', minutes: 30 * 1440, bucket: 'day' },
  '90d': { label: '90 d', minutes: 90 * 1440, bucket: 'day' },
} as const;
export type SiteRange = keyof typeof SITE_RANGES;
export const SITE_RANGE_KEYS = Object.keys(SITE_RANGES) as SiteRange[];
export const DEFAULT_RANGE: SiteRange = '24h';

export function rangeOf(v: string | string[] | undefined): SiteRange {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s in SITE_RANGES ? (s as SiteRange) : DEFAULT_RANGE;
}

/** One row of `site_response_series` (location / bucket_start null = all / the whole range). */
export interface SeriesRow {
  location: string | null;
  bucket_start: string | null;
  checks: number;
  hard_fails: number;
  p50_ms: number | null;
  p95_ms: number | null;
}

/**
 * p50 / p95 over a range (D-031): exact when the series has a whole-range total (24 h, raw checks);
 * otherwise the all-locations buckets' values, the median weighted by each bucket's checks.
 */
export function rangeStats(rows: readonly SeriesRow[]): { p50: number | null; p95: number | null } {
  const total = rows.find((r) => r.location === null && r.bucket_start === null);
  if (total) return { p50: total.p50_ms, p95: total.p95_ms };
  const buckets = rows.filter((r) => r.location === null && r.bucket_start !== null);
  return {
    p50: weightedMedian(buckets.map((r) => [r.p50_ms, r.checks])),
    p95: weightedMedian(buckets.map((r) => [r.p95_ms, r.checks])),
  };
}

/** The value in the middle of the weights; null values and empty weights are skipped. */
export function weightedMedian(pairs: readonly (readonly [number | null, number])[]): number | null {
  const v = pairs.filter((p): p is [number, number] => p[0] !== null && p[1] > 0).sort((a, b) => a[0] - b[0]);
  const total = v.reduce((s, p) => s + p[1], 0);
  if (total === 0) return null;
  let run = 0;
  for (const [value, w] of v) {
    run += w;
    if (run >= total / 2) return value;
  }
  return v.at(-1)![0];
}

export interface ChartPoint {
  t: number;
  ms: number | null;
}

/** The chart's lines: one per location, oldest first; a bucket with no passing check is a gap. */
export function chartLines(
  rows: readonly SeriesRow[],
  locations: readonly string[],
): Record<string, ChartPoint[]> {
  const out: Record<string, ChartPoint[]> = {};
  for (const loc of locations) {
    out[loc] = rows
      .filter((r) => r.location === loc && r.bucket_start !== null)
      .map((r) => ({ t: Date.parse(r.bucket_start!), ms: r.p50_ms }))
      .sort((a, b) => a.t - b.t);
  }
  return out;
}

/** "24/7 response" for Tier 1; Tier 2–3 respond Mon–Fri 09:00–18:00 (spec §7). */
export function responseHoursLabel(tier: Tier): string {
  return TIER_CONFIG[tier].alwaysOn ? '24/7 response' : 'Mon–Fri 09:00–18:00';
}

export function intervalLabel(tier: Tier): string {
  return `Every ${TIER_CONFIG[tier].intervalSec / 60} min`;
}

/**
 * What a client is told about an incident (spec §12): DOWN → Outage; slow, key page, regional →
 * Degraded; the rest is internal only. A TLS chain PROBLEM gets no client word yet (D-029 → S21).
 */
export function clientWord(severity: Severity, trigger: Trigger): string | null {
  if (severity === 'down') return 'Outage';
  if (trigger === 'slow' || trigger === 'key_page' || trigger === 'regional') return 'Degraded';
  if (trigger === 'tls_chain') return null;
  return 'internal only';
}

/** "Down · Outage", "Problem · Degraded", "Problem · internal only", or just "Problem". */
export function severityLine(severity: Severity, trigger: Trigger): string {
  const word = clientWord(severity, trigger);
  const sev = severity === 'down' ? 'Down' : 'Problem';
  return word ? `${sev} · ${word}` : sev;
}

export function triggerWord(trigger: Trigger): string {
  return TRIGGER_LABELS[trigger];
}

/** An incident of the site, as the summaries need it. */
export interface IncidentSummaryRow {
  severity: Severity;
  startedAt: Date;
  /** Minutes it was down or had a problem (its drops), null while still open. */
  minutes: number | null;
}

/**
 * The Incidents stat's caption (SiteDetail board): "None in range"; one of a kind names its length
 * ("1 DOWN 11 min · 1 PROBLEM 6 min"); more just count ("1 DOWN · 3 PROBLEM"); then the MTTR.
 */
export function incidentsCaption(rows: readonly IncidentSummaryRow[]): string {
  if (rows.length === 0) return 'None in range';
  const part = (sev: Severity, word: string) => {
    const of = rows.filter((r) => r.severity === sev);
    if (of.length === 0) return null;
    const only = of.length === 1 ? of[0]!.minutes : null;
    return `${of.length} ${word}${only !== null ? ` ${formatDuration(only)}` : ''}`;
  };
  const counts = [part('down', 'DOWN'), part('problem', 'PROBLEM')].filter(Boolean).join(' · ');
  const mttr = mttrMinutes(rows);
  return mttr === null ? counts : `${counts} · MTTR ${formatDuration(mttr)} (DOWN only · median)`;
}

/** The chart's x labels: four ticks and "now" — times for 24 h, weekdays for 7 d, dates beyond (spec §13). */
export function axisLabels(range: SiteRange, from: number, to: number): string[] {
  // 24 h ticks fall on the hour, six hours apart ("10:00, 16:00 …", SiteDetail board)
  const hour = 3_600_000;
  const start = range === '24h' ? Math.ceil(from / hour) * hour : from;
  const step = range === '24h' ? 6 * hour : (to - from) / 4;
  const ticks = [0, 1, 2, 3].map((i) => new Date(start + step * i));
  const word = (d: Date) =>
    range === '24h'
      ? formatTime(d)
      : range === '7d'
        ? formatDay(d, { weekday: true }).split(' ').slice(0, 2).join(' ')
        : formatDay(d);
  return [...ticks.map(word), 'now'];
}
