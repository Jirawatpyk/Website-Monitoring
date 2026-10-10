import 'server-only';
import { cache } from 'react';
import type { DbClient } from '@dxt/db';
import { episodesFromTimeline, outageMinutes } from '@dxt/engine';
import { describeFailure } from '@dxt/notifier';
import type { LocationGlyph } from '@/components/site-cells';
import {
  CLOSED_INCIDENT_STATES_IN,
  isTlsChainError,
  PROBE_LOCATIONS,
  TRIGGER_LABELS,
  UNDO_WINDOW_SEC,
  type IncidentState,
  type ProbeLocation,
  type Role,
  type Severity,
  type Trigger,
} from '@dxt/shared';
import { getAccess } from '@/lib/auth/session';
import { fetchAllPages } from '@/lib/csv';
import { createClient } from '@/lib/supabase/server';
import { serviceDb } from '@/server/db';
import { SCREENSHOT_BUCKET } from '@/server/verifier/jobs';
import {
  durationMinutes,
  resolveGate,
  timelineOf,
  type EventRow,
  type Gate,
  type ListIncident,
  type TimelineItem,
} from './model';
import { incidentIdSchema } from './schemas';
import { buildIncidentView, canAcknowledge, type IncidentRow, type IncidentView, type Viewer } from './view';

/** Signed screenshot links live this long (D-033): enough to open, not to share around. */
const SIGNED_URL_SEC = 600;
/** A long incident's timeline is read in pages (PostgREST answers 1,000 rows at most). */
const MAX_EVENTS = 5000;
/** Ids per `in` filter (kept well under URL limits). */
const ID_CHUNK = 150;
/** The events `episodesFromTimeline` reads an incident's drops from. */
const DROP_EVENTS = ['detected', 'recovered', 'relapsed', 'escalated_to_down'];

/** One location's checks for the Evidence card: first check, the recheck and the latest. */
export interface LocationEvidence {
  location: ProbeLocation;
  first: CheckCell | null;
  recheck: CheckCell | null;
  latest: CheckCell | null;
}
export interface CheckCell {
  text: string;
  /** The §11 legend glyph (D-029: a broken certificate chain is not a hard fail). */
  glyph: LocationGlyph;
}

export interface IncidentDetail {
  /** The MobileAck parts (S02b): badges, title, the ack state and its log. */
  view: IncidentView;
  siteId: string;
  siteName: string;
  tier: number;
  trigger: Trigger;
  triggerLabel: string;
  severity: Severity;
  state: IncidentState;
  escalationLevel: number;
  startedAt: string;
  detectedAt: string;
  recoveredAt: string | null;
  resolvedAt: string | null;
  autoResolved: boolean;
  /** Seconds from the first failed check to confirmed down (MTTD on the facts strip). */
  detectSeconds: number;
  durationMinutes: number;
  owner: string | null;
  backup: string | null;
  am: string | null;
  acked: { by: string; at: string } | null;
  /** Add note, root cause, Resolve: the Acknowledge rule (D-033). */
  canAct: boolean;
  rootCause: { category: string | null; what: string | null; fix: string | null };
  gate: Gate;
  /** The latest resolve, while its messages may still be held (Undo). */
  resolved: { by: string; byViewer: boolean; at: string; postsAt: string; posted: string | null } | null;
  timeline: TimelineItem[];
  locations: LocationEvidence[];
  evidence: { url: string; takenAt: string; afterRecovery: boolean } | null;
}

interface DetailRow extends IncidentRow {
  site_id: string;
  monitor_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  auto_resolved: boolean;
  client_update_required: boolean;
  client_updated_at: string | null;
  root_cause_category: string | null;
  root_cause: string | null;
  root_cause_fix: string | null;
  sites: IncidentRow['sites'] & { clients: { am_user_id: string | null } | null };
}

interface CheckRow {
  location: string;
  outcome: string;
  status_code: number | null;
  response_ms: number | null;
  error: string | null;
  checked_at: string;
}

