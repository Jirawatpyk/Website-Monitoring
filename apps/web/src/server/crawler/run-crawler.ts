import 'server-only';
import type { DbClient } from '@dxt/db';
import { runHttpCheck, type HttpCheckRequest, type HttpCheckResult } from '@dxt/probe';
import {
  CRAWLER_CLIENTS,
  CRAWLER_VIEWS,
  probeRequestHeaders,
  toMonitorHeaders,
  type MonitorHeader,
} from '@dxt/shared';
import type { CronJobResult } from '../cron-job';
import { HTTP_MONITOR_TYPES } from '../probe/due-monitors';

/** The crawler runs from Singapore only (vercel.json `functions`); it is a view, not a location (D-041). */
export const CRAWLER_REGION = 'sin1';
/** Per fetch, DNS to the last byte of up to 3 MB. */
export const CRAWLER_TIMEOUT_MS = 20_000;
/** Fetches in flight at once: 17 sites × 2 views × 20 s ÷ 6 ≈ 115 s, inside maxDuration 120. */
export const CRAWLER_CONCURRENCY = 6;

export interface CrawlerMonitor {
  id: string;
  siteName: string;
  url: string;
  mustNotContain: string[];
  headers: MonitorHeader[];
}

export interface CrawlerDeps {
  db: DbClient;
  secretHeader?: { name: string; value: string };
  /** Local development only, as the probe's. */
  allowPrivateTargets?: boolean;
  /** process.env.VERCEL / VERCEL_REGION; when not on Vercel (local) the region isn't checked. */
  vercel?: { region: string | undefined } | null;
  check?: (req: HttpCheckRequest) => Promise<HttpCheckResult>;
  clock?: () => number;
}

/**
 * D-041: a crawler fetch counts only when the page answered — a 2xx / 3xx that passed. A WAF 403, a
 * challenge, a 404, a 5xx or a timeout is no data, never a PROBLEM: Akamai and Cloudflare refuse a
 * "Googlebot" from Vercel's IPs.
 */
export function isUsable(r: HttpCheckResult): boolean {
  return r.outcome === 'pass' && r.statusCode !== null && r.statusCode >= 200 && r.statusCode < 400;
}

/** Each live site's home page: the primary monitor of an active site. */
export async function loadCrawlerMonitors(db: DbClient): Promise<CrawlerMonitor[]> {
  const { data, error } = await db
    .from('monitors')
    .select('id, url, must_not_contain, headers, sites!inner(name, is_active)')
    .eq('sites.is_active', true)
    .eq('is_primary', true)
    .eq('enabled', true)
    .is('removed_at', null)
    .in('type', HTTP_MONITOR_TYPES);
  if (error) throw new Error(`monitors: ${error.message}`);
  return data.map((m) => ({
    id: m.id,
    siteName: m.sites.name,
    url: m.url,
    mustNotContain: m.must_not_contain,
    headers: toMonitorHeaders(m.headers),
  }));
}

/**
 * The 30-min crawler run (D-041, D-042): every live home page as Googlebot and as a mobile browser
 * arriving from Google search, the whole body read for the shared list and the site's own forbidden
 * words, one `crawler_checks` row per view. The engine reads the latest usable rows beside its rounds.
 */
export async function runCrawler({
  db,
  secretHeader,
  allowPrivateTargets = false,
  vercel = null,
  check = runHttpCheck,
  clock = Date.now,
}: CrawlerDeps): Promise<CronJobResult> {
  if (vercel && vercel.region !== CRAWLER_REGION) {
    return { ok: false, skipped: 'wrong_region', expected: CRAWLER_REGION };
  }
  const monitors = await loadCrawlerMonitors(db);
  const jobs = monitors.flatMap((m) => CRAWLER_VIEWS.map((view) => ({ m, view })));
  const done = await inBatches(jobs, CRAWLER_CONCURRENCY, async ({ m, view }) => {
    const checkedAt = new Date(clock());
    const result = await check({
      url: m.url,
      method: 'GET',
      timeoutMs: CRAWLER_TIMEOUT_MS,
      headers: probeRequestHeaders(m.headers, secretHeader),
      client: CRAWLER_CLIENTS[view],
      scanWholeBody: true,
      mustNotContain: m.mustNotContain,
      allowPrivateTargets,
    });
    return { m, view, checkedAt, result };
  });

  if (done.length) {
    const { error } = await db.from('crawler_checks').insert(
      done.map(({ m, view, checkedAt, result }) => ({
        monitor_id: m.id,
        view,
        checked_at: checkedAt.toISOString(),
        outcome: result.outcome,
        usable: isUsable(result),
        status_code: result.statusCode,
        response_ms: result.responseMs,
        final_url: result.finalUrl,
        forbidden: result.keywordForbidden,
        scan_complete: result.scanComplete ?? null,
        error: result.error?.slice(0, 500) ?? null,
      })),
    );
    if (error) throw new Error(`crawler_checks: ${error.message}`);
  }

  // What the log keeps: the words or the final URL per site and view, never page content.
  const hits = done
    .filter(({ result }) => isUsable(result) && (result.keywordForbidden?.length ?? 0) > 0)
    .map(({ m, view, result }) => ({ site: m.siteName, view, forbidden: result.keywordForbidden }));
  return {
    ok: true,
    fetched: done.length,
    unusable: done.filter(({ result }) => !isUsable(result)).length,
    ...(hits.length ? { hits } : {}),
  };
}

/** Runs `work` over `items`, at most `limit` at a time, keeping the input order. */
async function inBatches<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}
