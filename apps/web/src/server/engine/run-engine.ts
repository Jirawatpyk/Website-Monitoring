import 'server-only';
import type { DbClient, Json } from '@dxt/db';
import {
  decideSite,
  faultyByMinute,
  lookbackMs,
  NEW_MONITOR,
  UNKNOWN_ROOT_CAUSE,
  type MonitorCarry,
  type MonitorState,
  type OpenIncident,
  type SiteDecision,
  type SiteMonitor,
  type SiteSnapshot,
  type StoredCheck,
} from '@dxt/engine';
import {
  formatCause,
  formatProblemCause,
  formatProblemSummary,
  type ProblemCauseContext,
} from '@dxt/notifier';
import { TIER_CONFIG, type ProbeLocation, type Tier, type Trigger } from '@dxt/shared';
import type { CronJobResult } from '../cron-job';
import { HTTP_MONITOR_TYPES } from '../probe/due-monitors';
import { BACKLOG_ALERT_OVER, loadVerifierState } from './verifier-state';

/** Rounds judged per site per run: catches up after a missed run without running unbounded. */
const MAX_ROUNDS_PER_RUN = 5;
const OPEN_STATES_EXCLUDED = '("resolved","in_review","closed")';
/**
 * A round expects only the active locations whose probe beat this recently (D-019): a stopped VPS
 * agent drops out of the vote at once instead of holding every round until its deadline.
 */
export const HEARTBEAT_FRESH_MS = 3 * 60_000;

interface MonitorRow {
  id: string;
  url: string;
  isPrimary: boolean;
  mustContain: string[];
  timeoutMs: number;
  slowThresholdMs: number;
  allowedRedirectDomains: string[];
}

interface SiteRow {
  id: string;
  name: string;
  tier: Tier;
  muted: boolean;
  monitors: MonitorRow[];
}

export interface EngineSummary extends CronJobResult {
  /** Sites judged (each with its primary and key-page monitors). */
  sites: number;
  monitors: number;
  /** DOWN incidents opened (their alerts are queued). */
  opened: number;
  /** PROBLEM incidents opened, PROBLEM (unverified) included (their alerts are queued unless muted). */
  problems: number;
  recovered: number;
  settled: number;
  /** A new problem on a recovered incident: no alert until D-004 (S04b). */
  relapses: number;
  /** Blocked rounds handed to the browser verifier this run (one per monitor). */
  verifying: number;
  /** Monitors the verifier couldn't decide this run: PROBLEM (unverified) (D-001). */
  unverified: number;
  /** Admin alerts opened this run (their emails are queued). */
  alerts: number;
  /** Open PROBLEM incidents raised to DOWN (D-021); their DOWN alerts are queued. */
  escalated: number;
}

/**
 * One engine run (PRD §10, D-022): for every active site, load its monitors' recent check results,
 * their carry state, the site status and its open incident, ask `decideSite`, and record the
 * decision. Writes that belong together go through the engine_* SQL functions (one transaction
 * each, the monitors' verdicts and the site status included); repeated runs are harmless (one open
 * incident per site, one message per incident).
 */
