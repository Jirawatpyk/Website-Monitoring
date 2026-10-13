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
/** Fetches in flight at once: at least 6, more as sites are added (≈ 1 lane per 6 fetches, at most 24). */
export const crawlerConcurrency = (fetches: number) => Math.min(24, Math.max(6, Math.ceil(fetches / 6)));
/**
 * No fetch starts after this (maxDuration 120 s, vercel.json): one that starts by then ends by ~120 s
 * with its row stored. Rows are stored as each fetch ends, so a run cut short keeps what it did.
 */
export const CRAWLER_BUDGET_MS = 95_000;

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
 * D-041 / D-042: a crawler fetch counts only when the page answered — a 2xx / 3xx that passed, read to
 * its end (or the 3 MB cap) or with a hit already found. A WAF 403, a challenge, a 404, a 5xx, a
 * timeout or a tail that broke off clean is no data, never a PROBLEM and never a recovery: Akamai and
 * Cloudflare refuse a "Googlebot" from Vercel's IPs. One exception: a fetch the site sent to another
 * host counts whatever that host answered — the redirect itself is the evidence.
 */
export function isUsable(r: HttpCheckResult, url: string): boolean {
  if (r.statusCode === null) return false;
  if (endedOffSite(r, url)) return true;
  const answered = r.outcome === 'pass' && r.statusCode >= 200 && r.statusCode < 400;
  return answered && (r.scanComplete !== false || (r.keywordForbidden?.length ?? 0) > 0);
}

const bareHost = (u: string) => new URL(u).hostname.toLowerCase().replace(/^www\./, '');

/** The redirects ended on another host than the monitor's own (with or without `www.`). */
function endedOffSite(r: HttpCheckResult, url: string): boolean {
  try {
    return !!r.finalUrl && bareHost(r.finalUrl) !== bareHost(url);
  } catch {
    return false;
  }
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
  const started = clock();
  const monitors = await loadCrawlerMonitors(db);
  const jobs = monitors.flatMap((m) => CRAWLER_VIEWS.map((view) => ({ m, view })));
  const ran = await inBatches(jobs, crawlerConcurrency(jobs.length), async ({ m, view }) => {
    if (clock() - started > CRAWLER_BUDGET_MS) return null;
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
    const { error } = await db.from('crawler_checks').insert({
      monitor_id: m.id,
      view,
      checked_at: checkedAt.toISOString(),
      outcome: result.outcome,
      usable: isUsable(result, m.url),
      status_code: result.statusCode,
      response_ms: result.responseMs,
      final_url: result.finalUrl,
      forbidden: result.keywordForbidden,
      scan_complete: result.scanComplete ?? null,
      error: result.error?.slice(0, 500) ?? null,
    });
    return { m, view, checkedAt, result, stored: error?.message ?? null };
  });
  const done = ran.filter((r) => r !== null);
  const writeErrors = [...new Set(done.map((r) => r.stored).filter((e) => e !== null))];
  if (writeErrors.length) throw new Error(`crawler_checks: ${writeErrors.join('; ')}`);

  // What the log keeps: the words or the final URL per site and view, never page content.
  const hits = done
    .filter(({ m, result }) => isUsable(result, m.url) && (result.keywordForbidden?.length ?? 0) > 0)
    .map(({ m, view, result }) => ({ site: m.siteName, view, forbidden: result.keywordForbidden }));
  return {
    ok: true,
    fetched: done.length,
    unusable: done.filter(({ m, result }) => !isUsable(result, m.url)).length,
    ...(ran.length > done.length ? { skipped: ran.length - done.length } : {}),
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
