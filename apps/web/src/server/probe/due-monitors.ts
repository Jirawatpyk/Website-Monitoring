import 'server-only';
import type { DbClient } from '@dxt/db';
import {
  isTimeoutError,
  TIER_CONFIG,
  toMonitorHeaders,
  type MonitorHeader,
  type ProbeLocation,
  type Tier,
} from '@dxt/shared';

/** A response slower than 30 s is a failure (PRD §5); longer monitor timeouts are capped here. */
export const MAX_CHECK_TIMEOUT_MS = 30_000;

/** What a probe needs to check one monitor — the same for SIN / TYO (cron) and BKK (VPS, Ingest API). */
export interface DueMonitor {
  id: string;
  url: string;
  method: 'GET' | 'HEAD';
  timeoutMs: number;
  mustContain: string[];
  mustNotContain: string[];
  /** Custom request headers (S05, D-025). */
  headers: MonitorHeader[];
  /** D-051: a confirm check of a Tier 2–3 timeout round — stored (with its recheck) as `confirm`. */
  confirm?: true;
}

/** Monitor types the HTTP probes check (`keyword` is an HTTP check with keywords). */
export const HTTP_MONITOR_TYPES = ['http', 'keyword'] as const;

/** Tier 1 every minute, Tier 2 every 3, Tier 3 every 5 (PRD §2), on the UTC minute. */
export function isDue(tier: Tier, at: Date): boolean {
  const everyMin = TIER_CONFIG[tier].intervalSec / 60;
  return Math.floor(at.getTime() / 60_000) % everyMin === 0;
}

/** Who is asking, for D-051's confirm checks; without it nobody gets one (an agent that didn't ask). */
export interface ConfirmAsk {
  location: ProbeLocation;
}

/**
 * Every monitor of an active site that is due at `at` — the primary and its key pages (S04a: a key
 * page can only raise a PROBLEM, D-022) — timeouts capped at 30 s. With `ask`, also the D-051 confirm
 * checks this location still owes (`confirmsDue`).
 */
export async function loadDueMonitors(db: DbClient, at: Date, ask?: ConfirmAsk): Promise<DueMonitor[]> {
  const { data, error } = await db
    .from('monitors')
    .select(
      'id, url, method, timeout_ms, must_contain, must_not_contain, headers, is_primary, sites!inner(tier, is_active)',
    )
    .eq('sites.is_active', true)
    // A monitor switched off or removed (S05, D-025) isn't checked.
    .eq('enabled', true)
    .is('removed_at', null)
    // HTTP page monitors only: SSL / domain (S13) and browser (S23) monitors are checked their own way.
    .in('type', HTTP_MONITOR_TYPES);
  if (error) throw new Error(`monitors: ${error.message}`);
  const due = data.filter((m) => isDue(m.sites.tier as Tier, at)).map(toDue);
  if (!ask) return due;
  // Only a Tier 2–3 home page between its ticks can owe a confirm (Tier 1's next round is a minute away).
  const between = data.filter(
    (m) =>
      m.is_primary && TIER_CONFIG[m.sites.tier as Tier].intervalSec > 60 && !isDue(m.sites.tier as Tier, at),
  );
  if (!between.length) return due;
  const owed = await confirmsDue(
    db,
    between.map((m) => ({ id: m.id, tier: m.sites.tier as Tier })),
    at,
    ask.location,
  );
  return [
    ...due,
    ...between.filter((m) => owed.has(m.id)).map((m) => ({ ...toDue(m), confirm: true as const })),
  ];
}

type MonitorRow = {
  id: string;
  url: string;
  method: string;
  timeout_ms: number;
  must_contain: string[];
  must_not_contain: string[];
  headers: unknown;
};

function toDue(m: MonitorRow): DueMonitor {
  return {
    id: m.id,
    url: m.url,
    method: m.method === 'HEAD' ? 'HEAD' : 'GET',
    timeoutMs: Math.min(m.timeout_ms, MAX_CHECK_TIMEOUT_MS),
    mustContain: m.must_contain,
    mustNotContain: m.must_not_contain,
    headers: toMonitorHeaders(m.headers),
  };
}

/**
 * D-051: the home pages whose round so far has scheduled checks that timed out at 2+ locations and no
 * confirm check from `location` yet — each location runs its own, so one that sees the others' timeouts
 * only a minute later still confirms at its next tick. One read of the current buckets' timeouts and
 * confirms (normally none), with no monitor ids in the query string.
 */
async function confirmsDue(
  db: DbClient,
  monitors: readonly { id: string; tier: Tier }[],
  at: Date,
  location: ProbeLocation,
): Promise<Set<string>> {
  const bucketOf = (tier: Tier) => {
    const ms = TIER_CONFIG[tier].intervalSec * 1000;
    return Math.floor(at.getTime() / ms) * ms;
  };
  const since = Math.min(...monitors.map((m) => bucketOf(m.tier)));
  const { data, error } = await db
    .from('check_results')
    .select('monitor_id, location, checked_at, error, confirm')
    .gte('checked_at', new Date(since).toISOString())
    .eq('attempt', 1)
    .or('error.eq.Timeout,confirm.is.true');
  if (error) throw new Error(`check_results: ${error.message}`);
  const owed = new Set<string>();
  for (const m of monitors) {
    const start = bucketOf(m.tier);
    const rows = data.filter((r) => r.monitor_id === m.id && Date.parse(r.checked_at) >= start);
    const timedOut = new Set(
      rows.filter((r) => !r.confirm && isTimeoutError(r.error)).map((r) => r.location),
    );
    const confirmedHere = rows.some((r) => r.confirm && r.location === location);
    if (timedOut.size >= 2 && !confirmedHere) owed.add(m.id);
  }
  return owed;
}
