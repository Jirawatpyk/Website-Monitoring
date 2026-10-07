import 'server-only';
import type { DbClient } from '@dxt/db';
import { TIER_CONFIG, type Tier } from '@dxt/shared';

/** A response slower than 30 s is a failure (PRD §5); longer monitor timeouts are capped here. */
export const MAX_CHECK_TIMEOUT_MS = 30_000;

/** What a probe needs to check one monitor — the same for SIN / TYO (cron) and BKK (VPS, Ingest API). */
export interface DueMonitor {
  id: string;
  url: string;
  method: 'GET' | 'HEAD';
  timeoutMs: number;
}

/** Tier 1 every minute, Tier 2 every 3, Tier 3 every 5 (PRD §2), on the UTC minute. */
export function isDue(tier: Tier, at: Date): boolean {
  const everyMin = TIER_CONFIG[tier].intervalSec / 60;
  return Math.floor(at.getTime() / 60_000) % everyMin === 0;
}

/** Primary monitors of active sites that are due at `at`, timeouts capped at 30 s. */
export async function loadDueMonitors(db: DbClient, at: Date): Promise<DueMonitor[]> {
  const { data, error } = await db
    .from('monitors')
    .select('id, url, method, timeout_ms, sites!inner(tier, is_active)')
    .eq('is_primary', true)
    .eq('sites.is_active', true);
  if (error) throw new Error(`monitors: ${error.message}`);
  return data
    .filter((m) => isDue(m.sites.tier as Tier, at))
    .map((m) => ({
      id: m.id,
      url: m.url,
      method: m.method === 'HEAD' ? 'HEAD' : 'GET',
      timeoutMs: Math.min(m.timeout_ms, MAX_CHECK_TIMEOUT_MS),
    }));
}
