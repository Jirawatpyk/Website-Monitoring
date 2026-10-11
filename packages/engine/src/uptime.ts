import type { Episode } from './lifecycle';
import type { Span } from './maintenance';

/**
 * Uptime (spec §5, PRD §5): only DOWN minutes count against it; PROBLEM counts as up; mute is counted;
 * maintenance is removed from both sides.
 */
export interface UptimeWindow {
  windowMinutes: number;
  downMinutes: number;
  maintenanceMinutes: number;
}

/** site uptime = 1 − DOWN minutes / (minutes in window − maintenance minutes) */
export function siteUptime({ windowMinutes, downMinutes, maintenanceMinutes }: UptimeWindow): number {
  const counted = windowMinutes - maintenanceMinutes;
  if (counted <= 0) return 1;
  return 1 - Math.min(downMinutes, counted) / counted;
}

/**
 * DOWN minutes inside [from, to): every DOWN drop clipped to the window, a drop still in progress
 * running to `to`. PROBLEM drops count as up (spec §5).
 */
export function downMinutesIn(episodes: readonly Episode[], from: Date, to: Date): number {
  let ms = 0;
  for (const e of episodes) {
    if (e.severity !== 'down') continue;
    const start = Math.max(e.start.getTime(), from.getTime());
    const end = Math.min((e.end ?? to).getTime(), to.getTime());
    if (end > start) ms += end - start;
  }
  return ms / 60_000;
}

/** Minutes of `spans` inside [from, to), overlapping spans counted once. */
export function spanMinutesIn(spans: readonly Span[], from: Date, to: Date): number {
  return clipped(spans, from, to).reduce((sum, [a, b]) => sum + (b - a), 0) / 60_000;
}

/** DOWN minutes inside [from, to) that fall inside `spans` (maintenance): they leave the numerator. */
export function downMinutesInside(
  episodes: readonly Episode[],
  spans: readonly Span[],
  from: Date,
  to: Date,
): number {
  const parts = clipped(spans, from, to);
  let ms = 0;
  for (const e of episodes) {
    if (e.severity !== 'down') continue;
    const es = e.start.getTime();
    const ee = (e.end ?? to).getTime();
    for (const [a, b] of parts) {
      const start = Math.max(es, a);
      const end = Math.min(ee, b);
      if (end > start) ms += end - start;
    }
  }
  return ms / 60_000;
}

/** Spans clipped to [from, to), sorted and merged, as [start, end) in ms. */
function clipped(spans: readonly Span[], from: Date, to: Date): [number, number][] {
  const out: [number, number][] = [];
  const parts = spans
    .map((x): [number, number] => [
      Math.max(x.start.getTime(), from.getTime()),
      Math.min(x.end.getTime(), to.getTime()),
    ])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  for (const [a, b] of parts) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * A site's uptime over the last `rangeMinutes` (D-031): the window starts no earlier than monitoring
 * started, so a site watched for 3 days isn't credited with 27 unwatched ones. Null for a site that was
 * never monitored. Maintenance (`maintenanceSpans`, D-036) leaves both sides: its minutes leave the
 * window and the DOWN minutes inside it leave the count.
 */
export function siteUptimeOver(
  episodes: readonly Episode[],
  {
    now,
    rangeMinutes,
    monitoringStartedAt,
    maintenance = [],
  }: { now: Date; rangeMinutes: number; monitoringStartedAt: Date | null; maintenance?: readonly Span[] },
): { uptime: number; downMinutes: number; windowMinutes: number; maintenanceMinutes: number } | null {
  if (!monitoringStartedAt || monitoringStartedAt >= now) return null;
  const from = new Date(Math.max(now.getTime() - rangeMinutes * 60_000, monitoringStartedAt.getTime()));
  const windowMinutes = (now.getTime() - from.getTime()) / 60_000;
  const maintenanceMinutes = spanMinutesIn(maintenance, from, now);
  const downMinutes =
    downMinutesIn(episodes, from, now) - downMinutesInside(episodes, maintenance, from, now);
  return {
    uptime: siteUptime({ windowMinutes, downMinutes, maintenanceMinutes }),
    downMinutes,
    windowMinutes,
    maintenanceMinutes,
  };
}

/** All-sites uptime, time-weighted across sites. */
export function aggregateUptime(sites: readonly UptimeWindow[]): number {
  let down = 0;
  let counted = 0;
  for (const s of sites) {
    const c = Math.max(0, s.windowMinutes - s.maintenanceMinutes);
    counted += c;
    down += Math.min(s.downMinutes, c);
  }
  return counted === 0 ? 1 : 1 - down / counted;
}
