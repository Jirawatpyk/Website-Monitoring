import 'server-only';
import type { DbClient } from '@dxt/db';
import { DROP_EVENT_TYPES, bangkokMonth, type Span } from '@dxt/engine';
import type { Tier } from '@dxt/shared';
import { maintenanceSpansBySite } from '@/features/sites/server';
import { fetchAllPages } from '@/lib/csv';
import {
  buildFigures,
  parseFigures,
  type FigureIncident,
  type FigureResponseDay,
  type FigureSite,
  type ReportFigures,
} from './figures';

/**
 * The monthly reports' reads (S20, D-072, D-073). The page reads as the signed-in staff member (RLS:
 * every table here is staff-read); the drafts cron reads the same way as the service role. Internal
 * clients get no report.
 */

// D-067: `new_cause` carries every cause change (the cause-back function writes it too).
const EVENTS = [...DROP_EVENT_TYPES, 'new_cause'];
const MAX_ROWS = 50_000;

const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};

export interface ReportClient {
  id: string;
  name: string;
  am: string | null;
  sites: FigureSite[];
}

/**
 * When a site's monitoring started (D-073 item 6), as Site detail reads it (`watchedSince`): a live
 * site set live by a script has no `monitoring_started_at` and counts from when it was added; a Draft
 * never started has no start. A stopped site keeps its start; its stopped stretches leave the month
 * through `site_stopped_spans` (item 12).
 */
function startedAt(s: { is_active: boolean; monitoring_started_at: string | null; created_at: string }) {
  const at = s.monitoring_started_at ?? (s.is_active ? s.created_at : null);
  return at === null ? null : Date.parse(at);
}

/** Clients with a site that was being watched by `to`, Tier 1 clients first, then by name. */
export async function loadReportClients(db: DbClient, to: Date, clientId?: string): Promise<ReportClient[]> {
  let q = db
    .from('clients')
    .select(
      'id, name, am:profiles!clients_am_user_id_fkey(display_name), sites(id, name, tier, is_active, monitoring_started_at, created_at)',
    )
    .eq('is_internal', false);
  if (clientId) q = q.eq('id', clientId);
  const rows = must(await q, 'clients');
  return (rows ?? [])
    .map((c) => ({
      id: c.id,
      name: c.name,
      am: c.am?.display_name ?? null,
      sites: c.sites
        .map((s) => ({ s, started: startedAt(s) }))
        .filter(({ started }) => started !== null && started < to.getTime())
        .map(({ s, started }) => ({
          id: s.id,
          name: s.name,
          tier: s.tier as Tier,
          monitoringStartedAt: new Date(started!),
        })),
    }))
    .filter((c) => c.sites.length > 0)
    .sort(
      (a, b) =>
        Math.min(...a.sites.map((s) => s.tier)) - Math.min(...b.sites.map((s) => s.tier)) ||
        a.name.localeCompare(b.name),
    );
}

/** Incidents of these sites with a drop that may touch [from, to). */
async function loadIncidents(
  db: DbClient,
  siteIds: string[],
  from: Date,
  to: Date,
): Promise<FigureIncident[]> {
  const rows = await fetchAllPages(
    (a, b) =>
      db
        .from('incidents')
        .select(
          'id, site_id, number, severity, trigger, started_at, resolved_at, root_cause_category, root_cause, incident_events(type, at, payload)',
        )
        .in('site_id', siteIds)
        .in('incident_events.type', EVENTS)
        .lt('started_at', to.toISOString())
        .or(`resolved_at.is.null,resolved_at.gte.${from.toISOString()}`)
        .order('started_at')
        .order('id')
        .range(a, b),
    { max: MAX_ROWS },
  );
  return rows.map((i) => ({
    siteId: i.site_id,
    number: i.number,
    severity: i.severity,
    trigger: i.trigger,
    startedAt: i.started_at,
    resolvedAt: i.resolved_at,
    rootCauseCategory: i.root_cause_category,
    rootCause: i.root_cause,
    events: i.incident_events,
  }));
}