const cellOf = (c: CheckRow | undefined, timeoutMs: number): CheckCell | null => {
  if (!c) return null;
  if (c.outcome === 'pass') {
    return { text: `${c.status_code ?? 200} · ${c.response_ms ?? '—'} ms`, glyph: 'pass' };
  }
  if (c.outcome === 'blocked') return { text: 'Blocked by bot protection', glyph: 'blocked' };
  const what = describeFailure(
    { location: c.location as ProbeLocation, statusCode: c.status_code, error: c.error },
    timeoutMs,
  );
  const secs = c.response_ms !== null && c.status_code ? ` · ${(c.response_ms / 1000).toFixed(1)} s` : '';
  return { text: `${what}${secs}`, glyph: isTlsChainError(c.error) ? 'chain' : 'fail' };
};

/**
 * First check, recheck and latest per location (Incident "Evidence by location"): the first check is
 * each location's earliest row from the first failed check on, the recheck its latest at or before
 * the confirm, the latest its newest row.
 */
export function locationsOf(
  around: readonly CheckRow[],
  latest: readonly CheckRow[],
  detectedAt: string,
  timeoutMs: number,
): LocationEvidence[] {
  const confirm = Date.parse(detectedAt);
  return PROBE_LOCATIONS.flatMap((location) => {
    const mine = around
      .filter((c) => c.location === location)
      .sort((a, b) => a.checked_at.localeCompare(b.checked_at));
    const recheck = mine.filter((c) => Date.parse(c.checked_at) <= confirm).at(-1);
    const first = mine[0];
    const last = latest
      .filter((c) => c.location === location)
      .sort((a, b) => b.checked_at.localeCompare(a.checked_at))[0];
    if (!first && !last) return [];
    return [
      {
        location,
        first: cellOf(first, timeoutMs),
        recheck: recheck && recheck !== first ? cellOf(recheck, timeoutMs) : null,
        latest: cellOf(last, timeoutMs),
      },
    ];
  });
}

/** The latest resolve and whether its RESOLVED is still held (the Undo card / the dialog's done state). */
function resolvedOf(
  i: DetailRow,
  events: readonly EventRow[],
  viewer: Viewer,
  nameOf: (id: string | null) => string,
): IncidentDetail['resolved'] {
  if (i.state !== 'resolved' || i.auto_resolved || !i.resolved_at) return null;
  const e = [...events].filter((x) => x.type === 'resolved').sort((a, b) => b.at.localeCompare(a.at))[0];
  const postsAt =
    (typeof e?.payload.posts_at === 'string' ? e.payload.posts_at : null) ??
    new Date(Date.parse(i.resolved_at) + UNDO_WINDOW_SEC * 1000).toISOString();
  const posted = events
    .filter((x) => x.type === 'alerted' && x.payload.template === 'resolved' && x.at >= i.resolved_at!)
    .map((x) => x.at)
    .sort()[0];
  return {
    by: nameOf(i.resolved_by),
    byViewer: i.resolved_by === viewer.id,
    at: i.resolved_at,
    postsAt,
    posted: posted ?? null,
  };
}

/** The incident page (Incident / MIncident boards), read as the signed-in person. */
export const getIncident = cache(async function getIncident(
  incidentId: string,
  now = new Date(),
): Promise<IncidentDetail | null> {
  if (!incidentIdSchema.safeParse(incidentId).success) return null;
  const access = await getAccess();
  if (access.status !== 'active') return null;
  return loadIncident(await createClient(), access.profile, incidentId, now, signScreenshot);
});

/** A short-lived link to a verifier screenshot (private bucket, no storage policies: S03). */
async function signScreenshot(path: string): Promise<string | null> {
  const { data, error } = await serviceDb()
    .storage.from(SCREENSHOT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SEC);
  return error ? null : data.signedUrl;
}

