import 'server-only';
import type { DbClient } from '@dxt/db';
import { windowEnd, windowState, type MaintenanceWindow } from '@dxt/engine';

/** A site's maintenance windows as the engine needs them (D-036). */
export interface SiteWindows {
  /** A window is running now: nothing new opens and the site shows Maintenance. */
  active: boolean;
  /** When the latest window that ran ended (within a day): an incident it held back starts here. */
  lastEnd: Date | null;
}

const LOOKBACK_MS = 24 * 3_600_000;

/**
 * The approved maintenance windows of these sites that are running now or ended in the last day, one
 * entry per site that has any. Mutes aren't here: the engine reads them from `sites.muted_until`.
 */
export async function loadWindows(
  db: DbClient,
  siteIds: string[],
  now: Date,
): Promise<Map<string, SiteWindows>> {
  const out = new Map<string, SiteWindows>();
  if (!siteIds.length) return out;
  const { data, error } = await db
    .from('maintenance_windows')
    .select('site_id, kind, starts_at, ends_at, approved_at, ended_at, cancelled_at')
    .in('site_id', siteIds)
    .eq('kind', 'maintenance')
    .not('approved_at', 'is', null)
    .lte('starts_at', now.toISOString())
    .gte('ends_at', new Date(now.getTime() - LOOKBACK_MS).toISOString());
  if (error) throw new Error(`maintenance_windows: ${error.message}`);
  for (const r of data ?? []) {
    const w: MaintenanceWindow = {
      kind: 'maintenance',
      startsAt: new Date(r.starts_at),
      endsAt: new Date(r.ends_at),
      approvedAt: r.approved_at ? new Date(r.approved_at) : null,
      endedAt: r.ended_at ? new Date(r.ended_at) : null,
      cancelledAt: r.cancelled_at ? new Date(r.cancelled_at) : null,
    };
    const entry = out.get(r.site_id) ?? { active: false, lastEnd: null };
    const state = windowState(w, now);
    if (state === 'active') entry.active = true;
    else if (state === 'ended' || (state === 'cancelled' && w.endedAt)) {
      const end = windowEnd(w);
      if (!entry.lastEnd || end > entry.lastEnd) entry.lastEnd = end;
    }
    out.set(r.site_id, entry);
  }
  return out;
}
