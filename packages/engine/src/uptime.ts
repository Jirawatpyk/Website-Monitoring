import type { Episode } from './lifecycle';

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

/**
 * A site's uptime over the last `rangeMinutes` (D-031): the window starts no earlier than monitoring
 * started, so a site watched for 3 days isn't credited with 27 unwatched ones. Null for a site that was
 * never monitored. Maintenance is 0 until windows exist (S09).
 */
export function siteUptimeOver(
  episodes: readonly Episode[],
  {
    now,
    rangeMinutes,
    monitoringStartedAt,
  }: { now: Date; rangeMinutes: number; monitoringStartedAt: Date | null },
): { uptime: number; downMinutes: number; windowMinutes: number } | null {
  if (!monitoringStartedAt || monitoringStartedAt >= now) return null;
  const from = new Date(Math.max(now.getTime() - rangeMinutes * 60_000, monitoringStartedAt.getTime()));
  const windowMinutes = (now.getTime() - from.getTime()) / 60_000;
  const downMinutes = downMinutesIn(episodes, from, now);
  return {
    uptime: siteUptime({ windowMinutes, downMinutes, maintenanceMinutes: 0 }),
    downMinutes,
    windowMinutes,
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