export async function runEngine(db: DbClient, now: Date = new Date()): Promise<EngineSummary> {
  const summary: EngineSummary = {
    ok: true,
    sites: 0,
    monitors: 0,
    opened: 0,
    problems: 0,
    recovered: 0,
    settled: 0,
    relapses: 0,
    verifying: 0,
    unverified: 0,
    alerts: 0,
    escalated: 0,
  };
  const [sites, locations] = await Promise.all([loadSites(db, now), loadLocations(db, now)]);
  if (!sites.length) {
    // Nothing to judge, but an open Admin alert still clears / a backlog is still seen.
    const verifier = await loadVerifierState(db, [], now, now);
    summary.alerts = await adminAlerts(db, now, verifier, new Map(), locations);
    return summary;
  }
  const monitors = sites.flatMap((s) => s.monitors);
  summary.sites = sites.length;
  summary.monitors = monitors.length;

  const since = new Date(
    now.getTime() - Math.max(...sites.map((s) => lookbackMs(TIER_CONFIG[s.tier].intervalSec))),
  );
  const siteIds = sites.map((s) => s.id);
  const monitorIds = monitors.map((m) => m.id);
  const [checks, statuses, carries, incidents, verifier] = await Promise.all([
    loadChecks(db, monitorIds, since),
    db.from('site_status').select('site_id, last_round_at, ok_rounds, note').in('site_id', siteIds),
    db
      .from('monitor_status')
      .select('monitor_id, status, trigger, cause, slow_rounds, failing_since')
      .in('monitor_id', monitorIds),
    db
      .from('incidents')
      .select('id, site_id, monitor_id, state, severity, root_cause_category, notifications(template)')
      .in('site_id', siteIds)
      .not('state', 'in', OPEN_STATES_EXCLUDED),
    loadVerifierState(db, monitorIds, since, now),
  ]);
  for (const r of [statuses, carries, incidents]) if (r.error) throw new Error(r.error.message);

  // A location that failed most monitors in a minute is no data for that minute (spec §15.3).
  const faulty = faultyByMinute(
    checks
      .filter((c) => c.attempt !== 2)
      .map((c) => ({
        monitorId: c.monitor_id,
        location: c.location as ProbeLocation,
        outcome: c.outcome,
        checkedAt: new Date(c.checked_at),
      })),
  );

  /** Sites the verifier couldn't decide this run, with the reason it saw (D-019). */
  const unverifiedSites = new Map<string, string>();
  const unverifiedMonitors = new Set<string>();
  for (const site of sites) {
    const status = statuses.data?.find((st) => st.site_id === site.id);
    const open = incidents.data?.find((inc) => inc.site_id === site.id);
    const snapshot: SiteSnapshot = {
      now,
      intervalSec: TIER_CONFIG[site.tier].intervalSec,
      locations,
      lastRoundAt: status?.last_round_at ? new Date(status.last_round_at) : null,
      okRounds: status?.ok_rounds ?? 0,
      open: open
        ? ({
            id: open.id,
            state: open.state,
            severity: open.severity,
            // Same rule as the resolve gate (spec §16.3): "Unknown" isn't a root cause.
            hasRootCause: !!open.root_cause_category && open.root_cause_category !== UNKNOWN_ROOT_CAUSE,
          } satisfies OpenIncident)
        : null,
      monitors: site.monitors.map((m): SiteMonitor => ({
        id: m.id,
        isPrimary: m.isPrimary,
        url: m.url,
        slowThresholdMs: m.slowThresholdMs,
        allowedRedirectDomains: m.allowedRedirectDomains,
        checks: checks.filter((c) => c.monitor_id === m.id).map(toStoredCheck),
        carry: carryOf(carries.data?.find((c) => c.monitor_id === m.id)),
        ...(verifier.jobs.get(m.id) ? { verifications: verifier.jobs.get(m.id)! } : {}),
      })),
      verifierAvailable: verifier.available,
      faulty,
    };
    let note = status?.note ?? null;
    // RECOVERED only replies to an alert that was queued (not one held back by a mute, spec §15.1).
    const alertQueued = !!open?.notifications.some((n) => n.template === 'down' || n.template === 'problem');

    // Judge rounds oldest first until one changes the incident or nothing is ready.
    for (let i = 0; i < MAX_ROUNDS_PER_RUN; i += 1) {
      const decision = decideSite(snapshot);
      if (decision.kind === 'wait') break;
      if (decision.kind === 'verify') {
        summary.verifying += await queueVerifyJobs(db, site, decision.monitorIds, decision.roundAt);
        break;
      }
      if (decision.kind === 'none' && decision.relapse) {
        summary.relapses += 1;
        console.warn(JSON.stringify({ event: 'relapse_not_alerted', site: site.id, incident: open?.id }));
      }
      for (const u of decision.unverified) {
        unverifiedMonitors.add(u.monitorId);
        // Judged without it: a late verdict mustn't land on this round or clear the alert.
        if (u.reason === 'not_picked_up') await expireUnpicked(db, u.monitorId, decision.roundAt);
        // A browser that was blocked too is the site's WAF, not the verifier: no Admin alert (D-020).
        if (u.reason !== 'browser_blocked') unverifiedSites.set(site.name, u.reason);
      }
      const applied = await apply(
        db,
        site,
        decision,
        open ? { id: open.id, monitorId: open.monitor_id } : null,
        now,
        alertQueued,
        locations.length,
      );
      if (applied) summary[applied] += 1;
      // The site note follows the latest judged round (OK + note, unverified, or none).
      const next = decision.note ?? null;
      if (next !== note) {
        const noted = await db.rpc('engine_note_site', {
          p_site_id: site.id,
          p_round_at: decision.roundAt.toISOString(),
          // No note clears it.
          ...(next ? { p_note: next } : {}),
        });
        if (noted.error) throw new Error(`engine_note_site: ${noted.error.message}`);
        note = next;
      }
      if (decision.kind !== 'none') break;
      snapshot.lastRoundAt = decision.roundAt;
      snapshot.okRounds = decision.okRounds;
      snapshot.monitors = snapshot.monitors.map((m) => ({
        ...m,
        carry: nextCarry(
          decision.monitors.find((s) => s.monitorId === m.id),
          m,
          site,
        ),
      }));
    }
  }

  summary.unverified = unverifiedMonitors.size;
  summary.alerts = await adminAlerts(db, now, verifier, unverifiedSites, locations);
  return summary;
}