/** `getIncident` with the client and the signer passed in, for the integration test. */
export async function loadIncident(
  db: DbClient,
  viewer: Viewer,
  incidentId: string,
  now: Date,
  sign: (path: string) => Promise<string | null>,
): Promise<IncidentDetail | null> {
  const incident = await db
    .from('incidents')
    .select(
      `id, number, state, severity, trigger, escalation_level, started_at, detected_at, acked_at, acked_by,
       recovered_at, resolved_at, resolved_by, auto_resolved, client_update_required, client_updated_at,
       root_cause_category, root_cause, root_cause_fix, site_id, monitor_id,
       sites!inner(name, tier, primary_owner_id, backup_owner_id, monitors(url, is_primary, timeout_ms),
         clients(am_user_id))`,
    )
    .eq('id', incidentId)
    .maybeSingle()
    .overrideTypes<DetailRow, { merge: false }>();
  if (incident.error) throw new Error(`incident: ${incident.error.message}`);
  const i = incident.data;
  if (!i) return null;

  const primary = (i.sites.monitors as { url: string; is_primary: boolean; timeout_ms?: number }[]).find(
    (m) => m.is_primary,
  );
  const monitorId = i.monitor_id;
  // From the first failed check (`started_at`): a passing check before it isn't evidence.
  const aroundFrom = i.started_at;
  const aroundTo = new Date(Date.parse(i.detected_at) + 60_000).toISOString();
  const checkCols = 'location, outcome, status_code, response_ms, error, checked_at';
  const [events, around, latest] = await Promise.all([
    fetchAllPages<EventRow>(
      (from, to) =>
        db
          .from('incident_events')
          .select('type, at, actor_id, payload')
          .eq('incident_id', incidentId)
          .order('at')
          .order('id')
          .range(from, to)
          .overrideTypes<EventRow[], { merge: false }>(),
      { max: MAX_EVENTS },
    ),
    monitorId
      ? db
          .from('check_results')
          .select(checkCols)
          .eq('monitor_id', monitorId)
          .gte('checked_at', aroundFrom)
          .lte('checked_at', aroundTo)
          .order('checked_at')
          .limit(60)
      : Promise.resolve({ data: [] as CheckRow[], error: null }),
    monitorId
      ? db
          .from('check_results')
          .select(checkCols)
          .eq('monitor_id', monitorId)
          .gt('checked_at', new Date(now.getTime() - 15 * 60_000).toISOString())
          .order('checked_at', { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] as CheckRow[], error: null }),
  ]);
  if (around.error) throw new Error(`check_results: ${around.error.message}`);
  if (latest.error) throw new Error(`check_results: ${latest.error.message}`);

  const ids = new Set<string>();
  const am = i.sites.clients?.am_user_id ?? null;
  for (const id of [i.acked_by, i.resolved_by, i.sites.primary_owner_id, i.sites.backup_owner_id, am]) {
    if (id) ids.add(id);
  }
  for (const e of events) {
    if (e.actor_id) ids.add(e.actor_id);
    if (typeof e.payload.user_id === 'string') ids.add(e.payload.user_id);
  }
  const people = ids.size
    ? await db
        .from('profiles')
        .select('id, display_name')
        .in('id', [...ids])
    : { data: [], error: null };
  if (people.error) throw new Error(`profiles: ${people.error.message}`);
  const names = new Map((people.data ?? []).map((p) => [p.id, p.display_name]));
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? 'someone') : 'someone');

  const evidenceEvent = [...events].reverse().find((e) => e.type === 'evidence');
  const shot =
    typeof evidenceEvent?.payload.screenshotPath === 'string' ? evidenceEvent.payload.screenshotPath : null;
  const url = shot ? await sign(shot) : null;

  return {
    view: buildIncidentView(i, events, viewer, names, now),
    siteId: i.site_id,
    siteName: i.sites.name,
    tier: i.sites.tier,
    trigger: i.trigger,
    triggerLabel: TRIGGER_LABELS[i.trigger],
    severity: i.severity,
    state: i.state,
    escalationLevel: i.escalation_level,
    startedAt: i.started_at,
    detectedAt: i.detected_at,
    recoveredAt: i.recovered_at,
    resolvedAt: i.resolved_at,
    autoResolved: i.auto_resolved,
    detectSeconds: Math.max(0, Math.round((Date.parse(i.detected_at) - Date.parse(i.started_at)) / 1000)),
    durationMinutes:
      outageMinutes(episodesFromTimeline(i, events), now) ??
      durationMinutes(
        { startedAt: i.started_at, recoveredAt: i.recovered_at, resolvedAt: i.resolved_at, drops: [] },
        now,
      ),
    owner: i.sites.primary_owner_id ? nameOf(i.sites.primary_owner_id) : null,
    backup: i.sites.backup_owner_id ? nameOf(i.sites.backup_owner_id) : null,
    am: am ? nameOf(am) : null,
    acked: i.acked_at && i.acked_by ? { by: nameOf(i.acked_by), at: i.acked_at } : null,
    canAct: canAcknowledge(viewer, i),
    rootCause: { category: i.root_cause_category, what: i.root_cause, fix: i.root_cause_fix },
    gate: resolveGate(
      {
        siteName: i.sites.name,
        state: i.state,
        recoveredAt: i.recovered_at,
        clientUpdateRequired: i.client_update_required,
        clientUpdatedAt: i.client_updated_at,
        rootCauseCategory: i.root_cause_category,
      },
      events,
      nameOf,
    ),
    resolved: resolvedOf(i, events, viewer, nameOf),
    timeline: timelineOf(
      { severity: i.severity, trigger: i.trigger, startedAt: i.started_at, recoveredAt: i.recovered_at },
      events,
      nameOf,
      now,
    ),
    locations: locationsOf(
      around.data ?? [],
      latest.data ?? [],
      i.detected_at,
      primary?.timeout_ms ?? 30_000,
    ),
    evidence:
      url && evidenceEvent
        ? {
            url,
            takenAt: evidenceEvent.at,
            afterRecovery: !!i.recovered_at && evidenceEvent.at > i.recovered_at,
          }
        : null,
  };
}

