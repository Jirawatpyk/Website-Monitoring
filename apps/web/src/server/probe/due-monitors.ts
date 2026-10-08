import 'server-only';
import type { DbClient } from '@dxt/db';
import { TIER_CONFIG, toMonitorHeaders, type MonitorHeader, type Tier } from '@dxt/shared';

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
}

/** Monitor types the HTTP probes check (`keyword` is an HTTP check with keywords). */
export const HTTP_MONITOR_TYPES = ['http', 'keyword'] as const;

/** Tier 1 every minute, Tier 2 every 3, Tier 3 every 5 (PRD §2), on the UTC minute. */
export function isDue(tier: Tier, at: Date): boolean {
  const everyMin = TIER_CONFIG[tier].intervalSec / 60;
  return Math.floor(at.getTime() / 60_000) % everyMin === 0;
}

/**
 * Every monitor of an active site that is due at `at` — the primary and its key pages (S04a: a key
 * page can only raise a PROBLEM, D-022) — timeouts capped at 30 s.
 */
export async function loadDueMonitors(db: DbClient, at: Date): Promise<DueMonitor[]> {
  const { data, error } = await db
    .from('monitors')
    .select(
      'id, url, method, timeout_ms, must_contain, must_not_contain, headers, sites!inner(tier, is_active)',
    )
    .eq('sites.is_active', true)
    // A monitor switched off or removed (S05, D-025) isn't checked.
    .eq('enabled', true)
    .is('removed_at', null)
    // HTTP page monitors only: SSL / domain (S13) and browser (S23) monitors are checked their own way.
    .in('type', HTTP_MONITOR_TYPES);
  if (error) throw new Error(`monitors: ${error.message}`);
  return data
    .filter((m) => isDue(m.sites.tier as Tier, at))
    .map((m) => ({
      id: m.id,
      url: m.url,
      method: m.method === 'HEAD' ? 'HEAD' : 'GET',
      timeoutMs: Math.min(m.timeout_ms, MAX_CHECK_TIMEOUT_MS),
      mustContain: m.must_contain,
      mustNotContain: m.must_not_contain,
      headers: toMonitorHeaders(m.headers),
    }));
}
