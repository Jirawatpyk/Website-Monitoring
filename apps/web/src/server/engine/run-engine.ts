import 'server-only';
import type { DbClient, Json } from '@dxt/db';
import {
  decideMonitor,
  lookbackMs,
  UNKNOWN_ROOT_CAUSE,
  type MonitorDecision,
  type MonitorSnapshot,
  type OpenIncident,
  type StoredCheck,
} from '@dxt/engine';
import { formatCause } from '@dxt/notifier';
import { TIER_CONFIG, type ProbeLocation, type Tier } from '@dxt/shared';
import type { CronJobResult } from '../cron-job';
import { BACKLOG_ALERT_OVER, loadVerifierState } from './verifier-state';

/** Rounds judged per monitor per run: catches up after a missed run without running unbounded. */
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
  mustContain: string[];
  timeoutMs: number;
  siteId: string;
  siteName: string;
  tier: Tier;
  muted: boolean;
}

export interface EngineSummary extends CronJobResult {
  monitors: number;
  opened: number;
  recovered: number;
  settled: number;
  /** Confirmed DOWN while the site's incident is still open: no alert until D-004 (S04). */
  relapses: number;
  /** Blocked rounds handed to the browser verifier this run. */
  verifying: number;
  /** Blocked rounds the verifier couldn't decide: PROBLEM (unverified) (D-001). */
  unverified: number;
  /** Admin alerts opened this run (their emails are queued). */
  alerts: number;
}

/**
 * One engine run (PRD §10): for every primary monitor of an active site, load its recent check
 * results, site status and open incident, ask `decideMonitor`, and record the decision. Writes that
 * belong together go through the engine_* SQL functions (one transaction each); repeated runs are
 * harmless (one open incident per site, one message per incident).
 */
export async function runEngine(db: DbClient, now: Date = new Date()): Promise<EngineSummary> {
  const summary: EngineSummary = {
    ok: true,
    monitors: 0,
    opened: 0,
    recovered: 0,
    settled: 0,
    relapses: 0,
    verifying: 0,
    unverified: 0,
    alerts: 0,
  };
  const monitors = await loadMonitors(db, now);
  if (!monitors.length) return summary;
  summary.monitors = monitors.length;

  const since = new Date(
    now.getTime() - Math.max(...monitors.map((m) => lookbackMs(TIER_CONFIG[m.tier].intervalSec))),
  );
  const siteIds = monitors.map((m) => m.siteId);

  const monitorIds = monitors.map((m) => m.id);
  const [checks, statuses, incidents, locations, verifier] = await Promise.all([
    loadChecks(db, monitorIds, since),
    db.from('site_status').select('site_id, last_round_at, ok_rounds, note').in('site_id', siteIds),
    db
      .from('incidents')
      .select('id, site_id, state, severity, root_cause_category, notifications(template)')
      .in('site_id', siteIds)
      .not('state', 'in', OPEN_STATES_EXCLUDED),
    db.from('probe_locations').select('code, last_heartbeat_at').eq('is_active', true),
    loadVerifierState(db, monitorIds, since, now),
  ]);
  for (const r of [statuses, incidents, locations]) if (r.error) throw new Error(r.error.message);
  const active = (locations.data ?? [])
    .filter(
      (l) => !!l.last_heartbeat_at && now.getTime() - Date.parse(l.last_heartbeat_at) <= HEARTBEAT_FRESH_MS,
    )
    .map((l) => l.code as ProbeLocation);

  const unverifiedSites = new Set<string>();
  for (const m of monitors) {
    const status = statuses.data?.find((st) => st.site_id === m.siteId);
    const open = incidents.data?.find((inc) => inc.site_id === m.siteId);
    const snapshot: MonitorSnapshot = {
      checks: checks
        .filter((c) => c.monitor_id === m.id)
        .map((c): StoredCheck => ({
          location: c.location as ProbeLocation,
          outcome: c.outcome,
          checkedAt: new Date(c.checked_at),
          attempt: c.attempt === 2 ? 2 : 1,
          statusCode: c.status_code,
          error: c.error,
        })),
      now,
      intervalSec: TIER_CONFIG[m.tier].intervalSec,
      locations: active,
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
      verifications: verifier.jobs.get(m.id),
      verifierAvailable: verifier.available,
    };
    let note = status?.note ?? null;
    // RECOVERED only replies to a DOWN that was queued (not one held back by a mute, spec §15.1).
    const downQueued = !!open?.notifications.some((n) => n.template === 'down');

    // Judge rounds oldest first until one changes the incident or nothing is ready.
    for (let i = 0; i < MAX_ROUNDS_PER_RUN; i += 1) {
      const decision = decideMonitor(snapshot);
      if (decision.kind === 'wait') break;
      if (decision.kind === 'none' && decision.relapse) {
        summary.relapses += 1;
        console.warn(JSON.stringify({ event: 'relapse_not_alerted', site: m.siteId, incident: open?.id }));
      }
      const applied = await apply(db, m, decision, open?.id ?? null, now, downQueued);
      if (applied) summary[applied] += 1;
      if (decision.kind === 'verify') break;
      // A browser that was blocked too is the site's WAF, not the verifier: no Admin alert (D-020).
      if (decision.kind === 'unverified' && decision.reason !== 'browser_blocked')
        unverifiedSites.add(m.siteName);
      // The site note follows the latest judged round (OK + note, unverified, or none).
      const next = 'note' in decision ? (decision.note ?? null) : null;
      if (next !== note) {
        const noted = await db.rpc('engine_note_site', {
          p_site_id: m.siteId,
          p_round_at: decision.roundAt.toISOString(),
          // No note clears it.
          ...(next ? { p_note: next } : {}),
        });
        if (noted.error) throw new Error(`engine_note_site: ${noted.error.message}`);
        note = next;
      }
      const roundOnly = decision.kind === 'none' || (decision.kind === 'unverified' && !!open);
      if (!roundOnly) break;
      snapshot.lastRoundAt = decision.roundAt;
      snapshot.okRounds = 0;
      if (decision.kind === 'none') snapshot.okRounds = decision.okRounds;
    }
  }

  summary.alerts = await adminAlerts(db, verifier, unverifiedSites);
  return summary;
}

