import 'server-only';
import { episodeMinutes, episodesFromTimeline, siteUptimeOver } from '@dxt/engine';
import {
  CLOSED_INCIDENT_STATES,
  defaultSlowMs,
  type IncidentState,
  type Severity,
  type SiteStatus,
  type Tier,
  type Trigger,
} from '@dxt/shared';
import type { DbClient as ServiceDbClient } from '@dxt/db';
import { createClient } from '@/lib/supabase/server';
import { locationGlyph } from './components/site-list';
import {
  chartLines,
  incidentsCaption,
  mttrMinutes,
  rangeStats,
  SITE_RANGES,
  type SeriesRow,
  type SiteRange,
} from './detail';
import { siteIdSchema } from './schemas';
import {
  LIST_LOCATIONS,
  type CheckLogRow,
  type DetailIncident,
  type DetailMonitor,
  type OpenIncident,
  type RoundCheck,
  type SiteDetail,
} from './types';

type Client = Awaited<ReturnType<typeof createClient>>;
type DbClient = Client | ServiceDbClient;

const HISTORY_DAYS = 90;
const LOG_ROWS = 8;
const DAY_MS = 86_400_000;

/** The start of today in Bangkok (the Check log's "checks today"). */
function bangkokMidnight(now: Date): Date {
  const shifted = new Date(now.getTime() + 7 * 3_600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 7 * 3_600_000);
}

function slowMsOf(thresholds: unknown): number | null {
  const v = (thresholds as { slowMs?: unknown } | null)?.slowMs;
  return typeof v === 'number' && v > 0 ? v : null;
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return url;
  }
}

/** The Assertions column, in words from the monitor's own fields (D-025: keyword / redirect live on it). */
function assertionsOf(
  m: {
    timeout_ms: number;
    must_contain: string[];
    must_not_contain: string[];
    allowed_redirect_domains: string[];
    thresholds: unknown;
    is_primary: boolean;
  },
  tier: Tier,
): string {
  const parts = [`Status 2xx–3xx · timeout ${Math.round(m.timeout_ms / 1000)} s`];
  if (!m.is_primary)
    parts.push(`slow > ${(slowMsOf(m.thresholds) ?? defaultSlowMs(tier)) / 1000} s × 3 rounds`);
  if (m.must_contain.length) parts.push(`must contain ${m.must_contain.map((k) => `“${k}”`).join(', ')}`);
  if (m.must_not_contain.length)
    parts.push(
      `must not contain ${m.must_not_contain.length} phrase${m.must_not_contain.length > 1 ? 's' : ''}`,
    );
  if (m.allowed_redirect_domains.length)
    parts.push(`redirects stay on ${m.allowed_redirect_domains.join(', ')}`);
  return parts.join(' · ');
}

/**
 * DOWN episodes of the given sites since `from`, read from their incidents' timelines (spec §5:
 * uptime counts DOWN minutes only). An incident still open, or resolved after `from`, may hold drops
 * inside the window.
 */
export async function downEpisodesBySite(supabase: Client, siteIds: readonly string[], from: Date) {
  const out = new Map<string, ReturnType<typeof episodesFromTimeline>>();
  if (siteIds.length === 0) return out;
  const { data, error } = await supabase
    .from('incidents')
    .select('site_id, started_at, severity, incident_events(type, at, payload)')
    .in('site_id', [...siteIds])
    .eq('severity', 'down')
    .or(`resolved_at.is.null,resolved_at.gte.${from.toISOString()}`);
  if (error) throw new Error(`incidents: ${error.message}`);
  for (const i of data) {
    const drops = episodesFromTimeline({ started_at: i.started_at, severity: i.severity }, i.incident_events);
    out.set(i.site_id, [...(out.get(i.site_id) ?? []), ...drops]);
  }
  return out;
}

/** `/sites/[siteId]` for the range asked; null when the site doesn't exist or isn't readable. */
export async function getSiteDetail(
  siteId: string,
  range: SiteRange,
  now = new Date(),
): Promise<SiteDetail | null> {
  if (!siteIdSchema.safeParse(siteId).success) return null;
  return loadSiteDetail(await createClient(), siteId, range, now);
}

