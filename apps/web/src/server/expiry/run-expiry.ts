import 'server-only';
import type { DbClient } from '@dxt/db';
import {
  ExpiryReadError,
  readCertificate,
  readDomainExpiry,
  type CertificateRead,
  type DomainRead,
} from '@dxt/probe';
import { registrableDomain } from '@dxt/shared';
import type { CronJobResult } from '../cron-job';
import { HTTP_MONITOR_TYPES } from '../probe/due-monitors';

/** The expiry read runs from Singapore (vercel.json `functions`), like the crawler. */
export const EXPIRY_REGION = 'sin1';
/** The daily full read: 06:00 Bangkok (D-066). */
export const EXPIRY_FULL_HOUR_BKK = 6;
/** Between full reads, a site whose last good read is older than this is read again. */
export const EXPIRY_REREAD_MS = 24 * 60 * 60_000;
/** Reads in flight at once (two connections each). */
export const EXPIRY_CONCURRENCY = 8;

const BKK_OFFSET_MS = 7 * 60 * 60_000;

export interface ExpirySite {
  siteId: string;
  siteName: string;
  host: string;
  domain: string | null;
  row: {
    host: string;
    ssl_read_at: string | null;
    ssl_error: string | null;
    domain_read_at: string | null;
    domain_error: string | null;
  } | null;
  /** An ssl / domain PROBLEM is open: read every hour so a renewal recovers it (D-066). */
  openExpiry: boolean;
}

export interface ExpiryDeps {
  db: DbClient;
  /** process.env.VERCEL / VERCEL_REGION; when not on Vercel (local) the region isn't checked. */
  vercel?: { region: string | undefined } | null;
  /** Every site, whatever the hour: the 06:00 run and "Check now". */
  all?: boolean;
  /** Local development only, as the probe's. */
  allowPrivateTargets?: boolean;
  readCert?: (host: string) => Promise<CertificateRead>;
  readDomain?: (domain: string) => Promise<DomainRead>;
  clock?: () => number;
}

/** Each live site's primary host, its stored row, and whether an expiry PROBLEM is open. */
export async function loadExpirySites(db: DbClient): Promise<ExpirySite[]> {
  const [monitors, rows, open] = await Promise.all([
    db
      .from('monitors')
      .select('url, site_id, sites!inner(name, is_active)')
      .eq('sites.is_active', true)
      .eq('is_primary', true)
      .eq('enabled', true)
      .is('removed_at', null)
      .in('type', HTTP_MONITOR_TYPES),
    db.from('site_expiry').select('site_id, host, ssl_read_at, ssl_error, domain_read_at, domain_error'),
    db.from('incidents').select('site_id').is('resolved_at', null).in('trigger', ['ssl', 'domain']),
  ]);
  if (monitors.error) throw new Error(`monitors: ${monitors.error.message}`);
  if (rows.error) throw new Error(`site_expiry: ${rows.error.message}`);
  if (open.error) throw new Error(`incidents: ${open.error.message}`);
  const bySite = new Map(rows.data.map((r) => [r.site_id, r]));
  const openSites = new Set(open.data.map((i) => i.site_id));
  return monitors.data.flatMap((m) => {
    let host: string;
    try {
      host = new URL(m.url).hostname;
    } catch {
      return [];
    }
    return [
      {
        siteId: m.site_id,
        siteName: m.sites.name,
        host,
        domain: registrableDomain(host),
        row: bySite.get(m.site_id) ?? null,
        openExpiry: openSites.has(m.site_id),
      },
    ];
  });
}

/** Whether `now` is the daily full read's hour in Bangkok. */
export function isFullRun(now: number): boolean {
  return new Date(now + BKK_OFFSET_MS).getUTCHours() === EXPIRY_FULL_HOUR_BKK;
}

/** Between full reads: a new site, a new host, a failed or day-old read, or an open expiry PROBLEM. */
export function needsRead(s: ExpirySite, now: number): boolean {
  const r = s.row;
  if (!r || r.host !== s.host || s.openExpiry) return true;
  if (r.ssl_error || r.domain_error) return true;
  const old = (at: string | null) => !at || now - Date.parse(at) >= EXPIRY_REREAD_MS;
  return old(r.ssl_read_at) || (s.domain !== null && old(r.domain_read_at));
}