/**
 * Admin alerts about the verifier (D-001, D-019): unavailable while a blocked site waited (one
 * email per outage, listing the sites), and more than 5 jobs queued. A no-poll outage clears as
 * soon as the verifier polls again; any other clears when it completes a job (Job API).
 */
async function adminAlerts(
  db: DbClient,
  verifier: Awaited<ReturnType<typeof loadVerifierState>>,
  unverifiedSites: ReadonlySet<string>,
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

  const down = verifier.openAlerts.get('verifier_unavailable');
  if (unverifiedSites.size && !down) {
    await open('verifier_unavailable', {
      sites: [...unverifiedSites].sort(),
      reason: verifier.available ? 'not_picked_up' : 'no_poll',
    });
  } else if (down && down.reason === 'no_poll' && verifier.available && !unverifiedSites.size) {
    await clear('verifier_unavailable');
  }

  const behind = verifier.openAlerts.has('verifier_backlog');
  if (verifier.queued > BACKLOG_ALERT_OVER && !behind)
    await open('verifier_backlog', { queued: verifier.queued });
  else if (verifier.queued <= BACKLOG_ALERT_OVER && behind) await clear('verifier_backlog');
  return opened;
}

/** PostgREST returns at most max_rows (1000) rows per request: read the window page by page. */
export const CHECKS_PAGE = 1000;

