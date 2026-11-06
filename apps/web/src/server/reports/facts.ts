import 'server-only';
import type { DbClient } from '@dxt/db';
import {
  aggregateUptime,
  episodesFromTimeline,
  isInsideHours,
  mttaByTier,
  siteUptimeOver,
  type MetricIncident,
} from '@dxt/engine';
import type {
  DigestFacts,
  MonitorFacts,
  ProbeGap,
  ReportIncident,
  ReportPerson,
  ReportWindow,
  WeeklyFacts,
} from '@dxt/notifier';
import {
  bangkokDayStart,
  formatDay,
  formatDuration,
  formatTime,
  formatWeek,
  isSameBangkokDay,
} from '@dxt/shared';
import { downEpisodesBySite, maintenanceSpansBySite, watchedSince } from '@/features/sites/server';
import { loadResponseHours } from '../escalation/response-hours';
import { causeOf, reportIncident, roundsOf, type IncidentRow } from './assemble';

/**
 * What the daily digest and the weekly summary say (S14, FR-12, D-056), read as the service role at
 * 09:00. Every line comes from the database; nothing from the board's sample.
 */

const DAY_MS = 86_400_000;
const EPISODE_EVENTS = ['detected', 'relapsed', 'escalated_to_down', 'recovered'];

const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};

const person = (
  p: { display_name: string; google_chat_user_id: string | null } | null,
): ReportPerson | null => (p ? { name: p.display_name, chatUserId: p.google_chat_user_id } : null);

const INCIDENT_COLUMNS = `number, state, severity, trigger, started_at, resolved_at, detected_at, acked_at, is_manual,
  escalation_level, client_updated_at, client_update_not_needed, root_cause_category, root_cause, root_cause_fix,
  sites!inner(id, name, tier, is_active, owner:profiles!sites_primary_owner_id_fkey(display_name, google_chat_user_id)),
  acker:profiles!incidents_acked_by_fkey(display_name),
  updater:profiles!incidents_client_updated_by_fkey(display_name),
  incident_events(type, at, payload)`;

type LoadedIncident = IncidentRow & {
  detected_at: string | null;
  is_manual: boolean;
  siteId: string;
  siteActive: boolean;
};

/** Every incident with a drop that may touch [from, to): started before `to`, not resolved before `from`. */
async function loadIncidents(db: DbClient, from: Date, to: Date): Promise<LoadedIncident[]> {
  const data = must(
    await incidentQuery(db)
      .lt('started_at', to.toISOString())
      .or(`resolved_at.is.null,resolved_at.gte.${from.toISOString()}`)
      .order('started_at'),
    'incidents',
  );
  return (data ?? []).map(toLoaded);
}

type IncidentQueryRow = NonNullable<Awaited<ReturnType<typeof incidentQuery>>['data']>[number];

const incidentQuery = (db: DbClient) =>
  db.from('incidents').select(INCIDENT_COLUMNS).in('incident_events.type', EPISODE_EVENTS);

const toLoaded = (i: IncidentQueryRow): LoadedIncident => ({
  number: i.number,
  state: i.state,
  severity: i.severity,
  trigger: i.trigger,
  started_at: i.started_at,
  resolved_at: i.resolved_at,
  detected_at: i.detected_at,
  acked_at: i.acked_at,
  is_manual: i.is_manual,
  escalation_level: i.escalation_level,
  client_updated_at: i.client_updated_at,
  client_update_not_needed: i.client_update_not_needed,
  root_cause_category: i.root_cause_category,
  root_cause: i.root_cause,
  root_cause_fix: i.root_cause_fix,
  site: { name: i.sites.name, tier: i.sites.tier, owner: person(i.sites.owner) },
  siteId: i.sites.id,
  siteActive: i.sites.is_active,
  acker: i.acker,
  updater: i.updater,
  events: i.incident_events,
});