const reason = (err: unknown) => (err instanceof ExpiryReadError ? err.message : 'Read failed');

/**
 * The hourly expiry run (S13, D-066): at 06:00 Bangkok every live site, otherwise only the sites
 * `needsRead` picks. One `site_expiry` row per site: a good read stores its dates, a failed one
 * stores the reason and keeps the last good dates — unless the host changed, when they belonged to
 * another host. Domains are read once per run (two sites can share one).
 */
export async function runExpiry({
  db,
  vercel = null,
  all,
  allowPrivateTargets = false,
  readCert = (host) => readCertificate(host, { allowPrivate: allowPrivateTargets }),
  readDomain = (domain) => readDomainExpiry(domain),
  clock = Date.now,
}: ExpiryDeps): Promise<CronJobResult> {
  if (vercel && vercel.region !== EXPIRY_REGION) {
    return { ok: false, skipped: 'wrong_region', expected: EXPIRY_REGION };
  }
  const started = clock();
  const full = all ?? isFullRun(started);
  const sites = await loadExpirySites(db);
  const due = full ? sites : sites.filter((s) => needsRead(s, started));
  const domains = new Map<string, Promise<DomainRead>>();
  const domainOf = (d: string) => {
    if (!domains.has(d)) domains.set(d, readDomain(d));
    return domains.get(d)!;
  };

  let sslRead = 0;
  let domainRead = 0;
  const failed: string[] = [];
  for (let i = 0; i < due.length; i += EXPIRY_CONCURRENCY) {
    await Promise.all(
      due.slice(i, i + EXPIRY_CONCURRENCY).map(async (s) => {
        const [cert, dom] = await Promise.allSettled([
          readCert(s.host),
          s.domain ? domainOf(s.domain) : Promise.reject(new ExpiryReadError('No registrable domain')),
        ]);
        const at = new Date(clock()).toISOString();
        const moved = s.row !== null && s.row.host !== s.host;
        const row: Record<string, unknown> = { site_id: s.siteId, host: s.host, domain: s.domain };
        if (cert.status === 'fulfilled') {
          sslRead++;
          Object.assign(row, {
            ssl_expires_at: cert.value.expiresAt.toISOString(),
            ssl_valid_from: cert.value.validFrom.toISOString(),
            ssl_issuer: cert.value.issuer,
            ssl_read_at: at,
            ssl_checked_at: at,
            ssl_error: null,
          });
        } else {
          Object.assign(row, { ssl_checked_at: at, ssl_error: reason(cert.reason) });
          if (moved)
            Object.assign(row, {
              ssl_expires_at: null,
              ssl_valid_from: null,
              ssl_issuer: null,
              ssl_read_at: null,
            });
        }
        if (dom.status === 'fulfilled') {
          domainRead++;
          Object.assign(row, {
            domain_expires_at: dom.value.expiresAt.toISOString(),
            domain_source: dom.value.source,
            domain_read_at: at,
            domain_checked_at: at,
            domain_error: null,
          });
        } else {
          Object.assign(row, { domain_checked_at: at, domain_error: reason(dom.reason) });
          if (moved)
            Object.assign(row, { domain_expires_at: null, domain_source: null, domain_read_at: null });
        }
        if (cert.status === 'rejected' || dom.status === 'rejected') failed.push(s.siteName);
        // One row each: a failed half leaves the last good dates out of the update.
        const { error } = await db
          .from('site_expiry')
          .upsert(row as never, { onConflict: 'site_id', defaultToNull: false });
        if (error) throw new Error(`site_expiry ${s.siteName}: ${error.message}`);
      }),
    );
  }
  return {
    ok: true,
    full,
    sites: sites.length,
    read: due.length,
    sslRead,
    domainRead,
    ...(failed.length ? { failed } : {}),
    ms: clock() - started,
  };
}
