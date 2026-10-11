import 'server-only';
import type { DbClient } from '@dxt/db';
import { maintenanceSpans, type MaintenanceWindow, type Span } from '@dxt/engine';

/** A site's maintenance windows as the engine needs them (D-036). */
export interface SiteWindows {
  /** The windows that ran or are running (approved, not cancelled before they started). */
  spans: Span[];
}

const LOOKBACK_MS = 24 * 3_600_000;

/**
 * Whether `at` — the moment a round's failure was confirmed — falls inside a window. The engine judges
 * by the round's own time, not by when the run happens: a DOWN confirmed a second before a window
 * starts isn't hidden, and one confirmed inside it stays inside (engine review H1, M1).
 */
export function inWindow(w: SiteWindows | undefined, at: Date): boolean {
  return !!w?.spans.some((s) => s.start <= at && at < s.end);
}

/** When the latest window that ended at or before `at` ended: an incident it held back starts there. */
export function endedBefore(w: SiteWindows | undefined, at: Date): Date | null {
  let last: Date | null = null;
  for (const s of w?.spans ?? []) if (s.end <= at && (!last || s.end > last)) last = s.end;
  return last;
}

/**
 * The approved maintenance windows of these sites that started by now and ended in the last day, one
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
  const bySite = new Map<string, MaintenanceWindow[]>();
  for (const r of data ?? []) {
    const list = bySite.get(r.site_id) ?? [];
    list.push({
      kind: 'maintenance',
      startsAt: new Date(r.starts_at),
      endsAt: new Date(r.ends_at),
      approvedAt: r.approved_at ? new Date(r.approved_at) : null,
      endedAt: r.ended_at ? new Date(r.ended_at) : null,
      cancelledAt: r.cancelled_at ? new Date(r.cancelled_at) : null,
    });
    bySite.set(r.site_id, list);
  }
  for (const [siteId, list] of bySite) out.set(siteId, { spans: maintenanceSpans(list, []) });
  return out;
}
