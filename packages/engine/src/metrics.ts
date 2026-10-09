/**
 * Response KPIs for the Overview (spec §21.3, PRD §2, D-032): MTTA and MTTD over DOWN incidents that
 * started in a window. Both are means (PRD §2 "Mean Time to …"):
 * - MTTA = acknowledged − confirmed down (`detected_at`), DOWN incidents of every tier acknowledged after
 *   they were confirmed down (one acked while still a PROBLEM, then raised to DOWN — D-021 — had nobody
 *   waiting on a DOWN ack, so it is left out rather than counted as 0);
 * - MTTD = confirmed down − first failed check of the outage, Tier 1 DOWN incidents, manual ones left out
 *   (a hand-opened incident has no detection to measure). A PROBLEM raised to DOWN (D-021) counts from
 *   `downStartedAt`, not from the PROBLEM's start — the same start uptime uses.
 * An incident falls in a window by when its outage started.
 * Neither is shown until the window holds `MIN_DOWN_INCIDENTS` DOWN incidents, open or closed.
 */
export const MIN_DOWN_INCIDENTS = 3;

export interface MetricIncident {
  severity: 'down' | 'problem';
  tier: number;
  startedAt: Date;
  /** When the outage started, for a PROBLEM raised to DOWN (the `escalated_to_down` event, D-021). */
  downStartedAt?: Date | null;
  detectedAt: Date | null;
  ackedAt: Date | null;
  isManual: boolean;
}

export interface ResponseKpis {
  /** DOWN incidents that started in the window. */
  downCount: number;
  /** True once `downCount` reaches `MIN_DOWN_INCIDENTS`; until then both means are null. */
  enough: boolean;
  /** Mean seconds from confirmed down to acknowledged; null when none was acknowledged. */
  mttaSeconds: number | null;
  /** Mean seconds from the first failed check to confirmed down (Tier 1); null when there is none. */
  mttdSeconds: number | null;
}

const mean = (values: readonly number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

const seconds = (from: Date, to: Date) => Math.max(0, (to.getTime() - from.getTime()) / 1000);

/** MTTA / MTTD over the DOWN incidents that started in [from, to). */
export function responseKpis(incidents: readonly MetricIncident[], from: Date, to: Date): ResponseKpis {
  const outageStart = (i: MetricIncident) => i.downStartedAt ?? i.startedAt;
  const down = incidents.filter(
    (i) => i.severity === 'down' && outageStart(i) >= from && outageStart(i) < to,
  );
  const enough = down.length >= MIN_DOWN_INCIDENTS;
  if (!enough) return { downCount: down.length, enough, mttaSeconds: null, mttdSeconds: null };
  const acks = down.flatMap((i) =>
    i.detectedAt && i.ackedAt && i.ackedAt >= i.detectedAt ? [seconds(i.detectedAt, i.ackedAt)] : [],
  );
  const detections = down.flatMap((i) =>
    i.tier === 1 && !i.isManual && i.detectedAt ? [seconds(outageStart(i), i.detectedAt)] : [],
  );
  return { downCount: down.length, enough, mttaSeconds: mean(acks), mttdSeconds: mean(detections) };
}

/** One incident's duration, as MTTR needs it. */
export interface DurationRow {
  severity: 'down' | 'problem';
  /** Minutes from its first failed check to recovered; null while still open. */
  minutes: number | null;
}

/**
 * MTTR · DOWN only · median (SiteDetail, Incidents; D-033): the median duration of the recovered DOWN
 * incidents, null with none. A median, as both boards caption it — unlike MTTA / MTTD (means, D-032).
 */
export function mttrMinutes(rows: readonly DurationRow[]): number | null {
  const d = rows
    .flatMap((r) => (r.severity === 'down' && r.minutes !== null ? [r.minutes] : []))
    .sort((a, b) => a - b);
  if (d.length === 0) return null;
  const mid = Math.floor(d.length / 2);
  return d.length % 2 ? d[mid]! : Math.round((d[mid - 1]! + d[mid]!) / 2);
}

/**
 * "vs last 30d" (Main3): the change from the previous window to this one, shown only when both have
 * a value (§21.3 hides it until there are enough incidents). Lower is better for both KPIs.
 */
export function kpiChange(
  current: number | null,
  previous: number | null,
): { seconds: number; direction: 'up' | 'down' | 'flat' } | null {
  if (current === null || previous === null) return null;
  const delta = current - previous;
  if (Math.round(delta) === 0) return { seconds: 0, direction: 'flat' };
  return { seconds: Math.abs(delta), direction: delta < 0 ? 'down' : 'up' };
}
