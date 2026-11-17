import 'server-only';
import type { Database, DbClient } from '@dxt/db';
import {
  ExpiryReadError,
  hasRegistryLookup,
  readCertificate,
  readDomainExpiry,
  type CertificateRead,
  type DomainRead,
} from '@dxt/probe';
import { registrableDomain } from '@dxt/shared';
import type { CronJobResult } from '../cron-job';
import { inBatches } from '../in-batches';
import { HTTP_MONITOR_TYPES } from '../probe/due-monitors';

/** The expiry read runs from Singapore (vercel.json `functions`), like the crawler. */
export const EXPIRY_REGION = 'sin1';
/** The daily full read: 06:00 Bangkok (D-066). */
export const EXPIRY_FULL_HOUR_BKK = 6;
/** Between full reads, a site whose last good read is older than this is read again. */
export const EXPIRY_REREAD_MS = 24 * 60 * 60_000;
/** Reads in flight at once (two connections each). */
export const EXPIRY_CONCURRENCY = 8;
/**
 * No read starts after this (maxDuration 60 s): one that starts by then ends by its 10 s timeouts.
 * A site left out is read on the next hourly run (`needsRead`: a day-old read).
 */
export const EXPIRY_BUDGET_MS = 40_000;

const BKK_OFFSET_MS = 7 * 60 * 60_000;

type ExpiryRow = Database['public']['Tables']['site_expiry']['Insert'];