/** The active locations whose probe beat in the last 3 min (D-019). */
async function loadLocations(db: DbClient, now: Date): Promise<ProbeLocation[]> {
  const { data, error } = await db
    .from('probe_locations')
    .select('code, last_heartbeat_at')
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter(
      (l) => !!l.last_heartbeat_at && now.getTime() - Date.parse(l.last_heartbeat_at) <= HEARTBEAT_FRESH_MS,
    )
    .map((l) => l.code as ProbeLocation);
}

const toStoredCheck = (c: Awaited<ReturnType<typeof loadChecks>>[number]): StoredCheck => ({
  location: c.location as ProbeLocation,
  outcome: c.outcome,
  checkedAt: new Date(c.checked_at),
  attempt: c.attempt === 2 ? 2 : 1,
  statusCode: c.status_code,
  error: c.error,
  responseMs: c.response_ms,
  finalUrl: c.final_url,
  keywordMissing: c.keyword_missing,
  keywordForbidden: c.keyword_forbidden,
});

interface CarryRow {
  status: string;
  trigger: Trigger | null;
  cause: string | null;
  slow_rounds: number;
  failing_since: Json;
}

function carryOf(row: CarryRow | undefined): MonitorCarry {
  if (!row) return NEW_MONITOR;
  const failingSince =
    row.failing_since && typeof row.failing_since === 'object' && !Array.isArray(row.failing_since)
      ? (row.failing_since as MonitorCarry['failingSince'])
      : {};
  return {
    status: row.status === 'down' || row.status === 'problem' ? row.status : 'ok',
    trigger: row.trigger,
    cause: row.cause,
    slowRounds: row.slow_rounds,
    failingSince,
  };
}

/** The carry for the next round in this run, with the cause worded as the database will hold it. */
function nextCarry(state: MonitorState | undefined, m: SiteMonitor, site: SiteRow): MonitorCarry {
  if (!state) return m.carry;
  return {
    status: state.status,
    trigger: state.trigger,
    cause: causeOf(state, site),
    slowRounds: state.slowRounds,
    failingSince: state.failingSince,
  };
}

function causeContext(site: SiteRow, monitorId: string): ProblemCauseContext {
  const m = site.monitors.find((x) => x.id === monitorId)!;
  return { monitorUrl: m.url, isPrimary: m.isPrimary, tier: site.tier, timeoutMs: m.timeoutMs };
}

function causeOf(state: MonitorState, site: SiteRow): string | null {
  return state.detail ? formatProblemCause(state.detail, causeContext(site, state.monitorId)) : state.cause;
}

/** The round's monitor verdicts as `engine_write_monitors` takes them (D-022). */
function monitorsJson(d: Exclude<SiteDecision, { kind: 'wait' | 'verify' }>, site: SiteRow): Json {
  return d.monitors.map((m) => ({
    monitorId: m.monitorId,
    status: m.status,
    trigger: m.trigger,
    cause: m.status === 'problem' ? causeOf(m, site) : null,
    slowRounds: m.slowRounds,
    failingSince: m.failingSince as Json,
  }));
}

