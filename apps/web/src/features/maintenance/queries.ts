import 'server-only';
import type { DbClient } from '@dxt/db';
import type { WindowRow } from './card-model';

/**
 * Windows and mutes the Overview card and Recent events need (D-036): everything still to end, and
 * what ended or changed in the last day. Read as the signed-in person (staff read, RLS).
 */
export async function loadWindowRows(db: DbClient, now: Date): Promise<WindowRow[]> {
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const { data, error } = await db
    .from('maintenance_windows')
    .select(
      `id, site_id, kind, starts_at, ends_at, approved_at, ended_at, cancelled_at, created_at, reason, end_reason,
       creator:profiles!maintenance_windows_created_by_fkey(display_name),
       ender:profiles!maintenance_windows_ended_by_fkey(display_name),
       sites!inner(name, primary_owner_id, backup_owner_id, owner:profiles!sites_primary_owner_id_fkey(display_name))`,
    )
    .or(`ends_at.gte.${since},created_at.gte.${since},cancelled_at.gte.${since}`)
    .order('starts_at');
  if (error) throw new Error(`maintenance_windows: ${error.message}`);
  return (data ?? []).map((w) => ({
    id: w.id,
    siteId: w.site_id,
    siteName: w.sites.name,
    kind: w.kind as WindowRow['kind'],
    startsAt: w.starts_at,
    endsAt: w.ends_at,
    approvedAt: w.approved_at,
    endedAt: w.ended_at,
    cancelledAt: w.cancelled_at,
    createdAt: w.created_at,
    reason: w.reason,
    endReason: w.end_reason,
    byName: w.creator?.display_name ?? null,
    endedByName: w.ender?.display_name ?? null,
    ownerName: w.sites.owner?.display_name ?? null,
    ownerIds: [w.sites.primary_owner_id, w.sites.backup_owner_id].filter((x): x is string => !!x),
  }));
}
