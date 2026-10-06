import 'server-only';
import type { DbClient } from '@dxt/db';
import {
  decideMonitor,
  RECHECK_WITHIN_MS,
  ROUND_DEADLINE_MS,
  UNKNOWN_ROOT_CAUSE,
  type MonitorDecision,
  type OpenIncident,
  type StoredCheck,
} from '@dxt/engine';
import { formatCause } from '@dxt/notifier';
import { TIER_CONFIG, type ProbeLocation, type Tier } from '@dxt/shared';
import type { CronJobResult } from '../cron-job';

/** History loaded beyond one interval: the round still waiting for its deadline, its rechecks, slack. */
const LOOKBACK_EXTRA_MS = ROUND_DEADLINE_MS + RECHECK_WITHIN_MS + 30_000;
const OPEN_STATES_EXCLUDED = '("resolved","in_review","closed")';

interface MonitorRow {
  id: string;
  timeoutMs: number;
  siteId: string;
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
}

/**
 * One engine run (PRD §10): for every primary monitor of an active site, load its recent check
 * results, site status and open incident, ask `decideMonitor`, and record the decision. Writes that
 * belong together go through the engine_* SQL functions (one transaction each); repeated runs are
 * harmless (one open incident per site, one message per incident).
 */
export async function runEngine(db: DbClient, now: Date = new Date()): Promise<EngineSummary> {
  const summary: EngineSummary = { ok: true, monitors: 0, opened: 0, recovered: 0, settled: 0, relapses: 0 };
  const monitors = await loadMonitors(db, now);
  if (!monitors.length) return summary;
  summary.monitors = monitors.length;

  const longestInterval = Math.max(...monitors.map((m) => TIER_CONFIG[m.tier].intervalSec));
  const since = new Date(now.getTime() - longestInterval * 1000 - LOOKBACK_EXTRA_MS);
  const siteIds = monitors.map((m) => m.siteId);

  const [checks, statuses, incidents, locations] = await Promise.all([
    loadChecks(
      db,
      monitors.map((m) => m.id),
      since,
    ),
    db.from('site_status').select('site_id, last_round_at, ok_rounds').in('site_id', siteIds),
    db
      .from('incidents')
      .select('id, site_id, state, severity, root_cause_category')
      .in('site_id', siteIds)
      .not('state', 'in', OPEN_STATES_EXCLUDED),
    db.from('probe_locations').select('code').eq('is_active', true),
  ]);
  for (const r of [statuses, incidents, locations]) if (r.error) throw new Error(r.error.message);
  const active = (locations.data ?? []).map((l) => l.code as ProbeLocation);

  for (const m of monitors) {
    const status = statuses.data?.find((s) => s.site_id === m.siteId);
    const open = incidents.data?.find((i) => i.site_id === m.siteId);
    const decision = decideMonitor({
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
    });
    if (decision.kind === 'none' && decision.relapse) {
      summary.relapses += 1;
      console.warn(JSON.stringify({ event: 'relapse_not_alerted', site: m.siteId, incident: open?.id }));
    }
    const applied = await apply(db, m, decision, open?.id ?? null, now);
    if (applied) summary[applied] += 1;
  }
  return summary;
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
    .select('id, timeout_ms, site_id, sites!inner(tier, is_active, muted_until)')
    .eq('is_primary', true)
    .eq('sites.is_active', true);
  if (error) throw new Error(`monitors: ${error.message}`);
  return data.map((m) => ({
    id: m.id,
    timeoutMs: m.timeout_ms,
    siteId: m.site_id,
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
): Promise<'opened' | 'recovered' | 'settled' | null> {
  const at = now.toISOString();
  switch (d.kind) {
    case 'wait':
      return null;

    case 'none': {
      const { error } = await db.from('site_status').upsert(
        {
          site_id: m.siteId,
          last_round_at: d.roundAt.toISOString(),
          last_evaluated_at: at,
          ok_rounds: d.okRounds,
        },
        { onConflict: 'site_id' },
      );
      if (error) throw new Error(`site_status: ${error.message}`);
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
        p_detected_at: at,
        p_round_at: d.roundAt.toISOString(),
        p_context: {
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
        p_notify: !m.muted,
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