/** One job per monitor and round (unique index): a second engine run's insert is a no-op. */
async function queueVerifyJobs(
  db: DbClient,
  site: SiteRow,
  monitorIds: string[],
  roundAt: Date,
): Promise<number> {
  let queued = 0;
  for (const id of monitorIds) {
    const m = site.monitors.find((x) => x.id === id)!;
    const { error } = await db.from('verification_jobs').insert({
      kind: 'verify',
      monitor_id: m.id,
      site_id: site.id,
      round_at: roundAt.toISOString(),
      url: m.url,
      must_contain: m.mustContain,
    });
    if (error && error.code !== '23505') throw new Error(`verification_jobs: ${error.message}`);
    if (!error) queued += 1;
  }
  return queued;
}

async function expireUnpicked(db: DbClient, monitorId: string, roundAt: Date): Promise<void> {
  const { error } = await db
    .from('verification_jobs')
    .update({ status: 'expired' })
    .eq('monitor_id', monitorId)
    .eq('round_at', roundAt.toISOString())
    .eq('status', 'queued');
  if (error) throw new Error(`verification_jobs: ${error.message}`);
}

/** The alert names the most telling reason seen this run. */
const REASON_ORDER = ['no_poll', 'lease_expired', 'not_picked_up'] as const;
/** An open Admin alert ("verifier unavailable", "fewer than 2 locations") clears no sooner than this. */
export const ALERT_SETTLE_MS = 10 * 60_000;

/**
 * Admin alerts (D-001, D-019, D-022): the verifier unavailable while a blocked site waited (one
 * email per outage, listing the sites), more than 5 jobs queued, and fewer than 2 probe locations
 * beating. "Unavailable" clears once the verifier polls again with nothing stuck, and "fewer than 2"
 * once 2 beat again — both no sooner than 10 min after they opened; the backlog when the queue is
 * down to 5.
 */
async function adminAlerts(
  db: DbClient,
  now: Date,
  verifier: Awaited<ReturnType<typeof loadVerifierState>>,
  unverifiedSites: ReadonlyMap<string, string>,
  locations: readonly ProbeLocation[],
): Promise<number> {
  let opened = 0;
  const open = async (kind: string, context: Record<string, unknown>) => {
    const { data, error } = await db.rpc('open_system_alert', {
      p_kind: kind,
      p_context: context as Json,
    });
    if (error) throw new Error(`open_system_alert: ${error.message}`);
    if (data) opened += 1;
  };
  const clear = async (kind: string) => {
    const { error } = await db.rpc('clear_system_alert', { p_kind: kind });
    if (error) throw new Error(`clear_system_alert: ${error.message}`);
  };
  const settled = (alert: { openedAt: Date }) => now.getTime() - alert.openedAt.getTime() >= ALERT_SETTLE_MS;

  const down = verifier.openAlerts.get('verifier_unavailable');
  if (unverifiedSites.size && !down) {
    const seen = new Set(unverifiedSites.values());
    await open('verifier_unavailable', {
      sites: [...unverifiedSites.keys()].sort(),
      reason: REASON_ORDER.find((r) => seen.has(r)) ?? 'no_poll',
    });
  } else if (down && verifier.available && verifier.queued === 0 && !unverifiedSites.size && settled(down)) {
    // Polling again with nothing stuck: clear, so the next outage emails again. Not before 10 min,
    // so a verifier that keeps failing jobs can't open and clear it every round.
    await clear('verifier_unavailable');
  }

  const behind = verifier.openAlerts.has('verifier_backlog');
  if (verifier.queued > BACKLOG_ALERT_OVER && !behind)
    await open('verifier_backlog', { queued: verifier.queued });
  else if (verifier.queued <= BACKLOG_ALERT_OVER && behind) await clear('verifier_backlog');

  // PRD §5: fewer than 2 locations → statuses stay as they are and the Admin is told (D-022).
  const low = verifier.openAlerts.get('probe_locations_low');
  if (locations.length < 2 && !low) await open('probe_locations_low', { active: [...locations].sort() });
  else if (locations.length >= 2 && low && settled(low)) await clear('probe_locations_low');
  return opened;
}

/** PostgREST returns at most max_rows (1000) rows per request: read the window page by page. */
export const CHECKS_PAGE = 1000;

