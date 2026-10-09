import 'server-only';
import { cache } from 'react';
import { downEpisodesFromTimeline, episodeMinutes, episodesFromTimeline, siteUptimeOver } from '@dxt/engine';
import {
  bangkokDayStart,
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
import { fetchAllPages } from './csv';
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
/** Two full rounds of the three locations. */
const LOG_ROWS = 6;
/** Incidents read for a page (the history shows 90 days; Export has every row). */
const INCIDENT_ROWS = 200;
const DAY_MS = 86_400_000;

/** A monitor's own slow limit (ms), if it has one; else the tier default applies. */
export function slowMsOf(thresholds: unknown): number | null {
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
 * DOWN episodes per site since `from`, read from their incidents' timelines (spec §5: uptime counts
 * DOWN minutes only; D-021: a PROBLEM raised to DOWN counts from the escalation). An incident still open,
 * or resolved after `from`, may hold drops inside the window. `siteIds` null = every readable site.
 * Paged: PostgREST answers 1,000 rows a request.
 */
export async function downEpisodesBySite(supabase: DbClient, siteIds: readonly string[] | null, from: Date) {
  const out = new Map<string, ReturnType<typeof downEpisodesFromTimeline>>();
  if (siteIds?.length === 0) return out;
  const data = await fetchAllPages(
    (x, y) => {
      let q = supabase
        .from('incidents')
        .select('id, site_id, started_at, resolved_at, severity, incident_events(type, at, payload)')
        .in('incident_events.type', ['detected', 'relapsed', 'escalated_to_down', 'recovered'])
        .eq('severity', 'down')
        .or(`resolved_at.is.null,resolved_at.gte.${from.toISOString()}`);
      if (siteIds) q = q.in('site_id', [...siteIds]);
      return q.order('id').range(x, y);
    },
    { max: 50_000 },
  );
  for (const i of data) {
    const drops = downEpisodesFromTimeline(i, i.incident_events);
    out.set(i.site_id, [...(out.get(i.site_id) ?? []), ...drops]);
  }
  return out;
}

/**
 * When monitoring of a site started, for its uptime window (D-031). A live site created before S05
 * added `monitoring_started_at` (a script-made test site) has none: its creation time stands in.
 * Null for a site that isn't monitored now (a Draft, or stopped).
 */
export function watchedSince(s: {
  is_active: boolean;
  monitoring_started_at: string | null;
  created_at: string;
}): Date | null {
  // A stopped site shows no uptime: its stopped days would count as up (engine review M2; the
  // start / stop history comes with maintenance windows, S09)
  if (!s.is_active) return null;
  return new Date(s.monitoring_started_at ?? s.created_at);
}

/** The cause the engine wrote when the incident opened ("Timeout > 30 s (BKK, TYO) · …"), if any. */
function causeOf(events: readonly { type: string; payload: unknown }[]): string | null {
  const p = events.find((e) => e.type === 'detected')?.payload;
  const cause = p && typeof p === 'object' ? (p as Record<string, unknown>).cause : null;
  return typeof cause === 'string' && cause.trim() ? cause : null;
}

/** A site's name, for the page's tab title; null when unknown or unreadable. */
export const getSiteName = cache(async (siteId: string): Promise<string | null> => {
  if (!siteIdSchema.safeParse(siteId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from('sites').select('name').eq('id', siteId).maybeSingle();
  if (error) throw new Error(`site: ${error.message}`);
  return data?.name ?? null;
});

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
      `id, name, tier, is_active, muted_until, monitoring_started_at, created_at, hosting, credential_ref,
       clients!inner(name, is_internal, am:profiles!clients_am_user_id_fkey(display_name)),
       owner:profiles!sites_primary_owner_id_fkey(id, display_name),
       backup:profiles!sites_backup_owner_id_fkey(id, display_name),
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

  const [incidents, series, latest, log, today, downs, counted] = await Promise.all([
    supabase
      .from('incidents')
      .select(
        `id, number, state, severity, trigger, escalation_level, started_at, detected_at, resolved_at,
         acker:profiles!incidents_acked_by_fkey(display_name), incident_events(type, at, payload)`,
      )
      .eq('site_id', s.id)
      .or(
        `started_at.gte.${historyFrom.toISOString()},resolved_at.is.null,resolved_at.gte.${historyFrom.toISOString()}`,
      )
      .order('started_at', { ascending: false })
      .limit(INCIDENT_ROWS),
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
          .select('id, location, outcome, status_code, response_ms, ttfb_ms, error, checked_at')
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
          .gte('checked_at', bangkokDayStart(now).toISOString())
      : Promise.resolve({ count: 0, error: null }),
    // uptime counts every DOWN drop in the range, whatever the row cap above
    downEpisodesBySite(supabase, [s.id], from),
    supabase
      .from('incidents')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', s.id)
      .or(
        `started_at.gte.${historyFrom.toISOString()},resolved_at.is.null,resolved_at.gte.${historyFrom.toISOString()}`,
      ),
  ]);
  if (counted.error) throw new Error(`incidents: ${counted.error.message}`);
  if (incidents.error) throw new Error(`incidents: ${incidents.error.message}`);
  if (series.error) throw new Error(`site_response_series: ${series.error.message}`);
  if (latest.error) throw new Error(`check_results: ${latest.error.message}`);
  if (log.error) throw new Error(`check_results: ${log.error.message}`);
  if (today.error) throw new Error(`check_results: ${today.error.message}`);

  // Incidents, their drops and the uptime over the range (D-031: from monitoring start at the latest)
  const rows = incidents.data.map((i) => {
    const drops = episodesFromTimeline(i, i.incident_events);
    const open =
      !(CLOSED_INCIDENT_STATES as readonly string[]).includes(i.state) &&
      (drops.length === 0 || drops.some((d) => !d.end));
    const lastEnd = drops.reduce((t, d) => Math.max(t, (d.end ?? now).getTime()), Date.parse(i.started_at));
    return {
      i,
      drops,
      open,
      endsAt: open ? now.getTime() : lastEnd,
      minutes: open ? null : episodeMinutes(drops, now),
    };
  });
  const uptime = siteUptimeOver(downs.get(s.id) ?? [], {
    now,
    rangeMinutes: spec.minutes,
    monitoringStartedAt: watchedSince(s),
  });
  // In range = overlapping it, the same window the uptime counts (spec-checker: a 99.9% next to "none")
  const inRange = rows.filter((r) => r.endsAt >= from.getTime());
  const summary = inRange.map((r) => ({
    severity: r.i.severity as Severity,
    startedAt: new Date(r.i.started_at),
    minutes: r.minutes,
  }));
  const toRow = (r: (typeof rows)[number]): DetailIncident => ({
    id: r.i.id,
    number: r.i.number,
    startedAt: r.i.started_at,
    minutes: r.minutes,
    open: r.open,
    trigger: r.i.trigger as Trigger,
    severity: r.i.severity as Severity,
    state: r.i.state as IncidentState,
    level: r.i.escalation_level,
    cause: causeOf(r.i.incident_events),
  });
  const rangeIncidents = inRange.map(toRow);
  const history: DetailIncident[] = rows.filter((r) => r.endsAt >= historyFrom.getTime()).map(toRow);
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
    ownerIds: [s.owner?.id, s.backup?.id].filter((v): v is string => !!v),
    slowMs,
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
    historyCount: Math.max(counted.count ?? 0, history.length),
    rangeIncidents,
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
      error: c.error,
    })),
    checksToday: today.count ?? 0,
  };
}