/** When monitoring was stopped (D-073 item 12); an open stop runs past `to`. */
async function loadStopped(db: DbClient, from: Date, to: Date): Promise<Map<string, Span[]>> {
  const rows = must(
    await db.rpc('site_stopped_spans', { p_from: from.toISOString(), p_to: to.toISOString() }),
    'site_stopped_spans',
  );
  const out = new Map<string, Span[]>();
  for (const r of rows ?? []) {
    const span = { start: new Date(r.stopped_at), end: r.started_at ? new Date(r.started_at) : to };
    out.set(r.site_id, [...(out.get(r.site_id) ?? []), span]);
  }
  return out;
}

/** The month's day rollups of each site's primary monitor, all locations together (D-073 item 10). */
async function loadResponse(
  db: DbClient,
  siteIds: string[],
  from: Date,
  to: Date,
): Promise<FigureResponseDay[]> {
  const monitors = must(
    await db.from('monitors').select('id, site_id').in('site_id', siteIds).eq('is_primary', true),
    'monitors',
  );
  const siteOf = new Map((monitors ?? []).map((m) => [m.id, m.site_id] as const));
  if (!siteOf.size) return [];
  const rows = await fetchAllPages(
    (a, b) =>
      db
        .from('check_rollups')
        .select('monitor_id, bucket_start, checks, p50_ms, p95_ms')
        .eq('bucket', 'day')
        .is('location', null)
        .in('monitor_id', [...siteOf.keys()])
        .gte('bucket_start', from.toISOString())
        .lt('bucket_start', to.toISOString())
        .order('bucket_start')
        .order('monitor_id')
        .range(a, b),
    { max: MAX_ROWS },
  );
  return rows.map((r) => ({
    siteId: siteOf.get(r.monitor_id)!,
    checks: r.checks,
    p50: r.p50_ms,
    p95: r.p95_ms,
  }));
}

/** Every listed client's figures for a month, worked out now from the database. */
export async function liveFigures(
  db: DbClient,
  monthKey: string,
  now: Date,
  clients: readonly ReportClient[],
): Promise<Map<string, ReportFigures>> {
  const out = new Map<string, ReportFigures>();
  const siteIds = clients.flatMap((c) => c.sites.map((s) => s.id));
  if (!siteIds.length) return out;
  const { from, to } = bangkokMonth(monthKey, now);
  const [incidents, maintenance, stopped, response] = await Promise.all([
    loadIncidents(db, siteIds, from, to),
    maintenanceSpansBySite(db, siteIds, from),
    loadStopped(db, from, to),
    loadResponse(db, siteIds, from, to),
  ]);
  for (const c of clients) {
    const mine = new Set(c.sites.map((s) => s.id));
    out.set(
      c.id,
      buildFigures({
        monthKey,
        now,
        client: { name: c.name, am: c.am },
        sites: c.sites,
        incidents: incidents.filter((i) => mine.has(i.siteId)),
        maintenance,
        stopped,
        response: response.filter((r) => mine.has(r.siteId)),
      }),
    );
  }
  return out;
}

export interface StoredDraft {
  clientId: string;
  generatedAt: string;
  storagePath: string;
  /** Null when the stored shape no longer parses. */
  figures: ReportFigures | null;
}

/** The drafts stored for a month (`client_reports`, D-073 item 11). */
export async function loadDrafts(
  db: DbClient,
  monthKey: string,
  clientId?: string,
): Promise<Map<string, StoredDraft>> {
  let q = db
    .from('client_reports')
    .select('client_id, generated_at, storage_path, figures')
    .eq('month', `${monthKey}-01`);
  if (clientId) q = q.eq('client_id', clientId);
  const rows = must(await q, 'client_reports');
  return new Map(
    (rows ?? []).map((r) => [
      r.client_id,
      {
        clientId: r.client_id,
        generatedAt: r.generated_at,
        storagePath: r.storage_path,
        figures: parseFigures(r.figures),
      },
    ]),
  );
}
