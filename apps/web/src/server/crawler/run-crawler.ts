import 'server-only';
import type { DbClient } from '@dxt/db';
import { runHttpCheck, type HttpCheckRequest, type HttpCheckResult } from '@dxt/probe';
import {
  CRAWLER_CLIENTS,
  CRAWLER_VIEWS,
  FINGERPRINT_VIEW,
  probeRequestHeaders,
  toMonitorHeaders,
  type MonitorHeader,
} from '@dxt/shared';
import { isAllowedHost } from '@dxt/engine';
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
  allowedRedirectDomains: string[];
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
export function isUsable(r: HttpCheckResult, url: string, allowlist: readonly string[] = []): boolean {
  if (r.statusCode === null) return false;
  if (endedOffSite(r, url, allowlist)) return true;
  const answered = r.outcome === 'pass' && r.statusCode >= 200 && r.statusCode < 400;
  return answered && (r.scanComplete !== false || (r.keywordForbidden?.length ?? 0) > 0);
}

/** The redirects ended outside the site's allowlist — the engine's own rule (`isAllowedHost`). */
function endedOffSite(r: HttpCheckResult, url: string, allowlist: readonly string[]): boolean {
  try {
    return !!r.finalUrl && !isAllowedHost(new URL(r.finalUrl).hostname, url, allowlist);
  } catch {
    return false;
  }
}

/**
 * S09d (D-046 item 4): a plain fetch counts when the page answered 2xx / 3xx, passed, was read to its
 * end and stayed on the site — a fingerprint of a WAF page or of another host's page is no data.
 */
export function isUsablePlain(r: HttpCheckResult, url: string, allowlist: readonly string[] = []): boolean {
  if (r.statusCode === null || !r.fingerprint || r.scanComplete === false) return false;
  return (
    r.outcome === 'pass' && r.statusCode >= 200 && r.statusCode < 400 && !endedOffSite(r, url, allowlist)
  );
}

/** Each live site's home page: the primary monitor of an active site. */
export async function loadCrawlerMonitors(db: DbClient): Promise<CrawlerMonitor[]> {
  const { data, error } = await db
    .from('monitors')
    .select('id, url, must_not_contain, allowed_redirect_domains, headers, sites!inner(name, is_active)')
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
    allowedRedirectDomains: m.allowed_redirect_domains,
    headers: toMonitorHeaders(m.headers),
  }));
}

/**
 * The 30-min crawler run (D-041, D-042): every live home page as Googlebot and as a mobile browser
 * arriving from Google search, the whole body read for the shared list and the site's own forbidden
 * words, one `crawler_checks` row per view. The engine reads the latest usable rows beside its rounds.
 * S09d (D-046): a third, plain fetch as the monitor itself keeps the page's fingerprint; the first usable
 * one (or the first after the URL changed) becomes the baseline.
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
  const views = [...CRAWLER_VIEWS, FINGERPRINT_VIEW] as const;
  const all = monitors.flatMap((m) => views.map((view) => ({ m, view })));
  // Start each run further down the list, so a run cut by its budget never skips the same sites twice.
  const shift = all.length ? Math.floor(started / (30 * 60_000)) % all.length : 0;
  const jobs = [...all.slice(shift), ...all.slice(0, shift)];
  const ran = await inBatches(jobs, crawlerConcurrency(jobs.length), async ({ m, view }) => {
    if (clock() - started > CRAWLER_BUDGET_MS) return null;
    const checkedAt = new Date(clock());
    const plain = view === FINGERPRINT_VIEW;
    const result = await check({
      url: m.url,
      method: 'GET',
      timeoutMs: CRAWLER_TIMEOUT_MS,
      headers: probeRequestHeaders(m.headers, secretHeader),
      // The plain view goes as the monitor itself (the probe's own User-Agent) and only fingerprints.
      ...(plain
        ? { fingerprint: true }
        : { client: CRAWLER_CLIENTS[view], mustNotContain: m.mustNotContain }),
      scanWholeBody: true,
      allowPrivateTargets,
    });
    const usable = plain
      ? isUsablePlain(result, m.url, m.allowedRedirectDomains)
      : isUsable(result, m.url, m.allowedRedirectDomains);
    const { data: row, error } = await db
      .from('crawler_checks')
      .insert({
        monitor_id: m.id,
        view,
        checked_at: checkedAt.toISOString(),
        outcome: result.outcome,
        usable,
        status_code: result.statusCode,
        response_ms: result.responseMs,
        final_url: result.finalUrl,
        forbidden: plain ? null : result.keywordForbidden,
        scan_complete: result.scanComplete ?? null,
        error: result.error?.slice(0, 500) ?? null,
        fingerprint: plain && usable ? (result.fingerprint ?? null) : null,
      })
      .select('id')
      .single();
    // The first usable plain fetch of a monitor (or of its new URL) becomes its baseline.
    let baseline: string | null = null;
    let baselineSet = false;
    if (!error && plain && usable) {
      const set = await db.rpc('crawler_set_baseline', { p_check_id: row.id });
      baseline = set.error?.message ?? null;
      baselineSet = set.data === true;
    }
    return { m, view, checkedAt, result, usable, stored: error?.message ?? null, baseline, baselineSet };
  });
  const done = ran.filter((r) => r !== null);
  const writeErrors = [...new Set(done.map((r) => r.stored).filter((e) => e !== null))];
  if (writeErrors.length) throw new Error(`crawler_checks: ${writeErrors.join('; ')}`);
  const baselineErrors = [...new Set(done.map((r) => r.baseline).filter((e) => e !== null))];
  if (baselineErrors.length) throw new Error(`crawler_set_baseline: ${baselineErrors.join('; ')}`);

  // What the log keeps: the words or the final URL per site and view, never page content.
  const hits = done
    .filter(
      ({ view, usable, result }) =>
        view !== FINGERPRINT_VIEW && usable && (result.keywordForbidden?.length ?? 0) > 0,
    )
    .map(({ m, view, result }) => ({ site: m.siteName, view, forbidden: result.keywordForbidden }));
  const baselinesSet = done.filter((r) => r.baselineSet).map((r) => r.m.siteName);
  return {
    ok: true,
    fetched: done.length,
    unusable: done.filter((r) => !r.usable).length,
    ...(baselinesSet.length ? { baselinesSet } : {}),
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