/** The loader on a given client (the integration test passes its own). */
export async function loadSiteDetail(
  supabase: DbClient,
  siteId: string,
  range: SiteRange,
  now: Date,
): Promise<SiteDetail | null> {
  const { data: s, error } = await supabase
    .from('sites')
    .select(
      `id, name, tier, is_active, muted_until, monitoring_started_at, hosting, credential_ref,
       clients!inner(name, is_internal, am:profiles!clients_am_user_id_fkey(display_name)),
       owner:profiles!sites_primary_owner_id_fkey(display_name),
       backup:profiles!sites_backup_owner_id_fkey(display_name),
       site_status(status, since),
       monitors(id, is_primary, url, timeout_ms, must_contain, must_not_contain, allowed_redirect_domains,
                thresholds, removed_at, monitor_status(status, cause))`,
    )
    .eq('id', siteId)
    .maybeSingle();
  if (error) throw new Error(`site: ${error.message}`);
  if (!s) return null;

  const tier = s.tier as Tier;
  const spec = SITE_RANGES[range];
  const from = new Date(now.getTime() - spec.minutes * 60_000);
  const historyFrom = new Date(now.getTime() - HISTORY_DAYS * DAY_MS);
  const monitors = s.monitors.filter((m) => !m.removed_at);
  const primary = monitors.find((m) => m.is_primary);
  const ids = monitors.map((m) => m.id);

  const [incidents, series, latest, log, today] = await Promise.all([
    supabase
      .from('incidents')
      .select(
        `id, number, state, severity, trigger, escalation_level, started_at, detected_at,
         acker:profiles!incidents_acked_by_fkey(display_name), incident_events(type, at, payload)`,
      )
      .eq('site_id', s.id)
      .or(`started_at.gte.${historyFrom.toISOString()},resolved_at.is.null`)
      .order('started_at', { ascending: false }),
    supabase.rpc('site_response_series', {
      p_site_id: s.id,
      p_from: from.toISOString(),
      p_bucket: spec.bucket,
    }),
    ids.length
      ? supabase
          .from('check_results')
          .select('monitor_id, location, outcome, status_code, response_ms, error, checked_at, attempt')
          .in('monitor_id', ids)
          .gt('checked_at', new Date(now.getTime() - 15 * 60_000).toISOString())
          .order('checked_at', { ascending: false })
          .order('attempt', { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    primary
      ? supabase
          .from('check_results')
          .select('id, location, outcome, status_code, response_ms, ttfb_ms, checked_at')
          .eq('monitor_id', primary.id)
          .gt('checked_at', new Date(now.getTime() - DAY_MS).toISOString())
          .order('checked_at', { ascending: false })
          .limit(LOG_ROWS)
      : Promise.resolve({ data: [], error: null }),
    primary
      ? supabase
          .from('check_results')
          .select('id', { count: 'exact', head: true })
          .eq('monitor_id', primary.id)
          .gte('checked_at', bangkokMidnight(now).toISOString())
      : Promise.resolve({ count: 0, error: null }),
  ]);
  if (incidents.error) throw new Error(`incidents: ${incidents.error.message}`);
  if (series.error) throw new Error(`site_response_series: ${series.error.message}`);
  if (latest.error) throw new Error(`check_results: ${latest.error.message}`);
  if (log.error) throw new Error(`check_results: ${log.error.message}`);
  if (today.error) throw new Error(`check_results: ${today.error.message}`);

  // Incidents, their drops and the uptime over the range (D-031: from monitoring start at the latest)
  const rows = incidents.data.map((i) => {
    const drops = episodesFromTimeline({ started_at: i.started_at, severity: i.severity }, i.incident_events);
    const open =
      !(CLOSED_INCIDENT_STATES as readonly string[]).includes(i.state) && drops.some((d) => !d.end);
    return { i, drops, minutes: open || drops.length === 0 ? null : episodeMinutes(drops, now) };
  });
  const downDrops = rows.filter((r) => r.i.severity === 'down').flatMap((r) => r.drops);
  const uptime = siteUptimeOver(downDrops, {
    now,
    rangeMinutes: spec.minutes,
    monitoringStartedAt: s.monitoring_started_at ? new Date(s.monitoring_started_at) : null,
  });
  const inRange = rows.filter((r) => new Date(r.i.started_at) >= from || r.minutes === null);
  const summary = inRange.map((r) => ({
    severity: r.i.severity as Severity,
    startedAt: new Date(r.i.started_at),
    minutes: r.minutes,
  }));
  const history: DetailIncident[] = rows
    .filter((r) => new Date(r.i.started_at) >= historyFrom || r.minutes === null)
    .map((r) => ({
      id: r.i.id,
      number: r.i.number,
      startedAt: r.i.started_at,
      minutes: r.minutes,
      trigger: r.i.trigger as Trigger,
      severity: r.i.severity as Severity,
      state: r.i.state as IncidentState,
      level: r.i.escalation_level,
    }));
  const openRow = rows.find((r) => !(CLOSED_INCIDENT_STATES as readonly string[]).includes(r.i.state));
  const openIncident: OpenIncident | null = openRow
    ? {
        id: openRow.i.id,
        number: openRow.i.number,
        state: openRow.i.state as OpenIncident['state'],
        level: openRow.i.escalation_level,
        detectedAt: openRow.i.detected_at,
        ackedBy: openRow.i.acker?.display_name ?? null,
      }
    : null;

  // Latest check per monitor and location (a recheck supersedes its scheduled check)
  const newest = new Map<string, (typeof latest.data)[number]>();
  for (const c of latest.data) {
    const key = `${c.monitor_id}|${c.location}`;
    if (!newest.has(key)) newest.set(key, c);
  }
  const slowMs = slowMsOf(primary?.thresholds) ?? defaultSlowMs(tier);
  const round: RoundCheck[] = primary
    ? LIST_LOCATIONS.flatMap((loc) => {
        const c = newest.get(`${primary.id}|${loc}`);
        if (!c) return [];
        return [
          {
            location: loc,
            glyph: locationGlyph({ outcome: c.outcome, error: c.error, responseMs: c.response_ms }, slowMs),
            outcome: c.outcome,
            statusCode: c.status_code,
            responseMs: c.response_ms,
            checkedAt: c.checked_at,
          },
        ];
      })
    : [];

  const detailMonitors: DetailMonitor[] = monitors
    .map((m) => {
      const ms = Array.isArray(m.monitor_status) ? m.monitor_status[0] : m.monitor_status;
      const lastMs = LIST_LOCATIONS.map((loc) => newest.get(`${m.id}|${loc}`))
        .filter((c) => c?.outcome === 'pass' && c.response_ms !== null)
        .map((c) => c!.response_ms!)
        .sort((a, b) => a - b);
      return {
        id: m.id,
        isPrimary: m.is_primary,
        target: pathOf(m.url),
        assertions: assertionsOf(m, tier),
        status: s.is_active ? ((ms?.status as SiteStatus | undefined) ?? null) : null,
        cause: ms?.cause ?? null,
        lastMs: lastMs.length ? lastMs[Math.floor((lastMs.length - 1) / 2)]! : null,
      };
    })
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.target.localeCompare(b.target));

  const status = Array.isArray(s.site_status) ? s.site_status[0] : s.site_status;
  const seriesRows = series.data as SeriesRow[];
  const stats = rangeStats(seriesRows);
  return {
    id: s.id,
    name: s.name,
    tier,
    live: s.is_active,
    status: s.is_active ? ((status?.status as SiteStatus | undefined) ?? null) : null,
    statusSince: s.is_active ? (status?.since ?? null) : null,
    url: primary?.url ?? null,
    client: {
      name: s.clients.name,
      internal: s.clients.is_internal,
      amName: s.clients.am?.display_name ?? null,
    },
    owner: s.owner?.display_name ?? null,
    backup: s.backup?.display_name ?? null,
    hosting: s.hosting,
    credentialRef: s.credential_ref,
    mutedUntil: s.muted_until,
    openIncident,
    stats: {
      uptime: uptime?.uptime ?? null,
      p50: stats.p50,
      p95: stats.p95,
      incidents: summary.length,
      caption: incidentsCaption(summary),
    },
    chart: chartLines(seriesRows, LIST_LOCATIONS) as SiteDetail['chart'],
    chartFrom: from.getTime(),
    chartTo: now.getTime(),
    round,
    monitors: detailMonitors,
    history,
    historyMttr: mttrMinutes(
      history.map((h) => ({ severity: h.severity, startedAt: new Date(h.startedAt), minutes: h.minutes })),
    ),
    log: log.data.map((c): CheckLogRow => ({
      id: c.id,
      checkedAt: c.checked_at,
      location: c.location,
      outcome: c.outcome,
      statusCode: c.status_code,
      responseMs: c.response_ms,
      ttfbMs: c.ttfb_ms,
    })),
    checksToday: today.count ?? 0,
  };
}