/** "Inside response hours" for an incident's start: Tier 1 is 24/7, Tier 2–3 per the organisation's hours. */
async function insideFor(db: DbClient, now: Date) {
  const hours = await loadResponseHours(db, now);
  return Object.assign((at: Date) => isInsideHours(at, hours), { hours });
}

interface WindowRow {
  site_id: string;
  kind: string;
  starts_at: string;
  ends_at: string;
  ended_at: string | null;
  cancelled_at: string | null;
  approved_at: string | null;
  outcome: string | null;
  reason: string;
  sites: { name: string };
  creator: { display_name: string } | null;
}

const toWindow = (w: WindowRow): ReportWindow => {
  const end =
    w.ended_at && new Date(w.ended_at) < new Date(w.ends_at) ? new Date(w.ended_at) : new Date(w.ends_at);
  return {
    kind: w.kind === 'mute' ? 'mute' : 'maintenance',
    site: w.sites.name,
    start: new Date(w.starts_at),
    end,
    endedEarly: end.getTime() < new Date(w.ends_at).getTime(),
    reason: w.reason,
    by: w.creator?.display_name ?? null,
  };
};

/** Windows and mutes that ran or will run (approved, not cancelled before they started, no outcome) in [from, to). */
async function loadWindows(db: DbClient, from: Date, to: Date): Promise<WindowRow[]> {
  const data = must(
    await db
      .from('maintenance_windows')
      .select(
        'site_id, kind, starts_at, ends_at, ended_at, cancelled_at, approved_at, outcome, reason, sites!inner(name), creator:profiles!maintenance_windows_created_by_fkey(display_name)',
      )
      .lt('starts_at', to.toISOString())
      .gt('ends_at', from.toISOString())
      .order('starts_at'),
    'maintenance_windows',
  );
  return ((data ?? []) as WindowRow[]).filter(
    (w) =>
      !w.outcome &&
      (!w.cancelled_at || new Date(w.cancelled_at) > new Date(w.starts_at)) &&
      (w.approved_at !== null || w.kind === 'mute') &&
      new Date(w.ended_at ?? w.ends_at) > from,
  );
}

/** The monitor itself over [from, to): the engine's share of rounds and silences, probe gaps, the Admins. */
async function loadMonitor(db: DbClient, from: Date, to: Date): Promise<MonitorFacts> {
  const [gaps, alerts, locations, admins] = await Promise.all([
    db.rpc('engine_sweep_gaps', { p_from: from.toISOString(), p_to: to.toISOString() }),
    db
      .from('system_alerts')
      .select('opened_at, cleared_at, context')
      .eq('kind', 'probe_location_missing')
      .lt('opened_at', to.toISOString())
      .or(`cleared_at.is.null,cleared_at.gte.${from.toISOString()}`)
      .order('opened_at'),
    db.from('probe_locations').select('code, is_active'),
    db
      .from('profiles')
      .select('display_name')
      .eq('role', 'admin')
      .eq('is_active', true)
      .order('display_name'),
  ]);
  const active = must(locations, 'probe_locations')
    .filter((l) => l.is_active)
    .map((l) => l.code);
  const probeGaps: ProbeGap[] = must(alerts, 'system_alerts').map((a) => {
    const ctx = (a.context ?? {}) as Record<string, unknown>;
    const location = typeof ctx.location === 'string' ? ctx.location : '?';
    const since = typeof ctx.lastBeatAt === 'string' ? ctx.lastBeatAt : a.opened_at;
    return {
      location,
      start: new Date(since),
      end: a.cleared_at ? new Date(a.cleared_at) : null,
      others: active.filter((c) => c !== location),
    };
  });
  return {
    ...roundsOf(must(gaps, 'engine_sweep_gaps') ?? [], from, to),
    probeGaps,
    admins: must(admins, 'profiles').map((p) => p.display_name),
  };
}

interface SiteRow {
  id: string;
  name: string;
  tier: number;
  muted_until: string | null;
  mute_reason: string | null;
  is_active: boolean;
  monitoring_started_at: string | null;
  created_at: string;
  site_status: { status: string; note: string | null } | null;
}