async function loadChecks(db: DbClient, monitorIds: string[], since: Date) {
  const rows = [];
  for (let from = 0; ; from += CHECKS_PAGE) {
    const { data, error } = await db
      .from('check_results')
      .select(
        'id, monitor_id, location, outcome, checked_at, attempt, status_code, error, response_ms, final_url, keyword_missing, keyword_forbidden',
      )
      .in('monitor_id', monitorIds)
      .gte('checked_at', since.toISOString())
      .order('checked_at', { ascending: false })
      .order('id')
      .range(from, from + CHECKS_PAGE - 1);
    if (error) throw new Error(`check_results: ${error.message}`);
    rows.push(...data);
    if (data.length < CHECKS_PAGE) return rows;
  }
}

/** Every monitor of every active site, grouped by site, the primary first. */
async function loadSites(db: DbClient, now: Date): Promise<SiteRow[]> {
  const { data, error } = await db
    .from('monitors')
    .select(
      'id, url, is_primary, must_contain, timeout_ms, thresholds, allowed_redirect_domains, site_id, sites!inner(name, tier, is_active, muted_until)',
    )
    .eq('sites.is_active', true)
    .in('type', HTTP_MONITOR_TYPES);
  if (error) throw new Error(`monitors: ${error.message}`);
  const sites = new Map<string, SiteRow>();
  for (const m of data) {
    const tier = m.sites.tier as Tier;
    const site = sites.get(m.site_id) ?? {
      id: m.site_id,
      name: m.sites.name,
      tier,
      muted: !!m.sites.muted_until && new Date(m.sites.muted_until) > now,
      monitors: [],
    };
    site.monitors.push({
      id: m.id,
      url: m.url,
      isPrimary: m.is_primary,
      mustContain: m.must_contain,
      timeoutMs: m.timeout_ms,
      slowThresholdMs: slowThreshold(m.thresholds, tier),
      allowedRedirectDomains: m.allowed_redirect_domains,
    });
    sites.set(m.site_id, site);
  }
  // A site whose primary monitor is missing can't be judged (only the primary makes it DOWN).
  return [...sites.values()]
    .filter((s) => s.monitors.some((m) => m.isPrimary))
    .map((s) => ({ ...s, monitors: s.monitors.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)) }));
}

/** The monitor's own slow limit (`thresholds.slowMs`), else the tier's (PRD §5). */
function slowThreshold(thresholds: Json, tier: Tier): number {
  const own =
    thresholds && typeof thresholds === 'object' && !Array.isArray(thresholds)
      ? thresholds.slowMs
      : undefined;
  return typeof own === 'number' && own > 0 ? own : TIER_CONFIG[tier].slowThresholdMs;
}