/** Open incidents (any state before Resolved) for the nav count; null when it can't be read. */
export async function countOpenIncidents(): Promise<number | null> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('incidents')
    .select('id', { count: 'exact', head: true })
    .not('state', 'in', CLOSED_INCIDENT_STATES_IN);
  return error ? null : count;
}

// ── List ─────────────────────────────────────────────────────────────────

export interface IncidentList {
  /** The signed-in person (`listIncidents` only; the CSV reads without one). */
  viewer?: { id: string; role: Role };
  incidents: ListIncident[];
  sites: { id: string; name: string }[];
}

interface ListRow {
  id: string;
  number: number;
  site_id: string;
  severity: Severity;
  trigger: Trigger;
  state: IncidentState;
  escalation_level: number;
  started_at: string;
  detected_at: string;
  acked_at: string | null;
  recovered_at: string | null;
  resolved_at: string | null;
  auto_resolved: boolean;
  is_flapping: boolean;
  is_manual: boolean;
  root_cause_category: string | null;
  root_cause: string | null;
  root_cause_fix: string | null;
  acker: { display_name: string } | null;
  sites: {
    name: string;
    tier: number;
    primary_owner_id: string | null;
    backup_owner_id: string | null;
    owner: { display_name: string } | null;
  };
}

/** Incidents of the last 30 days plus any still open (the list, its KPIs and the CSV). */
export async function listIncidents(now = new Date()): Promise<IncidentList | null> {
  const access = await getAccess();
  if (access.status !== 'active') return null;
  const list = await loadIncidentList(await createClient(), now);
  return { ...list, viewer: { id: access.profile.id, role: access.profile.role } };
}

