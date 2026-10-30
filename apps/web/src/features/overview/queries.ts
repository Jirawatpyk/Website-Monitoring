import 'server-only';
import { aggregateUptime, kpiChange, responseKpis, siteUptimeOver } from '@dxt/engine';
import { shortCause } from '@dxt/notifier';
import {
  CLOSED_INCIDENT_STATES_IN,
  defaultSlowMs,
  TLS_CHAIN_ERRORS,
  TRIGGER_LABELS,
  type Role,
  type SiteStatus,
  type Tier,
} from '@dxt/shared';
import type { DbClient as ServiceDbClient } from '@dxt/db';
import { createClient } from '@/lib/supabase/server';
import { getAccess } from '@/lib/auth/session';
import { loadWindowRows, overviewOf, phoneLine, windowEvents } from '@/features/maintenance/server';
import {
  downEpisodesBySite,
  locationGlyph,
  maintenanceSpansBySite,
  slowMsOf,
  watchedSince,
} from '@/features/sites/server';
import { chainStreakStart, currentDrop, lastRoundP50, probeHealth, seriesOf, viewerKindOf } from './assemble';
import { EVENT_TYPES, reasonOf } from './model';
import { loadOnCallNow } from '@/features/incidents/server';
import { loadOncallCard } from '@/features/oncall/server';
import {
  OVERVIEW_LOCATIONS,
  type OverviewData,
  type OverviewEvent,
  type OverviewIncident,
  type OverviewLocation,
  type OverviewSite,
} from './types';

type Client = Awaited<ReturnType<typeof createClient>>;
type DbClient = Client | ServiceDbClient;

const DAY_MS = 86_400_000;
const THIRTY_DAYS_MIN = 30 * 1440;
/** Recent events read before wording (some types aren't worded); the page shows 7. */
const EVENT_ROWS = 20;

/**
 * Everything `/` shows (spec §21, D-032), read as the signed-in person (RLS: staff read all). Takes
 * a client so the integration test and the timing run can call it — never pass the service-role
 * client: RLS is the access rule here (security review S06b). Independent reads run side by
 * side; only the TLS chain streaks wait for the location glyphs.
 */