async function apply(
  db: DbClient,
  site: SiteRow,
  d: Exclude<SiteDecision, { kind: 'wait' | 'verify' }>,
  open: { id: string; monitorId: string | null } | null,
  now: Date,
  alertQueued: boolean,
  /** Locations voting this run: the card's "3 of 3 locations". */
  reporting: number,
): Promise<'opened' | 'problems' | 'recovered' | 'settled' | 'escalated' | null> {
  const at = now.toISOString();
  const incidentId = open?.id ?? null;
  const judged = { p_monitors: monitorsJson(d, site), ...(d.status ? { p_status: d.status } : {}) };
  switch (d.kind) {
    case 'none': {
      // Never moves the round back when another engine run (probe trigger, cron) got further.
      const { error } = await db.rpc('engine_record_round', {
        p_site_id: site.id,
        p_round_at: d.roundAt.toISOString(),
        p_evaluated_at: at,
        p_ok_rounds: d.okRounds,
        ...judged,
      });
      if (error) throw new Error(`engine_record_round: ${error.message}`);
      return null;
    }

    case 'problem': {
      // PROBLEM at once, PROBLEM (unverified) included (D-001; its Chat card, D-019). A muted site
      // still gets its incident; only the alert is held back (spec §11: mute is an overlay).
      const ctx = causeContext(site, d.monitorId);
      const { data, error } = await db.rpc('engine_open_incident', {
        p_site_id: site.id,
        p_monitor_id: d.monitorId,
        p_trigger: d.trigger,
        p_severity: 'problem',
        p_started_at: d.startedAt.toISOString(),
        p_detected_at: at,
        p_round_at: d.roundAt.toISOString(),
        p_context: {
          cause: formatProblemCause(d.detail, ctx),
          summary: formatProblemSummary(d.detail, ctx),
          detail: d.detail as unknown as Json,
          monitorUrl: ctx.monitorUrl,
          // "3 of 3 locations" on the card: the locations voting when it opened.
          reporting,
          ...(d.detail.kind === 'blocked' ? { verifier: d.detail.reason } : {}),
        },
        p_notify: !site.muted,
        ...judged,
      });
      if (error) throw new Error(`engine_open_incident: ${error.message}`);
      return data ? 'problems' : null;
    }

    case 'escalate': {
      if (!incidentId) return null;
      const { data, error } = await db.rpc('engine_escalate_incident', {
        p_incident_id: incidentId,
        p_detected_at: d.confirmedAt.toISOString(),
        p_round_at: d.roundAt.toISOString(),
        // When the outage started, apart from the PROBLEM before it (uptime, D-002 count from here).
        p_context: {
          ...downContext(d, site),
          downStartedAt: d.downStartedAt.toISOString(),
          escalated: true,
        },
        p_notify: !site.muted,
        ...judged,
      });
      if (error) throw new Error(`engine_escalate_incident: ${error.message}`);
      return data ? 'escalated' : null;
    }

    case 'open': {
      const { data, error } = await db.rpc('engine_open_incident', {
        p_site_id: site.id,
        p_monitor_id: d.monitorId,
        p_trigger: 'hard_fail',
        p_severity: 'down',
        p_started_at: d.startedAt.toISOString(),
        // When the last recheck confirmed it, not when this run noticed (PRD §9: alert within 30 s).
        p_detected_at: d.confirmedAt.toISOString(),
        p_round_at: d.roundAt.toISOString(),
        p_context: downContext(d, site),
        p_notify: !site.muted,
        ...judged,
      });
      if (error) throw new Error(`engine_open_incident: ${error.message}`);
      return data ? 'opened' : null;
    }

    case 'recover': {
      if (!incidentId) return null;
      const { data, error } = await db.rpc('engine_recover_incident', {
        p_incident_id: incidentId,
        p_from: d.from,
        p_to: d.to,
        // The first OK check, not the engine run: the downtime ends when the site answered again.
        p_recovered_at: d.recoveredAt.toISOString(),
        p_round_at: d.roundAt.toISOString(),
        // A slow PROBLEM's RECOVERED says the limit it is back under: the monitor's own or the tier's.
        p_context: {
          okLocations: d.okLocations,
          slowLimitMs:
            site.monitors.find((m) => m.id === open?.monitorId)?.slowThresholdMs ??
            TIER_CONFIG[site.tier].slowThresholdMs,
        },
        p_notify: !site.muted && alertQueued,
        ...judged,
      });
      if (error) throw new Error(`engine_recover_incident: ${error.message}`);
      return data ? 'recovered' : null;
    }

    case 'settle': {
      if (!incidentId) return null;
      const { data, error } = await db.rpc('engine_settle_incident', {
        p_incident_id: incidentId,
        p_from: d.from,
        p_to: d.to,
        p_at: at,
        p_round_at: d.roundAt.toISOString(),
        ...judged,
      });
      if (error) throw new Error(`engine_settle_incident: ${error.message}`);
      return data ? 'settled' : null;
    }
  }
}

/** The DOWN alert's facts: the confirming checks, or the browser's verdict (blocked → page failed). */
function downContext(
  d: Extract<SiteDecision, { kind: 'open' | 'escalate' }>,
  site: SiteRow,
): Record<string, Json> {
  const timeoutMs = site.monitors.find((m) => m.id === d.monitorId)?.timeoutMs ?? 30_000;
  return d.verifyJobId
    ? {
        cause: `Browser: page didn’t load${d.browserDetail ? ` (${d.browserDetail})` : ''}`,
        confirmingLocations: d.failing.length,
        verifyJobId: d.verifyJobId,
      }
    : { cause: formatCause(d.failing, timeoutMs), confirmingLocations: d.failing.length };
}