export async function loadIncidentList(db: DbClient, now: Date): Promise<IncidentList> {
  const from = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [rows, sites] = await Promise.all([
    fetchAllPages<ListRow>(
      (lo, hi) =>
        db
          .from('incidents')
          .select(
            `id, number, site_id, severity, trigger, state, escalation_level, started_at, detected_at,
             acked_at, recovered_at, resolved_at, auto_resolved, is_flapping, is_manual,
             root_cause_category, root_cause, root_cause_fix,
             acker:profiles!incidents_acked_by_fkey(display_name),
             sites!inner(name, tier, primary_owner_id, backup_owner_id,
               owner:profiles!sites_primary_owner_id_fkey(display_name))`,
          )
          .or(`started_at.gte.${from},state.not.in.(resolved,in_review,closed)`)
          .order('started_at', { ascending: false })
          .order('id')
          .range(lo, hi)
          .overrideTypes<ListRow[], { merge: false }>(),
      { max: 5000 },
    ),
    db.from('sites').select('id, name').order('name'),
  ]);
  if (sites.error) throw new Error(`sites: ${sites.error.message}`);
  const ids = rows.map((r) => r.id);
  // The drop events: how long each was down (D-033), and D-021's escalation, which counts the outage
  // from the escalation (MTTA / MTTR, D-032). A few rows per incident (one per drop and recovery).
  // In chunks: an `in` list rides in the URL, which a few hundred uuids would overflow.
  const chunks: string[][] = [];
  for (let n = 0; n < ids.length; n += ID_CHUNK) chunks.push(ids.slice(n, n + ID_CHUNK));
  const parts = await Promise.all(
    chunks.map((chunk) =>
      fetchAllPages<{ incident_id: string; type: string; at: string; payload: unknown }>(
        (lo, hi) =>
          db
            .from('incident_events')
            .select('incident_id, type, at, payload')
            .in('type', DROP_EVENTS)
            .in('incident_id', chunk)
            .order('at')
            .order('id')
            .range(lo, hi),
        // a flapping night is hundreds of rows; past PostgREST's max_rows a page would end silently
        { max: MAX_EVENTS * ID_CHUNK },
      ),
    ),
  );
  const dropEvents = new Map<string, { type: string; at: string; payload: unknown }[]>();
  for (const e of parts.flat()) {
    dropEvents.set(e.incident_id, [...(dropEvents.get(e.incident_id) ?? []), e]);
  }
  const downStart = new Map(
    [...dropEvents].flatMap(([id, events]) => {
      const raised = events.find((e) => e.type === 'escalated_to_down');
      const p = raised?.payload as Record<string, unknown> | null | undefined;
      return typeof p?.downStartedAt === 'string' ? [[id, p.downStartedAt] as const] : [];
    }),
  );
  const dropsOf = (r: ListRow) =>
    episodesFromTimeline(r, dropEvents.get(r.id) ?? []).map((d) => ({
      start: d.start.toISOString(),
      end: d.end?.toISOString() ?? null,
      severity: d.severity,
    }));
  return {
    incidents: rows.map((r): ListIncident => ({
      id: r.id,
      number: r.number,
      siteId: r.site_id,
      siteName: r.sites.name,
      tier: r.sites.tier,
      severity: r.severity,
      trigger: r.trigger,
      state: r.state,
      escalationLevel: r.escalation_level,
      startedAt: r.started_at,
      downStartedAt: downStart.get(r.id) ?? null,
      detectedAt: r.detected_at,
      ackedAt: r.acked_at,
      ackedByName: r.acker?.display_name ?? null,
      recoveredAt: r.recovered_at,
      resolvedAt: r.resolved_at,
      autoResolved: r.auto_resolved,
      isFlapping: r.is_flapping,
      isManual: r.is_manual,
      ownerName: r.sites.owner?.display_name ?? null,
      primaryOwnerId: r.sites.primary_owner_id,
      backupOwnerId: r.sites.backup_owner_id,
      rootCauseCategory: r.root_cause_category,
      rootCause: r.root_cause,
      rootCauseFix: r.root_cause_fix,
      drops: dropsOf(r),
    })),
    sites: sites.data ?? [],
  };
}