async function loadSites(db: DbClient): Promise<SiteRow[]> {
  const data = must(
    await db
      .from('sites')
      .select(
        'id, name, tier, is_active, muted_until, mute_reason, monitoring_started_at, created_at, site_status(status, note)',
      )
      .eq('is_active', true)
      .order('name'),
    'sites',
  );
  return (data ?? []) as SiteRow[];
}

/** The latest drop's start of an open incident (a relapse starts its own). */
const latestDropStart = (i: LoadedIncident) =>
  episodesFromTimeline(i, i.events).at(-1)?.start ?? new Date(i.started_at);

/** The daily digest at `now` (09:00): what is true now, then the previous Bangkok day. */
export async function loadDigestFacts(db: DbClient, now: Date, appUrl: string): Promise<DigestFacts> {
  const today = bangkokDayStart(now);
  const yesterday = new Date(today.getTime() - DAY_MS);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const [sites, incidents, windows, monitor, inside] = await Promise.all([
    loadSites(db),
    loadIncidents(db, yesterday, now),
    loadWindows(db, now, tomorrow),
    loadMonitor(db, yesterday, today),
    insideFor(db, now),
  ]);
  const open = new Map(
    incidents.filter((i) => !i.resolved_at && i.siteActive).map((i) => [i.siteId, i] as const),
  );
  const nowRow = (status: 'down' | 'problem') =>
    sites.flatMap((s) => {
      const i = open.get(s.id);
      if (s.site_status?.status !== status || !i) return [];
      // The drop in progress: its own start and cause (a relapse isn't worded as the first drop).
      return [
        {
          site: s.name,
          since: latestDropStart(i),
          cause: causeOf(i, status),
          number: i.number,
        },
      ];
    });
  const yesterdayList = incidents
    .filter((i) => i.siteActive)
    .flatMap((i) => {
      const r = reportIncident(i, yesterday, today, now, inside);
      return r ? [r] : [];
    });
  return {
    at: now,
    sitesTotal: sites.length,
    sitesOk: sites.filter((s) => (s.site_status?.status ?? 'ok') === 'ok').length,
    down: nowRow('down'),
    problem: nowRow('problem'),
    browserChecked: sites
      .filter((s) => s.site_status?.status === 'ok' && /verified via browser/i.test(s.site_status.note ?? ''))
      .map((s) => s.name),
    muted: sites
      .filter((s) => s.muted_until && new Date(s.muted_until) > now)
      .map((s) => ({ site: s.name, until: new Date(s.muted_until!), reason: s.mute_reason ?? 'muted' })),
    maintenance: windows.filter((w) => w.kind === 'maintenance').map(toWindow),
    yesterday: yesterdayList,
    monitor,
    appUrl,
  };
}

