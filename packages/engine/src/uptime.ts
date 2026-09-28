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
