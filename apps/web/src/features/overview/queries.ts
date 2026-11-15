import 'server-only';
import { aggregateUptime, isInsideHours, kpiChange, responseKpis, siteUptimeOver } from '@dxt/engine';
import { shortCause } from '@dxt/notifier';
import {
  CLOSED_INCIDENT_STATES_IN,
  defaultSlowMs,
  TRIGGER_LABELS,
  type Role,
  type SiteStatus,
  type Tier,
} from '@dxt/shared';
import type { DbClient as ServiceDbClient } from '@dxt/db';
import { createClient } from '@/lib/supabase/server';
import { getAccess } from '@/lib/auth/session';
import { loadResponseHours } from '@/server/escalation/response-hours';
import { loadWindowRows, overviewOf, phoneLine, windowEvents } from '@/features/maintenance/server';
import {
  downEpisodesBySite,
  locationGlyph,
  maintenanceSpansBySite,
  slowMsOf,
  watchedSince,
} from '@/features/sites/server';
import {
  chainSinceOf,
  byHandOf,
  currentDrop,
  isEngineFault,
  lastRoundP50,
  monitorFaultOf,
  probeHealth,
  seriesOf,
  viewerKindOf,
} from './assemble';
import { EVENT_TYPES, reasonOf } from './model';
import { loadOnCallNow } from '@/features/incidents/server';
import { loadOncallCard } from '@/features/oncall/server';
import {
  OVERVIEW_LOCATIONS,
  type HandCheckEntry,
  type OverviewData,
  type OverviewEvent,
  type OverviewIncident,
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
  const [sites, checks, series, drops, spans, windowRows, kpiRows, events, probes, beats, openJobs, managed] =
    await Promise.all([
      db
        .from('sites')
        .select(
          `id, name, tier, is_active, muted_until, mute_reason, monitoring_started_at, created_at,
         primary_owner_id, backup_owner_id,
         clients!inner(am_user_id, is_internal),
         owner:profiles!sites_primary_owner_id_fkey(display_name),
         backup:profiles!sites_backup_owner_id_fkey(display_name),
         site_status(status, since, last_round_at),
         monitors(id, is_primary, thresholds, url),
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
      // the verifier's poll, and the engine cron's sweep (S12a: the fault banner, D-053)
      db.from('agent_heartbeats').select('name, last_seen_at').in('name', ['verifier', 'engine-sweep']),
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
    beats,
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
    const byHand = inc ? byHandOf(inc.incident_events) : null;
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
          // a PROBLEM drop's short summary ("slow, p50 5.8 s"); a DOWN's cause in short form (spec §10);
          // opened by hand: what the person saw (S12b, spec §30.2); reported down by hand (§31.4)
          cause:
            inc.trigger === 'manual'
              ? manualNote(inc.incident_events)
              : byHand && byHand.kind !== 'opened'
                ? byHandNote(byHand)
                : drop?.severity === 'problem'
                  ? (summary ?? TRIGGER_LABELS[inc.trigger])
                  : cause
                    ? shortCause(cause)
                    : null,
          byHand,
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
      url: primary?.url ?? null,
      tier,
      status: siteStatus,
      statusSince: status?.since ?? null,
      checkedAt: status?.last_round_at ?? null,
      ownerId: s.primary_owner_id,
      ownerName: s.owner?.display_name ?? null,
      backupId: s.backup_owner_id,
      backupName: s.backup?.display_name ?? null,
      amId: s.clients.am_user_id,
      clientSite: !s.clients.is_internal,
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

  await fillChainSince(db, rows, live);
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
    // A PROBLEM raised to DOWN by hand (D-055 item 7) has no detection to measure either (D-032).
    isManual: i.is_manual || raisedByHand(i.incident_events),
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
  const beatAt = (name: string) => beats.data?.find((b) => b.name === name)?.last_seen_at ?? null;
  // Who the watchdog @mentioned, named in the fault banner; read only while there is a fault.
  const onCallName =
    onCall && isEngineFault(beatAt('engine-sweep'), now) ? await personName(db, onCall) : null;
  const rounds = rows
    .map((r) => r.checkedAt)
    .filter((t): t is string => !!t)
    .sort();
  const faultOnly = monitorFaultOf(beatAt('engine-sweep'), rounds.at(-1) ?? null, now, onCallName);
  // Who a DOWN reported by hand pages (§31.3): the hours, read only while there is a fault.
  // Only those who may press read them: the hours tables are staff-only (RLS), and so is the confirm.
  const presses = person.role === 'admin' || person.role === 'responder';
  const fault = faultOnly
    ? {
        ...faultOnly,
        ...(presses ? { outsideHours: !isInsideHours(now, await loadResponseHours(db, now)) } : {}),
      }
    : null;
  // The person L0 paged on each open Tier 1 incident, named in the Down again confirm (§31.2).
  if (fault && presses) await fillL0Names(db, rows);
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
    probes: probeHealth(probes.data ?? [], beatAt('verifier'), openJobs.count ?? 0, now),
    lastRoundAt: rounds.at(-1) ?? null,
    fault,
    handChecks: fault ? await loadHandChecks(db, rows, fault.sweepAt) : [],
  };
}

/** "Manual (hand check) · “Home page shows a 502 error”" — Live issues' note for an incident opened by hand. */
function manualNote(events: readonly { type: string; payload: unknown }[]): string {
  const detected = events.find((e) => e.type === 'detected')?.payload as { note?: unknown } | undefined;
  return typeof detected?.note === 'string' && detected.note
    ? `${TRIGGER_LABELS.manual} · “${detected.note}”`
    : TRIGGER_LABELS.manual;
}

/**
 * Live issues' note for a drop reported by hand on an open incident (spec §31.4): "Down again — reported
 * by hand · “502 again”" / "Raised to DOWN by hand · “…”".
 */
function byHandNote(b: { kind: 'opened' | 'relapse' | 'raise'; note: string | null }): string {
  const what = b.kind === 'raise' ? 'Raised to DOWN by hand' : 'Down again — reported by hand';
  return b.note ? `${what} · “${b.note}”` : what;
}

/** The Tier 1 hand checks since the sweep stopped (S12b, spec §30.2), newest first. */
async function loadHandChecks(
  db: DbClient,
  sites: readonly OverviewSite[],
  since: string,
): Promise<HandCheckEntry[]> {
  const ids = sites.filter((s) => s.tier === 1).map((s) => s.id);
  if (!ids.length) return [];
  const { data, error } = await db
    .from('hand_checks')
    .select(
      'site_id, outcome, checked_at, incident_id, checker:profiles!hand_checks_checked_by_fkey(display_name), incident:incidents(number, created_at)',
    )
    .in('site_id', ids)
    .gte('checked_at', since)
    .order('checked_at', { ascending: false });
  if (error) throw new Error(`hand_checks: ${error.message}`);
  return (data ?? []).map((h) => ({
    siteId: h.site_id,
    outcome: h.outcome === 'down' ? 'down' : 'ok',
    at: h.checked_at,
    by: h.checker?.display_name ?? 'Someone',
    incidentId: h.incident_id,
    incidentNumber: h.incident?.number ?? null,
    // Down again (D-055 item 7): the incident was there before the press. A manual open writes both
    // in one transaction, so its incident is never older than the check.
    reported: !!h.incident && Date.parse(h.incident.created_at) < Date.parse(h.checked_at),
  }));
}

/** A profile's display name (staff read profiles), or null. */
/** Names the L0 person of each open Tier 1 incident that has one (one read for all of them). */
async function fillL0Names(db: DbClient, sites: OverviewSite[]): Promise<void> {
  const ids = [
    ...new Set(sites.flatMap((s) => (s.tier === 1 && s.incident?.l0UserId ? [s.incident.l0UserId] : []))),
  ];
  if (!ids.length) return;
  const { data, error } = await db.from('profiles').select('id, display_name').in('id', ids);
  if (error) throw new Error(`profiles: ${error.message}`);
  const names = new Map((data ?? []).map((p) => [p.id, p.display_name]));
  for (const s of sites) if (s.incident?.l0UserId) s.incident.l0Name = names.get(s.incident.l0UserId) ?? null;
}

async function personName(db: DbClient, userId: string): Promise<string | null> {
  const { data, error } = await db
    .from('profiles')
    .select('display_name, google_chat_user_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`profiles: ${error.message}`);
  // The watchdog can only @mention someone with a Chat id; without one the banner names nobody (/verify 4 Nov).
  return data?.google_chat_user_id ? data.display_name : null;
}

/**
 * When each TLS chain warning started (§21.4 Since for a location warning): the start the engine
 * carries per location (`monitor_status.chain_since`, D-029), one row per warned site's primary — no
 * walk back through check_results, whose cost grew with the streak (cold-load follow-up, 15 Nov 2026).
 * Only sites with a warning are read, so this is usually nothing. A database a deploy behind (no column
 * yet, 42703 / PGRST204) shows no Since rather than failing the page.
 */
async function fillChainSince(
  db: DbClient,
  rows: OverviewSite[],
  live: readonly { id: string; monitors: { id: string; is_primary: boolean }[] }[],
): Promise<void> {
  const monitorOf = new Map(live.map((s) => [s.id, s.monitors.find((m) => m.is_primary)?.id]));
  const warned = rows.flatMap((r) => {
    const monitor = monitorOf.get(r.id);
    const locations = OVERVIEW_LOCATIONS.filter((l) => r.locations[l] === 'chain');
    return monitor && locations.length ? [{ row: r, monitor, locations }] : [];
  });
  if (!warned.length) return;
  const { data, error } = await db
    .from('monitor_status')
    .select('monitor_id, chain_since')
    .in(
      'monitor_id',
      warned.map((w) => w.monitor),
    );
  if (error) {
    if (error.code === '42703' || error.code === 'PGRST204') return;
    throw new Error(`monitor_status: ${error.message}`);
  }
  const byMonitor = new Map((data ?? []).map((m) => [m.monitor_id, m.chain_since]));
  for (const w of warned) w.row.chainSince = chainSinceOf(byMonitor.get(w.monitor), w.locations);
}

/** When a PROBLEM raised to DOWN became an outage (the `escalated_to_down` event's `downStartedAt`, D-021). */
function downStartOf(events: readonly { type: string; payload: unknown }[]): Date | null {
  const p = events.find((e) => e.type === 'escalated_to_down')?.payload as
    Record<string, unknown> | undefined;
  return typeof p?.downStartedAt === 'string' ? new Date(p.downStartedAt) : null;
}

/** Raised to DOWN by hand from the hand check (D-055 item 7). */
function raisedByHand(events: readonly { type: string; payload: unknown }[]): boolean {
  return events.some(
    (e) => e.type === 'escalated_to_down' && (e.payload as Record<string, unknown> | null)?.manual === true,
  );
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
