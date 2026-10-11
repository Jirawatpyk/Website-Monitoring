import 'server-only';
import type { DbClient, Json } from '@dxt/db';
import {
  decideSite,
  problemHoldUntil,
  bkkControlFailing,
  faultyByMinute,
  lookbackMs,
  NEW_MONITOR,
  UNKNOWN_ROOT_CAUSE,
  type DownFacts,
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
  formatKeyPage,
  formatProblemCause,
  formatProblemSummary,
  type ProblemCauseContext,
} from '@dxt/notifier';
import {
  TIER_CONFIG,
  type ProbeLocation,
  type ProblemDetail,
  type ResponseHours,
  type Tier,
  type Trigger,
  type WafVendor,
  CLOSED_INCIDENT_STATES_IN,
} from '@dxt/shared';
import type { CronJobResult } from '../cron-job';
import { HTTP_MONITOR_TYPES } from '../probe/due-monitors';
import { loadResponseHours } from '../escalation/response-hours';
import { escalationTick } from './ladder';
import { endedBefore, inWindow, loadWindows, type SiteWindows } from './windows';
import { BACKLOG_ALERT_OVER, loadVerifierState } from './verifier-state';

/** Rounds judged per site per run: catches up after a missed run without running unbounded. */
const MAX_ROUNDS_PER_RUN = 5;
/** Messages that told someone the site failed: RECOVERED replies only to these (spec §15.1). */
const ALERT_TEMPLATES = ['down', 'problem', 'down_again', 'problem_again'];
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
  /** Flagged behind a WAF: WAF-signed blocks sit the round out (D-027). */
  behindWaf: boolean;
  monitors: MonitorRow[];
  /** Its maintenance windows that ran in the last day or are running (D-036). */
  windows?: SiteWindows;
  /** Its status was Maintenance at the last round: the first round after a window puts it back. */
  wasMaintenance?: boolean;
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
  /** New drops that joined a recovered incident (D-004): DOWN AGAIN / PROBLEM AGAIN queued. */
  relapses: number;
  /** Blocked rounds handed to the browser verifier this run (one per monitor). */
  verifying: number;
  /** Monitors the verifier couldn't decide this run: PROBLEM (unverified) (D-001). */
  unverified: number;
  /** Admin alerts opened this run (their emails are queued). */
  alerts: number;
  /** Open PROBLEM incidents raised to DOWN (D-021); their DOWN alerts are queued. */
  escalated: number;
  /** Incident changes this run that queued messages (any kind but `settled`): deliver them now. */
  notified: number;
  /** Sites whose write failed this run (the rest were judged); the run reports `ok: false`. */
  failures?: string[];
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
    notified: 0,
    verifying: 0,
    unverified: 0,
    alerts: 0,
    escalated: 0,
  };
  // First, before the sites are read: windows that started or ended are logged, and a mute that ran out leaves the site row (D-036).
  // Never holds the run back: the log and the site row's expiry catch up next run.
  const logged = await db.rpc('engine_log_windows', { p_now: now.toISOString() });
  if (logged.error)
    console.error(JSON.stringify({ event: 'engine_log_windows_failed', error: logged.error.message }));
  const [sites, locations, hours] = await Promise.all([
    loadSites(db, now),
    loadLocations(db, now),
    loadResponseHours(db, now),
  ]);
  if (!sites.length) {
    // Nothing to judge, but an open Admin alert still clears / a backlog is still seen.
    const verifier = await loadVerifierState(db, now, now);
    summary.alerts = await adminAlerts(db, now, verifier, new Map(), locations, {
      failing: null,
      sites: new Set(),
    });
    return summary;
  }
  const monitors = sites.flatMap((s) => s.monitors);
  summary.sites = sites.length;
  summary.monitors = monitors.length;

  const since = new Date(
    now.getTime() - Math.max(...sites.map((s) => lookbackMs(TIER_CONFIG[s.tier].intervalSec))),
  );
  const siteIds = sites.map((s) => s.id);
  const windows = await loadWindows(db, siteIds, now);
  for (const s of sites) s.windows = windows.get(s.id);
  const [checks, statuses, carries, incidents, verifier] = await Promise.all([
    loadChecks(db, since),
    db
      .from('site_status')
      .select('site_id, status, last_round_at, ok_rounds, note, flips, flip_ok')
      .in('site_id', siteIds),
    // Server-side reads (S04b): no monitor ids in a GET query string (8 KB limit at 200 monitors).
    db.rpc('engine_monitor_status'),
    db
      .from('incidents')
      .select(
        'id, site_id, monitor_id, state, severity, episode_severity, started_at, detected_at, acked_at, recovered_at, escalation_level, is_flapping, root_cause_category, notifications(template)',
      )
      .in('site_id', siteIds)
      .not('state', 'in', CLOSED_INCIDENT_STATES_IN),
    loadVerifierState(db, since, now),
  ]);
  for (const r of [statuses, carries, incidents]) if (r.error) throw new Error(r.error.message);

  const checksByMonitor = new Map<string, typeof checks>();
  for (const c of checks)
    (checksByMonitor.get(c.monitor_id) ?? checksByMonitor.set(c.monitor_id, []).get(c.monitor_id)!).push(c);
  const carryByMonitor = new Map((carries.data ?? []).map((c) => [c.monitor_id, c]));

  // A location that failed most monitors in a minute is no data for that minute (spec §15.3).
  const siteOfPrimary = new Map(sites.map((s) => [s.monitors.find((m) => m.isPrimary)!.id, s.id]));
  const faulty = faultyByMinute(
    checks
      .filter((c) => c.attempt !== 2 && siteOfPrimary.has(c.monitor_id))
      .map((c) => ({
        siteId: siteOfPrimary.get(c.monitor_id)!,
        location: c.location as ProbeLocation,
        outcome: c.outcome,
        error: c.error,
        checkedAt: new Date(c.checked_at),
      })),
  );

  /** Sites the verifier couldn't decide this run, with the reason it saw (D-019). */
  const unverifiedSites = new Map<string, string>();
  /** Sites left unverified by the BKK probe's failed control check (D-027, D-028). */
  const controlSites = new Set<string>();
  /** A site whose write failed: logged, the rest still judged, the run reported failed at the end. */
  const failures: string[] = [];
  const unverifiedMonitors = new Set<string>();
  for (const site of sites) {
    try {
      await judgeSite(site);
    } catch (err) {
      failures.push(`${site.name}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(JSON.stringify({ event: 'engine_site_failed', site: site.id, error: String(err) }));
    }
  }

  summary.unverified = unverifiedMonitors.size;
  // D-028: the BKK probe's control check (D-027) over the window's Bangkok checks.
  const control = bkkControlFailing(
    checks
      .filter((c) => c.location === 'BKK')
      // Either VPS check failing counts: both control URLs, or the Akamai control (D-027 rule 2b) —
      // a broken Akamai control would otherwise silently turn every Akamai DOWN into a PROBLEM.
      .map((c) => ({
        checkedAt: new Date(c.checked_at),
        controlOk: c.control_ok === false || c.akamai_ok === false ? false : (c.control_ok ?? c.akamai_ok),
      })),
  );
  // An incident a mute silenced gets its first alert once the mute is over (D-036), before the ladder,
  // which then counts from that alert.
  try {
    summary.notified += await lateAlerts(db, now, hours);
  } catch (err) {
    failures.push(`late alerts: ${err instanceof Error ? err.message : String(err)}`);
    console.error(JSON.stringify({ event: 'engine_late_alerts_failed', error: String(err) }));
  }
  // The escalation ladder (S08, D-034): after the sites, so an incident opened or acknowledged this
  // run is seen as it is now.
  try {
    const ladder = await escalationTick(db, now, hours);
    summary.notified += ladder.queued;
    for (const f of ladder.failed) failures.push(`escalation ${f}`);
  } catch (err) {
    failures.push(`escalation: ${err instanceof Error ? err.message : String(err)}`);
    console.error(JSON.stringify({ event: 'engine_escalation_failed', error: String(err) }));
  }
  summary.alerts = await adminAlerts(db, now, verifier, unverifiedSites, locations, {
    failing: control,
    sites: controlSites,
  });
  // `ok: false` fails the Healthchecks ping (cron-job.ts), while what the other sites queued is
  // still sent at once (engine-and-deliver.ts reads the counts).
  if (failures.length) return { ...summary, ok: false, failures };
  return summary;

  async function judgeSite(site: SiteRow): Promise<void> {
    const status = statuses.data?.find((st) => st.site_id === site.id);
    // Two reads, and engine runs overlap: a carry older than the site's round was read before another
    // run committed that round. Judge the site next run, from a consistent pair (engine review M2).
    const siteRound = status?.last_round_at ? Date.parse(status.last_round_at) : null;
    const intervalMs = TIER_CONFIG[site.tier].intervalSec * 1000;
    const skew = site.monitors.some((m) => {
      const c = carryByMonitor.get(m.id);
      if (!c || siteRound === null) return false;
      const gap = Date.parse(c.last_round_at) - siteRound;
      // Ahead, or a round or two behind: read mid-commit of another run. Further behind: a stale
      // row (the monitor was off or moved) — dropped below, never a reason to skip forever.
      return gap > 0 || (gap < 0 && -gap <= 2 * intervalMs);
    });
    if (skew) return;
    for (const m of site.monitors) {
      const c = carryByMonitor.get(m.id);
      if (c && siteRound !== null && Date.parse(c.last_round_at) < siteRound) carryByMonitor.delete(m.id);
    }
    const open = incidents.data?.find((inc) => inc.site_id === site.id);
    site.wasMaintenance = status?.status === 'maintenance';
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
            episodeSeverity: open.episode_severity,
            acked: !!open.acked_at,
            startedAt: new Date(open.started_at),
            detectedAt: new Date(open.detected_at),
            isFlapping: open.is_flapping,
          } satisfies OpenIncident)
        : null,
      // OK ↔ not-OK changes at incident steps (D-024): the 3rd in 30 min tags flapping.
      flips: (status?.flips ?? []).map((f) => new Date(f)),
      flipOk: status?.flip_ok ?? null,
      monitors: site.monitors.map((m): SiteMonitor => ({
        id: m.id,
        isPrimary: m.isPrimary,
        url: m.url,
        slowThresholdMs: m.slowThresholdMs,
        allowedRedirectDomains: m.allowedRedirectDomains,
        checks: (checksByMonitor.get(m.id) ?? []).map(toStoredCheck),
        carry: carryOf(carryByMonitor.get(m.id)),
        ...(verifier.jobs.get(m.id) ? { verifications: verifier.jobs.get(m.id)! } : {}),
      })),
      verifierAvailable: verifier.available,
      behindWaf: site.behindWaf,
      faulty,
    };
    let note = status?.note ?? null;
    // RECOVERED only replies to an alert that was queued (not one held back by a mute, spec §15.1).
    const alertQueued = !!open?.notifications.some((n) => ALERT_TEMPLATES.includes(n.template));

    // Judge rounds oldest first until one changes the incident or nothing is ready.
    for (let i = 0; i < MAX_ROUNDS_PER_RUN; i += 1) {
      const decision = decideSite(snapshot);
      if (decision.kind === 'wait') break;
      if (decision.kind === 'verify') {
        summary.verifying += await queueVerifyJobs(db, site, decision.monitorIds, decision.roundAt);
        break;
      }
      for (const u of decision.unverified) {
        unverifiedMonitors.add(u.monitorId);
        // Judged without it: a late verdict mustn't land on this round or clear the alert.
        if (u.reason === 'not_picked_up') await expireUnpicked(db, u.monitorId, decision.roundAt);
        // A browser that was blocked too is the site's WAF, not the verifier: no Admin alert (D-020).
        // The browser blocked too (D-020) or the VPS's control check down (D-027): not the verifier's fault.
        // Inside a maintenance window with nothing open, no Admin alert either (engine review L2).
        if (!open && inWindow(site.windows, decision.roundAt)) continue;
        if (u.reason === 'control_failed') controlSites.add(`${site.name} (Tier ${site.tier})`);
        else if (u.reason !== 'browser_blocked')
          unverifiedSites.set(`${site.name} (Tier ${site.tier})`, u.reason);
      }
      const applied = await apply(
        db,
        site,
        decision,
        open
          ? {
              id: open.id,
              state: open.state,
              monitorId: open.monitor_id,
              recoveredAt: open.recovered_at,
              isFlapping: open.is_flapping,
            }
          : null,
        now,
        alertQueued,
        locations.length,
        hours,
        () => {
          summary.relapses += 1;
          summary.notified += 1;
        },
      );
      if (applied) summary[applied] += 1;
      if (applied && applied !== 'settled') summary.notified += 1;
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
  waf: c.waf as WafVendor | null,
  controlOk: c.control_ok,
  akamaiOk: c.akamai_ok,
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
  /**
   * D-028: `bkkControlFailing` (true = failing, false = passing, null = no evidence: leave it) and
   * the sites it left unverified this run.
   */
  control: { failing: boolean | null; sites: ReadonlySet<string> },
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

  // Stuck jobs only (`queued` counts jobs waiting > 30 s), and cleared no sooner than 10 min after it
  // opened like the other kinds — so a burst can't open and clear it within seconds.
  const behind = verifier.openAlerts.get('verifier_backlog');
  if (verifier.queued > BACKLOG_ALERT_OVER && !behind)
    await open('verifier_backlog', { queued: verifier.queued });
  else if (verifier.queued <= BACKLOG_ALERT_OVER && behind && settled(behind))
    await clear('verifier_backlog');

  // PRD §5: fewer than 2 locations → statuses stay as they are and the Admin is told (D-022).
  const low = verifier.openAlerts.get('probe_locations_low');
  if (locations.length < 2 && !low) await open('probe_locations_low', { active: [...locations].sort() });
  else if (locations.length >= 2 && low && settled(low)) await clear('probe_locations_low');

  // D-028: the BKK VPS's own network failing its control check — the Admin's to fix. The sites it
  // leaves unverified (D-027) are listed; cleared once it passes again, no sooner than 10 min.
  const net = verifier.openAlerts.get('bkk_control_failing');
  if (control.failing === true && !net)
    await open('bkk_control_failing', { sites: [...control.sites].sort() });
  else if (control.failing === false && net && settled(net)) await clear('bkk_control_failing');
  return opened;
}

/** PostgREST returns at most max_rows (1000) rows per request: read the window page by page. */
export const CHECKS_PAGE = 1000;

async function loadChecks(db: DbClient, since: Date) {
  const rows = [];
  // Keyset paging on (checked_at, id), newest first: a row arriving while we page can't shift
  // another onto the next page, so nothing is read twice or skipped.
  let after: { checked_at: string; id: string } | undefined;
  for (;;) {
    const { data, error } = await db.rpc('engine_checks', {
      p_since: since.toISOString(),
      p_limit: CHECKS_PAGE,
      ...(after && { p_after_checked_at: after.checked_at, p_after_id: after.id }),
    });
    if (error) throw new Error(`engine_checks: ${error.message}`);
    rows.push(...data);
    const last = data.at(-1);
    // Stop on an empty page, not a short one: a hosted max_rows under CHECKS_PAGE would otherwise
    // end the read after its first page without an error (db-reviewer).
    if (!last) return rows;
    // A cursor that doesn't move would loop forever: stop (the rows are already in).
    if (after && last.checked_at === after.checked_at && last.id === after.id) return rows;
    after = { checked_at: last.checked_at, id: last.id };
  }
}

/** Every monitor of every active site, grouped by site, the primary first. */
async function loadSites(db: DbClient, now: Date): Promise<SiteRow[]> {
  const { data, error } = await db
    .from('monitors')
    .select(
      'id, url, is_primary, must_contain, timeout_ms, thresholds, allowed_redirect_domains, site_id, sites!inner(name, tier, is_active, muted_until, behind_waf)',
    )
    .eq('sites.is_active', true)
    // A monitor switched off or removed (S05, D-025) no longer counts towards the site.
    .eq('enabled', true)
    .is('removed_at', null)
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
      behindWaf: m.sites.behind_waf,
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
  open: {
    id: string;
    state: string;
    monitorId: string | null;
    /** The last recovery: "was back for 5 min (03:19–03:24)" on DOWN AGAIN. */
    recoveredAt: string | null;
    isFlapping: boolean;
  } | null,
  now: Date,
  alertQueued: boolean,
  /** Locations voting this run: the card's "3 of 3 locations". */
  reporting: number,
  /** Tier 2–3 response hours: a PROBLEM outside them waits for the next opening (spec §7, D-034). */
  hours: ResponseHours,
  /** Counts the PROBLEM AGAIN a D-023 recovery queues in the same round. */
  relapsed: () => void = () => {},
): Promise<'opened' | 'problems' | 'recovered' | 'settled' | 'escalated' | 'relapses' | null> {
  const at = now.toISOString();
  const incidentId = open?.id ?? null;
  // Inside a maintenance window with nothing open (D-036): the round is recorded, nothing opens and
  // the site shows Maintenance; the monitors keep their real state. An incident already open when the
  // window started carries on as usual (a window never hides an open incident, §14.5).
  // Judged by when the failure was confirmed (a DOWN's last recheck), not by when this run happens.
  const decidedAt = d.kind === 'open' ? d.confirmedAt : d.roundAt;
  if (
    !open &&
    inWindow(site.windows, decidedAt) &&
    (d.kind === 'none' || d.kind === 'open' || d.kind === 'problem')
  ) {
    const { error } = await db.rpc('engine_record_round', {
      p_site_id: site.id,
      p_round_at: d.roundAt.toISOString(),
      p_evaluated_at: at,
      p_ok_rounds: d.kind === 'none' ? d.okRounds : 0,
      p_monitors: monitorsJson(d, site),
      p_status: 'maintenance',
    });
    if (error) throw new Error(`engine_record_round: ${error.message}`);
    return null;
  }
  // Still failing when a window ended: the incident starts at the window's end, never backdated into
  // it — and never after its own confirmation (the window ended before `decidedAt`).
  const notBefore = endedBefore(site.windows, decidedAt);
  const startOf = (startedAt: Date) =>
    (notBefore && notBefore > startedAt ? notBefore : startedAt).toISOString();
  // The first round after a window that can't judge the status (too few locations) still ends
  // "Maintenance" (engine review L1).
  const status =
    d.status ??
    (site.wasMaintenance ? (d.monitors.some((m) => m.status === 'problem') ? 'problem' : 'ok') : undefined);
  const judged = { p_monitors: monitorsJson(d, site), ...(status ? { p_status: status } : {}) };
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
        p_started_at: startOf(d.startedAt),
        p_detected_at: at,
        p_round_at: d.roundAt.toISOString(),
        p_context: {
          cause: formatProblemCause(d.detail, ctx),
          summary: formatProblemSummary(d.detail, ctx),
          detail: d.detail as unknown as Json,
          monitorUrl: ctx.monitorUrl,
          // "3 of 3 locations" on the card: the locations voting when it opened.
          reporting,
          // A key page's parts, for the replies that name it (auto-resolved RECOVERED, §19.6).
          ...keyPageContext(d.detail, ctx),
          ...(d.detail.kind === 'blocked' ? { verifier: d.detail.reason } : {}),
        },
        p_notify: !site.muted,
        ...holdFor(site.tier, now, hours),
        ...judged,
      });
      if (error) throw new Error(`engine_open_incident: ${error.message}`);
      return data ? 'problems' : null;
    }

    case 'escalate': {
      if (!incidentId) return null;
      const { data, error } = await db.rpc('engine_escalate_incident', {
        p_incident_id: incidentId,
        p_flapping: d.flapping,
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

    case 'relapse': {
      if (!incidentId) return null;
      // DOWN AGAIN / PROBLEM AGAIN in the incident's thread, Chat only (D-004, D-024). One
      // state-guarded function: an overlapping run gets false and queues nothing.
      const ctx = causeContext(site, d.monitorId);
      const problem = d.detail
        ? {
            cause: formatProblemCause(d.detail, ctx),
            summary: formatProblemSummary(d.detail, ctx),
            detail: d.detail as unknown as Json,
            monitorUrl: ctx.monitorUrl,
            ...keyPageContext(d.detail, ctx),
          }
        : {};
      const { data, error } = await db.rpc('engine_relapse_incident', {
        p_incident_id: incidentId,
        p_severity: d.severity,
        p_trigger: d.trigger,
        p_started_at: d.startedAt.toISOString(),
        p_detected_at: d.detectedAt.toISOString(),
        p_round_at: d.roundAt.toISOString(),
        p_context: {
          ...(d.down ? downContext({ ...d.down, monitorId: d.monitorId }, site) : problem),
          startedAt: d.startedAt.toISOString(),
          trigger: d.trigger,
          ...(open ? { fromState: open.state } : {}),
          ...(open?.recoveredAt ? { backSince: open.recoveredAt } : {}),
          // The reply says "Now flapping …" only on the drop that tags it (ChatAlert 03:24).
          ...(d.flapping && !open?.isFlapping ? { nowFlapping: true } : {}),
          // "Still flapping" only while it is (≥ 3 changes in 30 min), not for a drop hours later.
          ...(d.flapping ? { flapping: true } : {}),
        },
        p_flapping: d.flapping,
        // A thread whose first alert a mute held back gets that alert (the late card) instead of a
        // DOWN AGAIN out of context (engine review M2): lateAlerts runs after the sites.
        p_notify: !site.muted && alertQueued,
        ...(d.severity === 'problem' ? holdFor(site.tier, d.detectedAt, hours) : {}),
        ...judged,
      });
      if (error) throw new Error(`engine_relapse_incident: ${error.message}`);
      return data ? 'relapses' : null;
    }

    case 'open': {
      const { data, error } = await db.rpc('engine_open_incident', {
        p_site_id: site.id,
        p_monitor_id: d.monitorId,
        p_trigger: 'hard_fail',
        p_severity: 'down',
        p_started_at: startOf(d.startedAt),
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
          // The reply renders from its own facts: a relapse may clear the incident's before it goes.
          recoveredAt: d.recoveredAt.toISOString(),
          ...(d.autoResolve ? { autoResolved: true } : {}),
        },
        // A mute stops new alerts only (§15.1, D-036): RECOVERED still closes a thread that alerted.
        p_notify: alertQueued,
        // Not-OK → OK only when every monitor is OK: D-023's partial recovery is no flip (D-024).
        p_flip_ok: d.allOk,
        p_auto_resolve: d.autoResolve,
        // Flapping: one summary 15 min after the recovery instead of RECOVERED (spec §19.4).
        p_hold_summary: d.holdSummary,
        ...judged,
      });
      if (error) throw new Error(`engine_recover_incident: ${error.message}`);
      if (data && d.then) {
        // D-023: the home page is back but a key page still fails — PROBLEM AGAIN right after the
        // RECOVERED, from the same round (spec §19.7). Not a flip: the site never was fully OK.
        const ctx = causeContext(site, d.then.monitorId);
        const again = await db.rpc('engine_relapse_incident', {
          p_incident_id: incidentId,
          p_severity: 'problem',
          p_trigger: d.then.trigger,
          p_started_at: d.then.startedAt.toISOString(),
          // At the recovery itself, so the timeline reads RECOVERED then PROBLEM AGAIN (engine review M1).
          p_detected_at: d.recoveredAt.toISOString(),
          p_round_at: d.roundAt.toISOString(),
          p_context: {
            cause: formatProblemCause(d.then.detail, ctx),
            summary: formatProblemSummary(d.then.detail, ctx),
            detail: d.then.detail as unknown as Json,
            monitorUrl: ctx.monitorUrl,
            ...keyPageContext(d.then.detail, ctx),
            startedAt: d.then.startedAt.toISOString(),
            trigger: d.then.trigger,
            homeBackAt: d.recoveredAt.toISOString(),
          },
          p_flapping: false,
          ...holdFor(site.tier, d.recoveredAt, hours),
          // With its RECOVERED or not at all: a muted alert gets no reply out of context (engine review L3).
          p_notify: !site.muted && alertQueued,
          ...judged,
        });
        if (again.error) throw new Error(`engine_relapse_incident: ${again.error.message}`);
        if (again.data) relapsed();
      }
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

/** "/booking", "HTTP 404", "/booking → HTTP 404 (…)" for a key page's PROBLEM; nothing for the home page. */
function keyPageContext(detail: ProblemDetail, ctx: ProblemCauseContext): Record<string, Json> {
  const k = formatKeyPage(detail, ctx);
  return k ? { keyPage: k } : {};
}

/** The DOWN alert's facts: the confirming checks, or the browser's verdict (blocked → page failed). */
function downContext(d: DownFacts, site: SiteRow): Record<string, Json> {
  const timeoutMs = site.monitors.find((m) => m.id === d.monitorId)?.timeoutMs ?? 30_000;
  return d.verifyJobId
    ? {
        cause: `Browser: page didn’t load${d.browserDetail ? ` (${d.browserDetail})` : ''}`,
        confirmingLocations: d.failing.length,
        verifyJobId: d.verifyJobId,
      }
    : {
        cause: formatCause(d.failing, timeoutMs),
        confirmingLocations: d.failing.length,
        // D-027: behind a WAF, who confirmed it and who the WAF blocked ("BKK only, 2 checks — …").
        ...(d.wafBlocked?.length
          ? { confirmingFrom: d.failing.map((c) => c.location), wafBlocked: [...d.wafBlocked] }
          : {}),
      };
}

/**
 * The first alert of every open incident a mute silenced, once the mute is over (D-036): the card for
 * its severity and the owner email; a Tier 2–3 PROBLEM outside response hours waits for the opening.
 * Guarded in SQL (once, still waiting for an ack, not muted). Returns how many were queued.
 */
async function lateAlerts(db: DbClient, now: Date, hours: ResponseHours): Promise<number> {
  const { data, error } = await db.rpc('engine_silent_incidents', { p_now: now.toISOString() });
  if (error) throw new Error(`engine_silent_incidents: ${error.message}`);
  let queued = 0;
  for (const inc of data ?? []) {
    const posted = await db.rpc('engine_post_late_alert', {
      p_incident_id: inc.incident_id,
      p_at: now.toISOString(),
      ...(inc.severity === 'problem' ? holdFor(inc.tier as Tier, now, hours) : {}),
    });
    if (posted.error) throw new Error(`engine_post_late_alert: ${posted.error.message}`);
    if (posted.data) queued += 1;
  }
  return queued;
}

/** A Tier 2–3 PROBLEM flagged outside response hours waits for the next opening (spec §7, §19.2). */
function holdFor(tier: Tier, at: Date, hours: ResponseHours): { p_hold_until?: string } {
  const until = problemHoldUntil(tier, at, hours);
  return until ? { p_hold_until: until.toISOString() } : {};
}