export interface ExpirySite {
  siteId: string;
  siteName: string;
  host: string;
  /** An https home page: it has a certificate to read (an http:// one only has its domain). */
  https: boolean;
  domain: string | null;
  row: {
    host: string;
    domain: string | null;
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

/**
 * Each live site's primary host, its stored row, and whether an expiry PROBLEM is open — the
 * incident's trigger, or the primary's current verdict (an expiry drop that joined an incident opened
 * by another trigger, engine review M3). Only an https home page has a certificate to read: an
 * http:// site serves none, whatever port 443 holds, but its domain can still lapse.
 */
export async function loadExpirySites(db: DbClient): Promise<ExpirySite[]> {
  const [monitors, rows, open, verdicts] = await Promise.all([
    db
      .from('monitors')
      .select('url, site_id, sites!inner(name, is_active)')
      .eq('sites.is_active', true)
      .eq('is_primary', true)
      .eq('enabled', true)
      .is('removed_at', null)
      .in('type', HTTP_MONITOR_TYPES),
    db
      .from('site_expiry')
      .select('site_id, host, domain, ssl_read_at, ssl_error, domain_read_at, domain_error'),
    db.from('incidents').select('site_id').is('resolved_at', null).in('trigger', ['ssl', 'domain']),
    db.from('monitor_status').select('site_id').eq('status', 'problem').in('trigger', ['ssl', 'domain']),
  ]);
  if (monitors.error) throw new Error(`monitors: ${monitors.error.message}`);
  if (rows.error) throw new Error(`site_expiry: ${rows.error.message}`);
  if (open.error) throw new Error(`incidents: ${open.error.message}`);
  if (verdicts.error) throw new Error(`monitor_status: ${verdicts.error.message}`);
  const bySite = new Map(rows.data.map((r) => [r.site_id, r]));
  const openSites = new Set([...open.data, ...verdicts.data].map((i) => i.site_id));
  return monitors.data.flatMap((m) => {
    let url: URL;
    try {
      url = new URL(m.url);
    } catch {
      return [];
    }
    const host = url.hostname;
    return [
      {
        siteId: m.site_id,
        siteName: m.sites.name,
        host,
        https: url.protocol === 'https:',
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

/** The domain half can ever be read: a registrable domain under a TLD with a pinned registry. */
const domainReadable = (s: ExpirySite) => s.domain !== null && hasRegistryLookup(s.domain);

/**
 * Between full reads: a new site, a new host, a failed or day-old read, or an open expiry PROBLEM.
 * A domain that can never be read (an IP host, a TLD with no registry here) isn't retried hourly —
 * the 06:00 run records it once a day.
 */
export function needsRead(s: ExpirySite, now: number): boolean {
  const r = s.row;
  if (!r || r.host !== s.host || s.openExpiry) return true;
  const old = (at: string | null) => !at || now - Date.parse(at) >= EXPIRY_REREAD_MS;
  if (s.https && (r.ssl_error || old(r.ssl_read_at))) return true;
  return domainReadable(s) && (r.domain_error !== null || old(r.domain_read_at));
}

/** An http:// home page: nothing to read on 443. */
const NO_TLS = Symbol('no TLS');

const reason = (err: unknown) => (err instanceof ExpiryReadError ? err.message : 'Read failed');

/**
 * The hourly expiry run (S13, D-066): at 06:00 Bangkok every live site, otherwise only the sites
 * `needsRead` picks. One `site_expiry` row per site: a good read stores its dates, a failed one
 * stores the reason and keeps the last good dates — unless what they were read from changed (the
 * host for the certificate, the registrable domain for the domain). Domains are read once per run
 * (two sites can share one). A failed write is logged with the site and fails the run at the end.
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
  let skipped = 0;
  const failed: string[] = [];
  const unwritten: string[] = [];
  await inBatches(due, EXPIRY_CONCURRENCY, async (s) => {
    if (clock() - started > EXPIRY_BUDGET_MS) {
      skipped++;
      return;
    }
    const [cert, dom] = await Promise.allSettled([
      s.https ? readCert(s.host) : Promise.reject(NO_TLS),
      s.domain ? domainOf(s.domain) : Promise.reject(new ExpiryReadError('No registrable domain')),
    ]);
    const at = new Date(clock()).toISOString();
    const row: ExpiryRow = { site_id: s.siteId, host: s.host, domain: s.domain };
    if (cert.status === 'fulfilled') {
      sslRead++;
      Object.assign(row, {
        ssl_expires_at: cert.value.expiresAt.toISOString(),
        ssl_valid_from: cert.value.validFrom.toISOString(),
        ssl_issuer: cert.value.issuer,
        ssl_read_at: at,
        ssl_checked_at: at,
        ssl_error: null,
      } satisfies Partial<ExpiryRow>);
    } else if (cert.reason === NO_TLS) {
      // No certificate to read: the SSL half stays empty, and is never a failure.
      Object.assign(row, {
        ssl_expires_at: null,
        ssl_valid_from: null,
        ssl_issuer: null,
        ssl_read_at: null,
        ssl_checked_at: null,
        ssl_error: null,
      });
    } else {
      Object.assign(row, { ssl_checked_at: at, ssl_error: reason(cert.reason) });
      if (s.row && s.row.host !== s.host) {
        Object.assign(row, {
          ssl_expires_at: null,
          ssl_valid_from: null,
          ssl_issuer: null,
          ssl_read_at: null,
        });
      }
    }
    if (dom.status === 'fulfilled') {
      domainRead++;
      Object.assign(row, {
        domain_expires_at: dom.value.expiresAt.toISOString(),
        domain_source: dom.value.source,
        domain_read_at: at,
        domain_checked_at: at,
        domain_error: null,
      } satisfies Partial<ExpiryRow>);
    } else {
      Object.assign(row, { domain_checked_at: at, domain_error: reason(dom.reason) });
      if (s.row && s.row.domain !== s.domain) {
        Object.assign(row, { domain_expires_at: null, domain_source: null, domain_read_at: null });
      }
    }
    if ((cert.status === 'rejected' && cert.reason !== NO_TLS) || dom.status === 'rejected')
      failed.push(s.siteName);
    // One object per upsert: PostgREST updates only the keys present, so a failed half keeps its
    // last good dates. Never batch these into an array — its column set is the union of every row's
    // keys, and a row missing a date would write null over the stored one.
    const { error } = await db.from('site_expiry').upsert(row, { onConflict: 'site_id' });
    if (error) {
      unwritten.push(s.siteName);
      console.error(JSON.stringify({ event: 'expiry_write_failed', site: s.siteId, error: error.message }));
    }
  });
  return {
    ok: unwritten.length === 0,
    full,
    sites: sites.length,
    read: due.length - skipped,
    sslRead,
    domainRead,
    ...(skipped ? { skipped } : {}),
    ...(failed.length ? { failed } : {}),
    ...(unwritten.length ? { unwritten } : {}),
    ms: clock() - started,
  };
}