export async function loadOverview(
  db: DbClient,
  person: { id: string; name: string; role: Role },
  now: Date = new Date(),
): Promise<OverviewData> {
  const from30d = new Date(now.getTime() - THIRTY_DAYS_MIN * 60_000);
  const from60d = new Date(now.getTime() - 60 * DAY_MS);
  // Who is on call now, beside the other reads (S10): they act on every Tier 1 incident.
  const onCallRead = loadOnCallNow(db, now);
  // The "On call" card (§23.8): who responds now, tonight and next week.
  const oncallCardRead = loadOncallCard(db, now);
  const [
    sites,
    checks,
    series,
    drops,
    spans,
    windowRows,
    kpiRows,
    events,
    probes,
    verifier,
    openJobs,
    managed,
  ] = await Promise.all([
    db
      .from('sites')
      .select(
        `id, name, tier, is_active, muted_until, mute_reason, monitoring_started_at, created_at,
         primary_owner_id, backup_owner_id,
         clients!inner(am_user_id),
         owner:profiles!sites_primary_owner_id_fkey(display_name),
         site_status(status, since, last_round_at),
         monitors(id, is_primary, thresholds),
         incidents(id, number, state, severity, trigger, escalation_level, started_at, detected_at, recovered_at, l0_user_id,
                   acker:profiles!incidents_acked_by_fkey(display_name),
                   incident_events(type, at, payload))`,
      )
      .eq('monitors.is_primary', true)
      .not('incidents.state', 'in', CLOSED_INCIDENT_STATES_IN)
      .in('incidents.incident_events.type', ['detected', 'escalated_to_down', 'relapsed'])
      .order('name'),
    db.rpc('site_list_locations'),
    db.rpc('overview_response_24h'),
    downEpisodesBySite(db, null, from30d),
    maintenanceSpansBySite(db, null, from30d),
    loadWindowRows(db, now),
    db
      .from('incidents')
      .select(
        'severity, started_at, detected_at, acked_at, is_manual, sites!inner(tier), incident_events(type, payload)',
      )
      .eq('severity', 'down')
      .eq('incident_events.type', 'escalated_to_down')
      // a PROBLEM raised to DOWN may have started before the window its outage falls in
      .gte('started_at', new Date(now.getTime() - 90 * DAY_MS).toISOString()),
    db
      .from('incident_events')
      .select(
        `id, type, at, payload, actor:profiles(display_name),
         incidents!inner(number, severity, trigger, auto_resolved, sites!inner(name))`,
      )
      .in('type', [...EVENT_TYPES])
      .order('at', { ascending: false })
      .limit(EVENT_ROWS),
    db.from('probe_locations').select('code, is_active, last_heartbeat_at'),
    db.from('agent_heartbeats').select('last_seen_at').eq('name', 'verifier').maybeSingle(),
    db
      .from('verification_jobs')
      .select('id', { count: 'exact', head: true })
      .in('status', ['queued', 'leased']),
    person.role === 'stakeholder'
      ? db.from('clients').select('id', { count: 'exact', head: true }).eq('am_user_id', person.id)
      : Promise.resolve({ count: 0, error: null }),
  ]);
  for (const [name, r] of Object.entries({
    sites,
    checks,
    series,
    kpiRows,
    events,
    probes,
    verifier,
    openJobs,
    managed,
  })) {
    if (r.error) throw new Error(`${name}: ${r.error.message}`);
  }

  const latest = new Map<string, NonNullable<typeof checks.data>[number]>();
  for (const c of checks.data ?? []) latest.set(`${c.site_id}|${c.location}`, c);
  const seriesBySite = new Map((series.data ?? []).map((r) => [r.site_id, r]));

  const live = (sites.data ?? []).filter((s) => s.is_active);
  const rows: OverviewSite[] = live.map((s) => {
    const status = (Array.isArray(s.site_status) ? s.site_status[0] : s.site_status) ?? null;
    const tier = s.tier as Tier;
    const primary = s.monitors.find((m) => m.is_primary);
    const slowMs = slowMsOf(primary?.thresholds) ?? defaultSlowMs(tier);
    const glyphs = Object.fromEntries(
      OVERVIEW_LOCATIONS.map((l) => {
        const c = latest.get(`${s.id}|${l}`);
        return [
          l,
          locationGlyph(c && { outcome: c.outcome, error: c.error, responseMs: c.response_ms }, slowMs),
        ];
      }),
    ) as OverviewSite['locations'];
    const siteStatus = (status?.status as SiteStatus | undefined) ?? null;
    const inc = s.incidents[0];
    // the drop it is in now: a relapse or an escalation has its own start and cause (D-004, D-021)
    const drop = inc
      ? currentDrop(inc.incident_events, { startedAt: inc.started_at, severity: inc.severity })
      : null;
    const cause = drop?.cause ?? null;
    const summary = drop?.summary ?? null;
    const incident: OverviewIncident | null = inc
      ? {
          id: inc.id,
          number: inc.number,
          state: inc.state as OverviewIncident['state'],
          severity: inc.severity,
          dropSeverity: drop?.severity ?? inc.severity,
          trigger: inc.trigger,
          level: inc.escalation_level,
          startedAt: drop?.startedAt ?? inc.started_at,
          detectedAt: inc.detected_at,
          recoveredAt: inc.recovered_at,
          ackedBy: inc.acker?.display_name ?? null,
          l0UserId: inc.l0_user_id ?? null,
          // a PROBLEM drop's short summary ("slow, p50 5.8 s"); a DOWN's cause in short form (spec §10)
          cause:
            drop?.severity === 'problem'
              ? (summary ?? TRIGGER_LABELS[inc.trigger])
              : cause
                ? shortCause(cause)
                : null,
        }
      : null;
    const lastRound = OVERVIEW_LOCATIONS.map((l) => {
      const c = latest.get(`${s.id}|${l}`);
      return c?.outcome === 'pass' ? c.response_ms : null;
    });
    const { series: points, failed } = seriesOf(seriesBySite.get(s.id), now);
    const window = siteUptimeOver(drops.get(s.id) ?? [], {
      now,
      rangeMinutes: THIRTY_DAYS_MIN,
      monitoringStartedAt: watchedSince(s),
      maintenance: spans.get(s.id) ?? [],
    });
    return {
      id: s.id,
      name: s.name,
      tier,
      status: siteStatus,
      statusSince: status?.since ?? null,
      checkedAt: status?.last_round_at ?? null,
      ownerId: s.primary_owner_id,
      ownerName: s.owner?.display_name ?? null,
      backupId: s.backup_owner_id,
      amId: s.clients.am_user_id,
      mutedUntil: s.muted_until,
      muteReason: s.mute_reason,
      incident,
      locations: glyphs,
      chainSince: null,
      // "—" while down or in maintenance (§21.5)
      p50Ms: siteStatus === 'down' || siteStatus === 'maintenance' ? null : lastRoundP50(lastRound),
      series: points,
      failed,
      uptime: window,
    };
  });

  await fillChainSince(db, rows, live, now);
  // Only Live issues draw the Response 24h line (§21.5; tiles show the p50): the other sites' 96 points
  // stay on the server (spec-check S06b, 200 monitors)
  for (const r of rows) {
    if (!reasonOf(r, now)) {
      r.series = [];
      r.failed = [];
    }
  }

  const kpiIncidents = (kpiRows.data ?? []).map((i) => ({
    severity: i.severity,
    tier: i.sites.tier,
    startedAt: new Date(i.started_at),
    downStartedAt: downStartOf(i.incident_events),
    detectedAt: i.detected_at ? new Date(i.detected_at) : null,
    ackedAt: i.acked_at ? new Date(i.acked_at) : null,
    isManual: i.is_manual,
  }));
  const current = responseKpis(kpiIncidents, from30d, now);
  const previous = responseKpis(kpiIncidents, from60d, from30d);

  const eventRows: OverviewEvent[] = (events.data ?? []).map((e) => ({
    id: e.id,
    type: e.type,
    at: e.at,
    actorName: e.actor?.display_name ?? null,
    payload: (e.payload ?? {}) as Record<string, unknown>,
    incidentNumber: e.incidents.number,
    severity: e.incidents.severity,
    trigger: e.incidents.trigger,
    siteName: e.incidents.sites.name,
    autoResolved: e.incidents.auto_resolved,
  }));

  const [onCall, oncall] = await Promise.all([onCallRead, oncallCardRead]);
  const rounds = rows
    .map((r) => r.checkedAt)
    .filter((t): t is string => !!t)
    .sort();
  return {
    nowIso: now.toISOString(),
    viewer: {
      id: person.id,
      name: person.name,
      kind: viewerKindOf(person.role, (managed.count ?? 0) > 0),
      onCallNow: onCall === person.id,
    },
    sites: rows,
    // a Draft has never been started; a stopped site is neither monitored nor a draft
    drafts: (sites.data ?? []).filter((s) => !s.is_active && !s.monitoring_started_at).length,
    events: eventRows,
    ...maintenanceOf(windowRows, person.role === 'admin', now),
    oncall,
    kpis: {
      enough: current.enough,
      mttaSeconds: current.mttaSeconds,
      mttdSeconds: current.mttdSeconds,
      mttaChange:
        current.enough && previous.enough ? kpiChange(current.mttaSeconds, previous.mttaSeconds) : null,
      mttdChange:
        current.enough && previous.enough ? kpiChange(current.mttdSeconds, previous.mttdSeconds) : null,
      uptime30d: aggregateUptime(
        rows.flatMap((r) =>
          r.uptime
            ? [
                {
                  windowMinutes: r.uptime.windowMinutes,
                  downMinutes: r.uptime.downMinutes,
                  maintenanceMinutes: r.uptime.maintenanceMinutes,
                },
              ]
            : [],
        ),
      ),
    },
    probes: probeHealth(probes.data ?? [], verifier.data?.last_seen_at ?? null, openJobs.count ?? 0, now),
    lastRoundAt: rounds.at(-1) ?? null,
  };
}

