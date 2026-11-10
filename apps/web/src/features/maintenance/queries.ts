import 'server-only';
import type { DbClient } from '@dxt/db';
import { isInsideHours, nextOpening } from '@dxt/engine';
import { loadResponseHours } from '@/server/escalation/response-hours';
import {
  escalationPlanSchema,
  TIER_CONFIG,
  type EscalationPlan,
  type SiteStatus,
  type Tier,
} from '@dxt/shared';
import type { PausableSite } from './model';
import type { LogEntry, WindowRow } from './page-model';
import type { SeriesRow } from './series-model';

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
       reason, end_reason, outcome, outcome_detail, log, series_id,
       creator:profiles!maintenance_windows_created_by_fkey(display_name),
       sites!inner(name, tier, primary_owner_id, backup_owner_id, muted_until,
                   owner:profiles!sites_primary_owner_id_fkey(display_name, role),
                   backup:profiles!sites_backup_owner_id_fkey(display_name, role),
                   site_status(status),
                   client:clients(am_user_id),
                   incidents(number, state, severity, episode_severity, detected_at, alerted_at, escalation_plan))`,
    )
    .in('sites.incidents.state', ['unacked', 'escalated'])
    .or(`ends_at.gte.${since},cancelled_at.gte.${since}`)
    .order('starts_at');
  if (error) throw new Error(`maintenance_windows: ${error.message}`);
  const rows = (data ?? []).map((w): WindowRow => {
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
      ownerIsAdmin: w.sites.owner?.role === 'admin',
      backupIsAdmin: w.sites.backup?.role === 'admin',
      log: (Array.isArray(w.log) ? w.log : []) as unknown as LogEntry[],
      seriesId: w.series_id,
      silenced: w.kind === 'mute' ? silencedOf(w.sites.incidents, w.starts_at, w.sites.tier) : null,
    };
  });
  const people = new Map(
    (data ?? []).map((w) => [
      w.id,
      {
        owner: w.sites.primary_owner_id,
        backup: w.sites.backup_owner_id,
        am: (Array.isArray(w.sites.client) ? w.sites.client[0] : w.sites.client)?.am_user_id ?? null,
        plan: w.kind === 'mute' ? heldPlan(w.sites.incidents, w.starts_at) : null,
      },
    ]),
  );
  return withPausedUntil(db, await withL1People(db, rows, people), now);
}

/**
 * The repeating series `/maintenance` shows (spec §32, D-057): every one still waiting or repeating,
 * and those that ended in the last 30 days, with their windows still to start (for "next …") and the
 * windows a cancel took. Read as the signed-in person (staff read, RLS).
 */
export async function loadSeriesRows(db: DbClient, now: Date): Promise<SeriesRow[]> {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const { data, error } = await db
    .from('maintenance_series')
    .select(
      `id, site_id, rule, start_time, duration_min, starts_on, until_on, first_starts_at, reason, created_at,
       created_by, approved_at, approved_by, declined_at, cancelled_at, outcome, log,
       creator:profiles!maintenance_series_created_by_fkey(display_name),
       approver:profiles!maintenance_series_approved_by_fkey(display_name),
       sites!inner(name, tier, primary_owner_id, backup_owner_id,
                   owner:profiles!sites_primary_owner_id_fkey(display_name, role),
                   backup:profiles!sites_backup_owner_id_fkey(display_name, role),
                   site_status(status)),
       maintenance_windows(starts_at, ends_at, ended_at, cancelled_at, start_logged, created_at)`,
    )
    // Live series, and those that ended (cancelled, declined, or past their last day) in the 30 days;
    // only the windows of those 30 days and after — a no-end series keeps adding them (code review).
    .or(
      `and(cancelled_at.is.null,declined_at.is.null,or(until_on.is.null,until_on.gte.${since.slice(0, 10)})),cancelled_at.gte.${since},declined_at.gte.${since}`,
    )
    .gte('maintenance_windows.ends_at', since)
    .order('created_at');
  if (error) throw new Error(`maintenance_series: ${error.message}`);
  return (data ?? []).map((s): SeriesRow => {
    const status = Array.isArray(s.sites.site_status) ? s.sites.site_status[0] : s.sites.site_status;
    const windows = s.maintenance_windows ?? [];
    return {
      id: s.id,
      siteId: s.site_id,
      siteName: s.sites.name,
      tier: s.sites.tier as Tier,
      siteStatus: (status?.status ?? null) as SiteStatus | null,
      rule: s.rule,
      startTime: s.start_time,
      durationMin: s.duration_min,
      startsOn: s.starts_on,
      untilOn: s.until_on,
      firstStartsAt: s.first_starts_at,
      reason: s.reason,
      createdAt: s.created_at,
      createdById: s.created_by,
      byName: s.creator?.display_name ?? null,
      approvedAt: s.approved_at,
      approvedById: s.approved_by,
      approverName: s.approver?.display_name ?? null,
      declinedAt: s.declined_at,
      cancelledAt: s.cancelled_at,
      outcome: s.outcome,
      ownerName: s.sites.owner?.display_name ?? null,
      backupName: s.sites.backup?.display_name ?? null,
      ownerIds: [s.sites.primary_owner_id, s.sites.backup_owner_id].filter((x): x is string => !!x),
      ownerIsAdmin: s.sites.owner?.role === 'admin',
      backupIsAdmin: s.sites.backup?.role === 'admin',
      log: (Array.isArray(s.log) ? s.log : []) as unknown as LogEntry[],
      upcoming: windows
        .filter((w) => !w.cancelled_at && !w.start_logged && Date.parse(w.starts_at) > now.getTime())
        .map((w) => w.starts_at)
        .sort(),
      running: windows.some(
        (w) => w.start_logged && !w.cancelled_at && Date.parse(w.ended_at ?? w.ends_at) > now.getTime(),
      ),
      // Made in the approval's own transaction: the same `now()` as approved_at. Only for an approval inside
      // the 30 days the windows are read for — an older one's windows have dropped out, so no count at all.
      approvalWindows:
        s.approved_at && Date.parse(s.approved_at) >= Date.parse(since)
          ? windows
              .filter((w) => Date.parse(w.created_at) === Date.parse(s.approved_at!))
              .map((w) => w.starts_at)
              .sort()
          : [],
      cancelledWindows: s.cancelled_at
        ? windows
            .filter((w) => w.cancelled_at === s.cancelled_at)
            .map((w) => w.starts_at)
            .sort()
        : [],
    };
  });
}

/** The escalation plan of the incident a mute holds (`silencedOf`'s incident). */
function heldPlan(
  incidents: { detected_at: string; alerted_at: string | null; escalation_plan: unknown }[],
  mutedFrom: string,
) {
  const i = incidents.find((x) => !x.alerted_at && Date.parse(x.detected_at) >= Date.parse(mutedFrom));
  const plan = i ? escalationPlanSchema.safeParse(i.escalation_plan) : null;
  return plan?.success ? plan.data : null;
}

/**
 * Whether L1 tells anyone new — the notifier's rule (the step's people minus those L0 told). With
 * nobody (no backup, the Admins already told), End mute promises no L1 and no escalation (§24.16,
 * staging /verify). The Admins are read only when a mute holds an incident.
 */
async function withL1People(
  db: DbClient,
  rows: WindowRow[],
  people: Map<
    string,
    { owner: string | null; backup: string | null; am: string | null; plan: EscalationPlan | null }
  >,
): Promise<WindowRow[]> {
  if (!rows.some((r) => r.silenced)) return rows;
  const { data, error } = await db.from('profiles').select('id').eq('role', 'admin').eq('is_active', true);
  if (error) return rows;
  const admins = (data ?? []).map((p) => p.id);
  return rows.map((r) => {
    const p = people.get(r.id);
    if (!r.silenced || !p?.plan) return r;
    const of = (token: string): string[] =>
      token === 'owner'
        ? p.owner
          ? [p.owner]
          : []
        : token === 'backup'
          ? p.backup
            ? [p.backup]
            : []
          : token === 'site_am'
            ? p.am
              ? [p.am]
              : []
            : token === 'admins'
              ? admins
              : [];
    const told = new Set(p.plan.steps.filter((s) => s.level < 1).flatMap((s) => s.targets.flatMap(of)));
    const l1 = p.plan.steps.find((s) => s.level === 1);
    const anyoneNew = !!l1 && l1.targets.flatMap(of).some((id) => !told.has(id));
    return anyoneNew ? r : { ...r, silenced: { ...r.silenced, l1DelayMin: null, escalates: false } };
  });
}

/**
 * An incident this mute kept quiet: opened while it ran, never alerted, nobody on it yet. Ending the
 * mute posts its first alert and starts its ladder (§24.9, D-036) — L1's delay when its timers run at
 * every hour (Tier 1), else unknown here (Tier 2–3 count inside response hours).
 */
function silencedOf(
  incidents: {
    number: number;
    state: string;
    severity: string;
    episode_severity: string | null;
    detected_at: string;
    alerted_at: string | null;
    escalation_plan: unknown;
  }[],
  mutedFrom: string,
  tier: number,
): WindowRow['silenced'] {
  const i = incidents.find((x) => !x.alerted_at && Date.parse(x.detected_at) >= Date.parse(mutedFrom));
  if (!i) return null;
  const plan = escalationPlanSchema.safeParse(i.escalation_plan);
  const l1 = plan.success ? plan.data.steps.find((s) => s.level === 1) : undefined;
  const alwaysOn = TIER_CONFIG[tier as Tier]?.alwaysOn ?? false;
  return {
    number: i.number,
    l1DelayMin: l1 && alwaysOn ? l1.delayMin : null,
    // As the Chat line words it: the drop in progress, since it was detected (spec-check L1).
    severity: (i.episode_severity ?? i.severity) === 'problem' ? 'problem' : 'down',
    since: i.detected_at,
    pausedUntil: null,
    escalates: true,
  };
}

/**
 * A held Tier 2–3 incident outside response hours escalates from the next opening (§24.13): the hours
 * are read only when a mute holds such an incident.
 */
async function withPausedUntil(db: DbClient, rows: WindowRow[], now: Date): Promise<WindowRow[]> {
  const waiting = rows.some((r) => r.silenced && !(TIER_CONFIG[r.tier]?.alwaysOn ?? false));
  if (!waiting) return rows;
  const hours = await loadResponseHours(db, now);
  if (isInsideHours(now, hours)) return rows;
  const opening = nextOpening(now, hours).toISOString();
  return rows.map((r) =>
    r.silenced && !(TIER_CONFIG[r.tier]?.alwaysOn ?? false)
      ? { ...r, silenced: { ...r.silenced, pausedUntil: opening } }
      : r,
  );
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
    .in('incidents.state', ['unacked', 'escalated', 'acknowledged'])
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
