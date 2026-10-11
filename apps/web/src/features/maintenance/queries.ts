import 'server-only';
import type { DbClient } from '@dxt/db';
import type { SiteStatus, Tier } from '@dxt/shared';
import type { PausableSite } from './model';
import type { LogEntry, WindowRow } from './page-model';

const DAY_MS = 86_400_000;

/**
 * Every window and mute `/maintenance`, the Overview card and Recent events need (spec §23, D-036): all
 * still to end, and the last 30 days of finished ones. Read as the signed-in person (staff read, RLS).
 */
export async function loadWindowRows(db: DbClient, now: Date): Promise<WindowRow[]> {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const { data, error } = await db
    .from('maintenance_windows')
    .select(
      `id, site_id, kind, starts_at, ends_at, approved_at, approved_by, ended_at, cancelled_at, created_at, created_by,
       reason, end_reason, outcome, outcome_detail, log,
       creator:profiles!maintenance_windows_created_by_fkey(display_name),
       sites!inner(name, tier, primary_owner_id, backup_owner_id, muted_until,
                   owner:profiles!sites_primary_owner_id_fkey(display_name),
                   backup:profiles!sites_backup_owner_id_fkey(display_name),
                   site_status(status))`,
    )
    .or(`ends_at.gte.${since},cancelled_at.gte.${since}`)
    .order('starts_at');
  if (error) throw new Error(`maintenance_windows: ${error.message}`);
  return (data ?? []).map((w) => {
    const status = Array.isArray(w.sites.site_status) ? w.sites.site_status[0] : w.sites.site_status;
    return {
      id: w.id,
      siteId: w.site_id,
      siteName: w.sites.name,
      tier: w.sites.tier as Tier,
      siteStatus: (status?.status ?? null) as SiteStatus | null,
      kind: w.kind as WindowRow['kind'],
      startsAt: w.starts_at,
      endsAt: w.ends_at,
      approvedAt: w.approved_at,
      approvedById: w.approved_by,
      endedAt: w.ended_at,
      cancelledAt: w.cancelled_at,
      createdAt: w.created_at,
      createdById: w.created_by,
      outcome: w.outcome as WindowRow['outcome'],
      outcomeDetail: w.outcome_detail,
      reason: w.reason,
      endReason: w.end_reason,
      byName: w.creator?.display_name ?? null,
      ownerName: w.sites.owner?.display_name ?? null,
      backupName: w.sites.backup?.display_name ?? null,
      ownerIds: [w.sites.primary_owner_id, w.sites.backup_owner_id].filter((x): x is string => !!x),
      log: (Array.isArray(w.log) ? w.log : []) as unknown as LogEntry[],
    };
  });
}

/** The live sites, with what the dialog's guard needs; the page keeps the ones this person may act on. */
export async function loadPausableSites(db: DbClient): Promise<(PausableSite & { ownerIds: string[] })[]> {
  const { data, error } = await db
    .from('sites')
    .select(
      `id, name, tier, muted_until, primary_owner_id, backup_owner_id,
       owner:profiles!sites_primary_owner_id_fkey(display_name),
       site_status(status),
       incidents(id, number, state, escalation_level, detected_at, acker:profiles!incidents_acked_by_fkey(display_name))`,
    )
    .eq('is_active', true)
    .not('incidents.state', 'in', '(resolved,in_review,closed)')
    .order('name');
  if (error) throw new Error(`sites: ${error.message}`);
  return (data ?? []).map((s) => {
    const status = Array.isArray(s.site_status) ? s.site_status[0] : s.site_status;
    const inc = s.incidents[0];
    return {
      id: s.id,
      name: s.name,
      tier: s.tier as Tier,
      owner: s.owner?.display_name ?? null,
      status: (status?.status ?? null) as SiteStatus | null,
      mutedUntil: s.muted_until,
      openIncident: inc
        ? {
            id: inc.id,
            number: inc.number,
            state: inc.state as NonNullable<PausableSite['openIncident']>['state'],
            level: inc.escalation_level,
            detectedAt: inc.detected_at,
            ackedBy: inc.acker?.display_name ?? null,
          }
        : null,
      ownerIds: [s.primary_owner_id, s.backup_owner_id].filter((x): x is string => !!x),
    };
  });
}