/** The chain error codes as a PostgREST `in` list, from the one list in `@dxt/shared` (D-029). */ const CHAIN_ERRORS = `(${TLS_CHAIN_ERRORS.join(',')})`;

/**
 * When each TLS chain warning started (§21.4 Since for a location warning): per warned location of
 * the primary monitor, the last check that wasn't a chain error (within the 90 days kept), then the
 * first check after it. Two index reads per warned location (check_results_monitor_location_idx);
 * only sites with a warning are read, so this is usually nothing. Spec-check S06b: a shared 24 h,
 * 1,000-row read cut long streaks short.
 */
async function fillChainSince(
  db: DbClient,
  rows: OverviewSite[],
  live: readonly { id: string; monitors: { id: string; is_primary: boolean }[] }[],
  now: Date,
): Promise<void> {
  const monitorOf = new Map(live.map((s) => [s.id, s.monitors.find((m) => m.is_primary)?.id]));
  const from = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  const streakStart = async (monitorId: string, location: OverviewLocation): Promise<string | null> => {
    const lastGood = await db
      .from('check_results')
      .select('checked_at')
      .eq('monitor_id', monitorId)
      .eq('location', location)
      .gte('checked_at', from)
      .or(`outcome.neq.fail,error.is.null,error.not.in.${CHAIN_ERRORS}`)
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastGood.error) throw new Error(`check_results: ${lastGood.error.message}`);
    const first = await db
      .from('check_results')
      .select('checked_at, outcome, error')
      .eq('monitor_id', monitorId)
      .eq('location', location)
      .gt('checked_at', lastGood.data?.checked_at ?? from)
      .order('checked_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (first.error) throw new Error(`check_results: ${first.error.message}`);
    return first.data ? chainStreakStart([first.data]) : null;
  };
  await Promise.all(
    rows.map(async (r) => {
      const monitor = monitorOf.get(r.id);
      const warned = OVERVIEW_LOCATIONS.filter((l) => r.locations[l] === 'chain');
      if (!monitor || !warned.length) return;
      const starts = await Promise.all(warned.map((l) => streakStart(monitor, l)));
      r.chainSince = starts.filter((t): t is string => !!t).sort()[0] ?? null;
    }),
  );
}

/** When a PROBLEM raised to DOWN became an outage (the `escalated_to_down` event's `downStartedAt`, D-021). */
function downStartOf(events: readonly { type: string; payload: unknown }[]): Date | null {
  const p = events.find((e) => e.type === 'escalated_to_down')?.payload as
    Record<string, unknown> | undefined;
  return typeof p?.downStartedAt === 'string' ? new Date(p.downStartedAt) : null;
}

/** `/` for the signed-in person. */
export async function getOverview(now = new Date()): Promise<OverviewData> {
  const access = await getAccess();
  if (access.status !== 'active') throw new Error('Overview needs an active profile');
  const supabase = await createClient();
  return loadOverview(
    supabase,
    { id: access.profile.id, name: access.profile.displayName, role: access.profile.role },
    now,
  );
}

/** The Overview card, its phone row and the Recent events lines (§23.8, D-036). */
function maintenanceOf(rows: Awaited<ReturnType<typeof loadWindowRows>>, isAdmin: boolean, now: Date) {
  const card = overviewOf(rows, isAdmin, now);
  return {
    maintenance: card ? { ...card, phoneLine: phoneLine(card) } : null,
    windowEvents: windowEvents(rows, now),
  };
}
