/**
 * Response KPIs for the Overview (spec §21.3, PRD §2, D-032): MTTA and MTTD over DOWN incidents that
 * started in a window. Both are means (PRD §2 "Mean Time to …"):
 * - MTTA = acknowledged − confirmed down (`detected_at`), DOWN incidents of every tier that were acknowledged;
 * - MTTD = confirmed down − first failed check (`started_at`), Tier 1 DOWN incidents, manual ones left out
 *   (a hand-opened incident has no detection to measure).
 * Neither is shown until the window holds `MIN_DOWN_INCIDENTS` DOWN incidents, open or closed.
 */
export const MIN_DOWN_INCIDENTS = 3;

export interface MetricIncident {
  severity: 'down' | 'problem';
  tier: number;
  startedAt: Date;
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
  const down = incidents.filter((i) => i.severity === 'down' && i.startedAt >= from && i.startedAt < to);
  const enough = down.length >= MIN_DOWN_INCIDENTS;
  if (!enough) return { downCount: down.length, enough, mttaSeconds: null, mttdSeconds: null };
  const acks = down.flatMap((i) => (i.detectedAt && i.ackedAt ? [seconds(i.detectedAt, i.ackedAt)] : []));
  const detections = down.flatMap((i) =>
    i.tier === 1 && !i.isManual && i.detectedAt ? [seconds(i.startedAt, i.detectedAt)] : [],
  );
  return { downCount: down.length, enough, mttaSeconds: mean(acks), mttdSeconds: mean(detections) };
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
