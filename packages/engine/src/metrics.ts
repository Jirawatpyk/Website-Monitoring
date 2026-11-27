import type { ResponseHours } from '@dxt/shared';
import type { Episode } from './lifecycle';
import { isInsideHours, minutesInsideHours } from './response-hours';

/**
 * Response KPIs for the Overview (spec §21.3, PRD §2, D-032, D-075): MTTA and MTTD over DOWN incidents
 * that started in a window. Both are means (PRD §2 "Mean Time to …"):
 * - MTTA = acknowledged − the confirm of the DOWN drop the ack answered (D-075: the latest DOWN drop
 *   confirmed at or before the ack — INC-0038 was acked 6 min after it went down again, not 7 days after
 *   its first drop), DOWN incidents of every tier. One acked before any DOWN drop (still a PROBLEM, then
 *   raised to DOWN — D-021) had nobody waiting on a DOWN ack, so it is left out rather than counted as 0.
 *   `ackedCount` says how many were counted, so a mean of one is never read as the team's response;
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
  /**
   * Each DOWN drop's confirm and end (`downDropsOf` over the incident's episodes, D-075). Absent: the
   * incident's `detectedAt` stands for its one drop, as before D-075.
   */
  downDrops?: readonly MetricDrop[];
}

/** A DOWN drop as MTTA reads it: confirmed at, and over at (null while still down). */
export interface MetricDrop {
  confirmedAt: Date;
  end: Date | null;
}

/** The DOWN drops of an incident (D-075); a drop's start stands in when no confirm is known. */
export function downDropsOf(episodes: readonly Episode[]): MetricDrop[] {
  return episodes
    .filter((e) => e.severity === 'down')
    .map((e) => ({ confirmedAt: e.confirmedAt ?? e.start, end: e.end }));
}

/**
 * The confirm the ack answered (D-075): the DOWN drop open at the ack (confirmed at or before it, not
 * over before it). An ack only lands while the incident is Unacked / Escalated, so in a drop: one given
 * during a PROBLEM drop — after an unacked DOWN drop recovered, or before any DOWN — answered no DOWN
 * and is left out (engine review M1), not measured from a DOWN that ended days before.
 */
function ackedDropConfirm(i: MetricIncident): Date | null {
  const acked = i.ackedAt;
  if (!acked) return null;
  if (!i.downDrops) return i.detectedAt && acked >= i.detectedAt ? i.detectedAt : null;
  let found: Date | null = null;
  for (const d of i.downDrops) {
    const open = d.confirmedAt <= acked && (d.end === null || d.end > acked);
    if (open && (!found || d.confirmedAt > found)) found = d.confirmedAt;
  }
  return found;
}

export interface ResponseKpis {
  /** DOWN incidents that started in the window. */
  downCount: number;
  /** Of those, the ones acknowledged after a DOWN drop: the n of "n of N acknowledged" (D-075). */
  ackedCount: number;
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
  const acks = down.flatMap((i) => {
    const confirm = ackedDropConfirm(i);
    return confirm && i.ackedAt ? [seconds(confirm, i.ackedAt)] : [];
  });
  const enough = down.length >= MIN_DOWN_INCIDENTS;
  const counts = { downCount: down.length, ackedCount: acks.length, enough };
  if (!enough) return { ...counts, mttaSeconds: null, mttdSeconds: null };
  const detections = down.flatMap((i) =>
    i.tier === 1 && !i.isManual && i.detectedAt ? [seconds(outageStart(i), i.detectedAt)] : [],
  );
  return { ...counts, mttaSeconds: mean(acks), mttdSeconds: mean(detections) };
}

/**
 * The weekly summary's "MTTA DOWN (response hours)" (WeeklySummary, spec §15.7, D-056): per tier, the
 * mean wait from confirmed down to acknowledged over the DOWNs whose outage started in [from, to) —
 * Tier 1 at any hour (24/7, on the clock); Tier 2–3 only those confirmed down inside response hours,
 * where the ladder clock starts, and counted in response-hour minutes as their L1 delay is (D-034) —
 * Fri 17:58 → Mon 09:05 waited 7 min, not 63 h (engine review S14). Null for a tier with none: "— (no
 * DOWN inside response hours)". No minimum count, unlike the Overview. D-075: the wait counts from the
 * confirm of the drop the ack answered (the hours gate reads that confirm too), and each tier says how
 * many of its DOWNs were acknowledged (`acked` of `down`; an ack outside hours is acknowledged but not in
 * the mean).
 */
export function mttaByTier(
  incidents: readonly MetricIncident[],
  from: Date,
  to: Date,
  tiers: readonly number[],
  hours: ResponseHours,
): { tier: number; seconds: number | null; acked: number; down: number }[] {
  const outageStart = (i: MetricIncident) => i.downStartedAt ?? i.startedAt;
  return tiers.map((tier) => {
    const down = incidents.filter((i) => {
      const start = outageStart(i);
      return i.severity === 'down' && i.tier === tier && start >= from && start < to;
    });
    let acked = 0;
    const acks = down.flatMap((i) => {
      const confirm = ackedDropConfirm(i);
      if (!confirm || !i.ackedAt) return [];
      acked += 1;
      if (tier === 1) return [seconds(confirm, i.ackedAt)];
      if (!isInsideHours(confirm, hours)) return [];
      return [minutesInsideHours(confirm, i.ackedAt, hours) * 60];
    });
    return { tier, seconds: mean(acks), acked, down: down.length };
  });
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