/** The weekly summary on Monday `now`: the week Mon 00:00 – Sun 24:00 Bangkok before it. */
export async function loadWeeklyFacts(db: DbClient, now: Date, appUrl: string): Promise<WeeklyFacts> {
  const weekEndExclusive = bangkokDayStart(now);
  const weekStart = new Date(weekEndExclusive.getTime() - 7 * DAY_MS);
  const weekEnd = new Date(weekEndExclusive.getTime() - 60_000);
  const [
    sites,
    incidents,
    planned,
    coming,
    monitor,
    inside,
    drops,
    spans,
    policies,
    requests,
    swaps,
    shifts,
    admins,
  ] = await Promise.all([
    loadSites(db),
    loadIncidents(db, weekStart, weekEndExclusive),
    loadWindows(db, weekStart, weekEndExclusive),
    loadWindows(db, now, new Date(now.getTime() + 7 * DAY_MS)),
    loadMonitor(db, weekStart, weekEndExclusive),
    insideFor(db, now),
    downEpisodesBySite(db, null, weekStart),
    maintenanceSpansBySite(db, null, weekStart),
    db
      .from('escalation_policies')
      .select('tier, severity, escalation_steps(level, delay_min)')
      .eq('severity', 'down'),
    db
      .from('maintenance_windows')
      .select('starts_at, ends_at, sites!inner(name)')
      .eq('kind', 'maintenance')
      .is('approved_at', null)
      .is('cancelled_at', null)
      .is('outcome', null)
      .gt('ends_at', now.toISOString()),
    db
      .from('oncall_swaps')
      .select(
        `status, requester:profiles!oncall_swaps_requester_id_fkey(display_name),
           counterpart:profiles!oncall_swaps_counterpart_id_fkey(display_name, google_chat_user_id),
           rq:oncall_shifts!oncall_swaps_requester_shift_id_fkey(starts_at, ends_at)`,
      )
      .in('status', ['waiting', 'accepted']),
    db
      .from('oncall_shifts')
      .select('starts_at, ends_at, person:profiles!oncall_shifts_user_id_fkey(display_name)')
      .gt('ends_at', now.toISOString())
      .order('starts_at')
      .limit(2),
    db.from('profiles').select('display_name, google_chat_user_id').eq('role', 'admin').eq('is_active', true),
  ]);
  const adminPeople = must(admins, 'profiles').map((p) => person(p)!);

  const live = incidents.filter((i) => i.siteActive);
  const list: ReportIncident[] = live.flatMap((i) => {
    const r = reportIncident(i, weekStart, weekEndExclusive, now, inside);
    return r ? [r] : [];
  });

  // Uptime of the week (all sites, maintenance excluded), and which sites had any DOWN minute in it.
  const windowsUp = sites.flatMap((s) => {
    const u = siteUptimeOver(drops.get(s.id) ?? [], {
      now: weekEndExclusive,
      rangeMinutes: 7 * 1440,
      monitoringStartedAt: watchedSince(s),
      maintenance: spans.get(s.id) ?? [],
    });
    return u ? [{ siteId: s.id, ...u }] : [];
  });
  const withDowntime = new Set(windowsUp.filter((u) => u.downMinutes > 0).map((u) => u.siteId));

  const targets = new Map(
    must(policies, 'escalation_policies').flatMap((p) => {
      const l1 = p.escalation_steps.find((s) => s.level === 1);
      return p.tier !== null && l1 ? [[p.tier, l1.delay_min] as const] : [];
    }),
  );
  const tiers = [...new Set(sites.map((s) => s.tier))].sort();
  const metric: MetricIncident[] = live.map((i) => ({
    severity: i.severity,
    tier: i.site.tier,
    startedAt: new Date(i.started_at),
    downStartedAt: episodesFromTimeline(i, i.events).find((e) => e.severity === 'down')?.start ?? null,
    detectedAt: i.detected_at ? new Date(i.detected_at) : null,
    ackedAt: i.acked_at ? new Date(i.acked_at) : null,
    isManual: i.is_manual,
  }));
  const mtta = mttaByTier(metric, weekStart, weekEndExclusive, tiers, inside.hours).map((m) => ({
    ...m,
    // No L1 step on that tier's DOWN policy: no target to compare with (code review S14).
    targetMin: targets.get(m.tier) ?? null,
  }));

  // Needs someone: DOWN without a root cause (any week), maintenance requests, unanswered swaps.
  const rootCause = (await loadOpenDowns(db)).flatMap((i) => {
    const r = reportIncident(i, new Date(0), now, now, inside);
    if (!r) return [];
    return [
      {
        kind: 'root_cause' as const,
        text: `${i.site.name} DOWN ${formatDay(r.startedAt, { weekday: true })} (${formatDuration(r.minutes)}) — no root cause yet`,
        who: i.site.owner ? [i.site.owner] : [],
      },
    ];
  });
  const requestRows = must(requests, 'maintenance_windows').map((w) => {
    const s = new Date(w.starts_at);
    const e = new Date(w.ends_at);
    const span = isSameBangkokDay(s, e)
      ? `${formatDay(s, { weekday: true })} ${formatTime(s)}–${formatTime(e)}`
      : `${formatDay(s, { weekday: true })} ${formatTime(s)} → ${formatDay(e, { weekday: true })} ${formatTime(e)}`;
    return {
      kind: 'request' as const,
      text: `Maintenance request · ${w.sites.name} · ${span} — waiting for an Admin`,
      who: adminPeople,
    };
  });
  const swapRows = must(swaps, 'oncall_swaps').map((s) => {
    const week = formatWeek({ start: new Date(s.rq.starts_at), end: new Date(s.rq.ends_at) });
    return s.status === 'waiting'
      ? {
          kind: 'swap' as const,
          text: `On-call swap ${week} — ${s.requester.display_name} asked, not accepted yet`,
          who: [person(s.counterpart)!],
        }
      : {
          kind: 'swap' as const,
          text: `On-call swap ${week} — ${s.counterpart.display_name} accepted, waiting for an Admin`,
          who: adminPeople,
        };
  });

  const [thisShift, nextShift] = must(shifts, 'oncall_shifts');
  const shiftOf = (s: typeof thisShift) =>
    s?.person
      ? { name: s.person.display_name, week: { start: new Date(s.starts_at), end: new Date(s.ends_at) } }
      : null;
  // The next week's open swap, as the board words it: "swap with Nok asked, not accepted yet".
  const nextSwap = nextShift
    ? must(swaps, 'oncall_swaps').find(
        (s) => new Date(s.rq.starts_at).getTime() === new Date(nextShift.starts_at).getTime(),
      )
    : undefined;
  const nextSwapWords = nextSwap
    ? nextSwap.status === 'waiting'
      ? `swap with ${nextSwap.counterpart.display_name} asked, not accepted yet`
      : `swap with ${nextSwap.counterpart.display_name} accepted, waiting for an Admin`
    : null;

  return {
    at: now,
    weekStart,
    weekEnd,
    sitesTotal: sites.length,
    sitesWithoutDowntime: sites.filter((s) => !withDowntime.has(s.id)).length,
    uptime: aggregateUptime(windowsUp),
    incidents: list,
    needsSomeone: [...rootCause, ...requestRows, ...swapRows],
    mtta,
    planned: planned.map(toWindow),
    comingUp: coming.filter((w) => w.kind === 'maintenance' && new Date(w.starts_at) > now).map(toWindow),
    onCall: {
      thisWeek: shiftOf(thisShift),
      next: shiftOf(nextShift)
        ? {
            ...shiftOf(nextShift)!,
            swap: nextSwapWords,
          }
        : null,
    },
    monitor,
    appUrl,
  };
}

/**
 * Open DOWN incidents that recovered and have no root cause yet: Needs root cause, or Monitoring with no
 * category (one with a root cause stays in Monitoring after it settles — engine review S14, M2).
 */
async function loadOpenDowns(db: DbClient): Promise<LoadedIncident[]> {
  const data = must(
    await incidentQuery(db)
      .eq('severity', 'down')
      .in('state', ['monitoring', 'needs_root_cause'])
      .order('started_at'),
    'incidents',
  );
  return (data ?? [])
    .map(toLoaded)
    .filter((i) => i.siteActive && (!i.root_cause_category || i.root_cause_category === 'unknown'));
}

/** The CEO (D-032, D-056): every active stakeholder who manages no client — the weekly email's recipients. */
export async function loadCeoIds(db: DbClient): Promise<string[]> {
  const [people, clients] = await Promise.all([
    db.from('profiles').select('id').eq('role', 'stakeholder').eq('is_active', true),
    db.from('clients').select('am_user_id').not('am_user_id', 'is', null),
  ]);
  const ams = new Set(must(clients, 'clients').map((c) => c.am_user_id));
  return must(people, 'profiles')
    .map((p) => p.id)
    .filter((id) => !ams.has(id));
}