async function loadChecks(db: DbClient, monitorIds: string[], since: Date) {
  const rows = [];
  for (let from = 0; ; from += CHECKS_PAGE) {
    const { data, error } = await db
      .from('check_results')
      .select('id, monitor_id, location, outcome, checked_at, attempt, status_code, error')
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

async function loadMonitors(db: DbClient, now: Date): Promise<MonitorRow[]> {
  const { data, error } = await db
    .from('monitors')
    .select('id, url, must_contain, timeout_ms, site_id, sites!inner(name, tier, is_active, muted_until)')
    .eq('is_primary', true)
    .eq('sites.is_active', true);
  if (error) throw new Error(`monitors: ${error.message}`);
  return data.map((m) => ({
    id: m.id,
    url: m.url,
    mustContain: m.must_contain,
    timeoutMs: m.timeout_ms,
    siteId: m.site_id,
    siteName: m.sites.name,
    tier: m.sites.tier as Tier,
    muted: !!m.sites.muted_until && new Date(m.sites.muted_until) > now,
  }));
}

async function apply(
  db: DbClient,
  m: MonitorRow,
  d: MonitorDecision,
  incidentId: string | null,
  now: Date,
  downQueued: boolean,
): Promise<'opened' | 'recovered' | 'settled' | 'verifying' | 'unverified' | null> {
  const at = now.toISOString();
  switch (d.kind) {
    case 'wait':
      return null;

    case 'verify': {
      // One job per monitor and round (unique index): a second engine run's insert is a no-op.
      const { error } = await db.from('verification_jobs').insert({
        kind: 'verify',
        monitor_id: m.id,
        site_id: m.siteId,
        round_at: d.roundAt.toISOString(),
        url: m.url,
        must_contain: m.mustContain,
      });
      if (error && error.code !== '23505') throw new Error(`verification_jobs: ${error.message}`);
      return error ? null : 'verifying';
    }

    case 'unverified': {
      if (incidentId) {
        // Already open: record the round; the incident keeps its own state and clock.
        const { error } = await db.rpc('engine_record_round', {
          p_site_id: m.siteId,
          p_round_at: d.roundAt.toISOString(),
          p_evaluated_at: at,
          p_ok_rounds: 0,
        });
        if (error) throw new Error(`engine_record_round: ${error.message}`);
        return 'unverified';
      }
      // PROBLEM (unverified) at once (D-001). Its Chat card comes with S04's PROBLEM rows (D-019).
      const { error } = await db.rpc('engine_open_incident', {
        p_site_id: m.siteId,
        p_monitor_id: m.id,
        p_trigger: 'blocked_unverified',
        p_severity: 'problem',
        p_started_at: d.startedAt.toISOString(),
        p_detected_at: at,
        p_round_at: d.roundAt.toISOString(),
        p_context: {
          cause: d.reason === 'browser_blocked' ? 'Blocked in the browser too' : 'Blocked, not verified',
          verifier: d.reason,
        },
        p_notify: false,
      });
      if (error) throw new Error(`engine_open_incident: ${error.message}`);
      return 'unverified';
    }

    case 'none': {
      // Never moves the round back when another engine run (probe trigger, cron) got further.
      const { error } = await db.rpc('engine_record_round', {
        p_site_id: m.siteId,
        p_round_at: d.roundAt.toISOString(),
        p_evaluated_at: at,
        p_ok_rounds: d.okRounds,
      });
      if (error) throw new Error(`engine_record_round: ${error.message}`);
      return null;
    }

    case 'open': {
      // A muted site still gets its incident; only the alert is held back (spec §11: mute is an overlay).
      const { data, error } = await db.rpc('engine_open_incident', {
        p_site_id: m.siteId,
        p_monitor_id: m.id,
        p_trigger: 'hard_fail',
        p_severity: 'down',
        p_started_at: d.startedAt.toISOString(),
        // When the last recheck confirmed it, not when this run noticed (PRD §9: alert within 30 s).
        p_detected_at: d.confirmedAt.toISOString(),
        p_round_at: d.roundAt.toISOString(),
        p_context: d.verifyJobId
          ? {
              cause: `Browser: page didn’t load${d.browserDetail ? ` (${d.browserDetail})` : ''}`,
              confirmingLocations: d.failing.length,
              verifyJobId: d.verifyJobId,
            }
          : {
              cause: formatCause(d.failing, m.timeoutMs),
              confirmingLocations: d.failing.length,
            },
        p_notify: !m.muted,
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
        p_context: { okLocations: d.okLocations },
        p_notify: !m.muted && downQueued,
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
      });
      if (error) throw new Error(`engine_settle_incident: ${error.message}`);
      return data ? 'settled' : null;
    }
  }
}
