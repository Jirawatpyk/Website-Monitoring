import type { ResponseHours } from '@dxt/shared';
import type { Episode } from './lifecycle';
import { isInsideHours, minutesInsideHours } from './response-hours';

/**
 * Response KPIs for the Overview (spec §21.3, PRD §2, D-032, D-075): MTTA and MTTD over DOWN incidents
 * that started in a window. Both are means (PRD §2 "Mean Time to …"):
 * - MTTA = acknowledged − the confirm of the DOWN drop the ack answered (D-075: the latest drop of any
 *   severity confirmed at or before the ack, if it is a DOWN — INC-0038 was acked 6 min after it went
 *   down again, not 7 days after its first drop), DOWN incidents of every tier. One whose ack answered a
 *   PROBLEM drop (before any DOWN — D-021 — or PROBLEM AGAIN after an unacked DOWN) had nobody waiting
 *   on a DOWN ack, so it is left out rather than counted as 0.
 *   `ackedCount` says how many were counted, so a mean of one is never read as the team's response;
 * - MTTD = confirmed down − first failed check of the outage, Tier 1 DOWN incidents, manual ones left out
 *   (a hand-opened incident has no detection to measure). A PROBLEM raised to DOWN (D-021) counts from
 *   `downStartedAt`, not from the PROBLEM's start — the same start uptime uses.
 * For MTTA an incident falls in every window one of its DOWN drops started in, and its ack in the window
 * of the drop it answered (D-076); for MTTD, in the window its outage started in.
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
   * Every drop's confirm and severity (`metricDropsOf` over the incident's episodes, D-075). Absent: the
   * incident's `detectedAt` stands for its one DOWN drop, as before D-075.
   */
  drops?: readonly MetricDrop[];
}

/** A drop as MTTA reads it: when it started (the window, D-076), was confirmed, and at which severity. */
export interface MetricDrop {
  start: Date;
  confirmedAt: Date;
  severity: 'down' | 'problem';
}

/** The drops of an incident for MTTA (D-075); a drop's start stands in when no confirm is known. */
export function metricDropsOf(episodes: readonly Episode[]): MetricDrop[] {
  return episodes.map((e) => ({
    start: e.start,
    confirmedAt: e.confirmedAt ?? e.start,
    severity: e.severity,
  }));
}

const outageStartOf = (i: MetricIncident) => i.downStartedAt ?? i.startedAt;
const within = (d: Date, from: Date, to: Date) => d >= from && d < to;

/**
 * D-076: a DOWN incident falls in every window one of its DOWN drops started in — INC-0038, down 2 Nov
 * and again 10 Nov, is in the weeks of both. Without drops read, its outage start decides (D-032).
 */
function downInWindow(i: MetricIncident, from: Date, to: Date): boolean {
  if (i.severity !== 'down') return false;
  if (!i.drops?.length) return within(outageStartOf(i), from, to);
  return i.drops.some((d) => d.severity === 'down' && within(d.start, from, to));
}

/**
 * The confirm the ack answered (D-075): the latest drop confirmed at or before the ack, counted only if
 * it is a DOWN. An ack lands while the incident is Unacked / Escalated, which a recovery ends only once
 * the engine records it — so an ack a minute after the first OK check still answers that DOWN (engine
 * re-review M1), while one during a PROBLEM drop (after an unacked DOWN recovered, or before any DOWN,
 * D-021) answered no DOWN and is left out, never measured from a DOWN that ended days before.
 */
function ackedDrop(i: MetricIncident): { start: Date; confirmedAt: Date } | null {
  const acked = i.ackedAt;
  if (!acked) return null;
  if (!i.drops?.length)
    return i.detectedAt && acked >= i.detectedAt
      ? { start: outageStartOf(i), confirmedAt: i.detectedAt }
      : null;
  let latest: MetricDrop | null = null;
  for (const d of i.drops)
    if (d.confirmedAt <= acked && (!latest || d.confirmedAt >= latest.confirmedAt)) latest = d;
  return latest?.severity === 'down' ? latest : null;
}

/** The ack's wait in seconds, if the drop it answered started in [from, to) (D-075, D-076). */
function ackWait(i: MetricIncident, from: Date, to: Date): { confirmedAt: Date; ackedAt: Date } | null {
  const d = ackedDrop(i);
  return d && i.ackedAt && within(d.start, from, to)
    ? { confirmedAt: d.confirmedAt, ackedAt: i.ackedAt }
    : null;
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

/**
 * MTTA over the DOWN incidents with a DOWN drop that started in [from, to), each ack in the window of the
 * drop it answered (D-076); MTTD over the outages that began in it (its first failed check, D-032).
 */
export function responseKpis(incidents: readonly MetricIncident[], from: Date, to: Date): ResponseKpis {
  const down = incidents.filter((i) => downInWindow(i, from, to));
  const acks = down.flatMap((i) => {
    const w = ackWait(i, from, to);
    return w ? [seconds(w.confirmedAt, w.ackedAt)] : [];
  });
  const enough = down.length >= MIN_DOWN_INCIDENTS;
  const counts = { downCount: down.length, ackedCount: acks.length, enough };
  if (!enough) return { ...counts, mttaSeconds: null, mttdSeconds: null };
  const detections = incidents.flatMap((i) =>
    i.severity === 'down' && within(outageStartOf(i), from, to) && i.tier === 1 && !i.isManual && i.detectedAt
      ? [seconds(outageStartOf(i), i.detectedAt)]
      : [],
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
 * many of its DOWNs were acknowledged (`acked` of `down`; a DOWN confirmed outside hours and acked is
 * acknowledged but not in the mean).
 */
export function mttaByTier(
  incidents: readonly MetricIncident[],
  from: Date,
  to: Date,
  tiers: readonly number[],
  hours: ResponseHours,
): { tier: number; seconds: number | null; acked: number; down: number }[] {
  return tiers.map((tier) => {
    // D-076: the tier's DOWNs with a drop that started this week, each ack in its drop's week
    const down = incidents.filter((i) => i.tier === tier && downInWindow(i, from, to));
    let acked = 0;
    const acks = down.flatMap((i) => {
      const w = ackWait(i, from, to);
      if (!w) return [];
      acked += 1;
      if (tier === 1) return [seconds(w.confirmedAt, w.ackedAt)];
      if (!isInsideHours(w.confirmedAt, hours)) return [];
      return [minutesInsideHours(w.confirmedAt, w.ackedAt, hours) * 60];
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
