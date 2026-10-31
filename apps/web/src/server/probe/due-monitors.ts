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

/** Monitor ids per read: 50 uuids keep the query string near 2 KB (the gateway's limit is 8 KB, S04b). */
const IDS_PER_READ = 50;

/**
 * D-051: the home pages whose round so far has scheduled checks that timed out at 2+ locations and no
 * confirm check from `location` yet — each location runs its own, so one that sees the others' timeouts
 * only a minute later still confirms at its next tick. Not when the round before timed out at 2+ too:
 * that round already is D-049's second round, so a confirm can't change the verdict (an outage would
 * otherwise get one every round). Monitor-first reads of this round and the one before, on
 * `check_results_monitor_idx` (db-reviewer), normally empty.
 */
async function confirmsDue(
  db: DbClient,
  monitors: readonly { id: string; tier: Tier }[],
  at: Date,
  location: ProbeLocation,
): Promise<Set<string>> {
  const intervalOf = (tier: Tier) => TIER_CONFIG[tier].intervalSec * 1000;
  const bucketOf = (tier: Tier) => Math.floor(at.getTime() / intervalOf(tier)) * intervalOf(tier);
  const since = Math.min(...monitors.map((m) => bucketOf(m.tier) - intervalOf(m.tier)));
  const reads = [];
  for (let i = 0; i < monitors.length; i += IDS_PER_READ) {
    reads.push(
      db
        .from('check_results')
        .select('monitor_id, location, checked_at, error, confirm')
        .in(
          'monitor_id',
          monitors.slice(i, i + IDS_PER_READ).map((m) => m.id),
        )
        .gte('checked_at', new Date(since).toISOString())
        .eq('attempt', 1)
        .or('error.eq.Timeout,confirm.is.true')
        // Past PostgREST's 1,000-row cap the newest (this round's) rows are the ones kept (security L2).
        .order('checked_at', { ascending: false }),
    );
  }
  type Row = {
    monitor_id: string;
    location: string;
    checked_at: string;
    error: string | null;
    confirm: boolean | null;
  };
  const rows: Row[] = [];
  for (const { data, error } of await Promise.all(reads)) {
    if (error) throw new Error(`check_results: ${error.message}`);
    // A full page means PostgREST may have cut rows: say so rather than miss a confirm silently.
    if (data.length >= 1000)
      console.warn(JSON.stringify({ event: 'confirm_due_truncated', rows: data.length }));
    rows.push(...data);
  }
  const timedOutAt = (r: Row) => !r.confirm && isTimeoutError(r.error);
  const owed = new Set<string>();
  for (const m of monitors) {
    const start = bucketOf(m.tier);
    const end = start + intervalOf(m.tier);
    const mine = rows.filter((r) => r.monitor_id === m.id);
    // A BKK row may be stamped up to 5 min ahead (the ingest skew): it isn't this round's.
    const inRound = mine.filter((r) => Date.parse(r.checked_at) >= start && Date.parse(r.checked_at) < end);
    // Only the round just before (D-049's): the read reaches further back for Tier 3 (advisor).
    const before = mine.filter((r) => {
      const t = Date.parse(r.checked_at);
      return t >= start - intervalOf(m.tier) && t < start;
    });
    const timedOut = new Set(inRound.filter(timedOutAt).map((r) => r.location));
    const timedOutBefore = new Set(before.filter(timedOutAt).map((r) => r.location));
    const confirmedHere = inRound.some((r) => r.confirm && r.location === location);
    if (timedOut.size >= 2 && timedOutBefore.size < 2 && !confirmedHere) owed.add(m.id);
  }
  return owed;
}
