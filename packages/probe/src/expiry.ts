/**
 * S13 (FR-11, D-066): when a site's SSL certificate and its domain expire.
 *
 * - `readCertificate` opens a TLS handshake to the host and reads the leaf certificate's dates. It
 *   doesn't verify the chain on purpose: it trusts nothing but the dates, sends no request, and a
 *   site with a broken chain (D-029, Cando Asia) must still be readable. An expired certificate is
 *   the probes' hard fail, not this reader's business.
 * - `readDomainExpiry` asks the registry: RDAP where the TLD has one, WHOIS (port 43) for .co and
 *   .jp, which don't. The servers are pinned here — no IANA bootstrap at run time, no referrals.
 */
import net from 'node:net';
import tls from 'node:tls';
import { rdapDomainSchema } from '@dxt/shared';
import { defaultLookup, publicOnlyLookup, type Lookup } from './target';

export const EXPIRY_TIMEOUT_MS = 10_000;
/** An answer bigger than this is refused: a registry's domain answer is a few KB. */
export const EXPIRY_MAX_BYTES = 64 * 1024;

/** A read that failed; `message` is short and safe to store (≤ 300 characters). */
export class ExpiryReadError extends Error {
  constructor(message: string) {
    super(message.slice(0, 300));
    this.name = 'ExpiryReadError';
  }
}

export interface CertificateRead {
  expiresAt: Date;
  validFrom: Date;
  /** The issuer's organisation (e.g. "Let's Encrypt"), or its common name. */
  issuer: string | null;
}

export interface CertificateOptions {
  port?: number;
  timeoutMs?: number;
  lookup?: Lookup;
  /** Local development and tests only: allow a private address. */
  allowPrivate?: boolean;
}

/** The host's leaf certificate dates. Throws ExpiryReadError. */
export function readCertificate(host: string, opts: CertificateOptions = {}): Promise<CertificateRead> {
  const timeoutMs = opts.timeoutMs ?? EXPIRY_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err: Error | null, read?: CertificateRead) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err instanceof ExpiryReadError ? err : new ExpiryReadError(errorText(err)));
      else resolve(read!);
    };
    const socket = tls.connect({
      host,
      port: opts.port ?? 443,
      servername: net.isIP(host) ? undefined : host,
      // Dates only — see the file comment. The handshake sends nothing and nothing it returns but the
      // certificate's dates is used.
      rejectUnauthorized: false,
      // SSRF: the connection goes only to an address checked as public (the probes' guard).
      lookup: publicOnlyLookup(opts.lookup ?? defaultLookup, opts.allowPrivate ?? false),
    });
    const timer = setTimeout(() => finish(new ExpiryReadError('Timeout')), timeoutMs);
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      const expiresAt = new Date(cert?.valid_to ?? NaN);
      const validFrom = new Date(cert?.valid_from ?? NaN);
      if (Number.isNaN(expiresAt.getTime()) || Number.isNaN(validFrom.getTime())) {
        return finish(new ExpiryReadError('No certificate'));
      }
      const issuer = first(cert.issuer?.O) ?? first(cert.issuer?.CN) ?? null;
      finish(null, { expiresAt, validFrom, issuer: issuer?.slice(0, 200) ?? null });
    });
    socket.once('error', (err) => finish(err));
  });
}

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** A short reason for a failed read: the error code when there is one. */
function errorText(err: Error): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (err.name === 'TargetNotAllowedError') return 'Address not allowed';
  return code ?? (err.message || 'Read failed');
}

export type DomainSource = 'rdap' | 'whois';

export interface DomainRead {
  expiresAt: Date;
  source: DomainSource;
}

/** RDAP base URLs by TLD (IANA's bootstrap, checked 17 Nov 2026). */
export const RDAP_SERVERS: Readonly<Record<string, string>> = {
  com: 'https://rdap.verisign.com/com/v1/',
  net: 'https://rdap.verisign.com/net/v1/',
  link: 'https://rdap.uniregistry.net/rdap/',
  asia: 'https://rdap.identitydigital.services/rdap/',
  studio: 'https://rdap.identitydigital.services/rdap/',
  th: 'https://rdap.thains.co.th/',
};

interface WhoisServer {
  host: string;
  query: (domain: string) => string;
}

/** WHOIS for the TLDs with no RDAP. */
export const WHOIS_SERVERS: Readonly<Record<string, WhoisServer>> = {
  co: { host: 'whois.registry.co', query: (d) => d },
  // `/e`: the English answer.
  jp: { host: 'whois.jprs.jp', query: (d) => `${d}/e` },
};

export type WhoisQuery = (server: string, query: string, timeoutMs: number) => Promise<string>;

export interface DomainOptions {
  fetch?: typeof globalThis.fetch;
  whois?: WhoisQuery;
  timeoutMs?: number;
}

/** When the registrable `domain` expires, from its registry. Throws ExpiryReadError. */
export async function readDomainExpiry(domain: string, opts: DomainOptions = {}): Promise<DomainRead> {
  const timeoutMs = opts.timeoutMs ?? EXPIRY_TIMEOUT_MS;
  const tld = domain.split('.').pop() ?? '';
  const rdap = RDAP_SERVERS[tld];
  if (rdap) {
    const f = opts.fetch ?? globalThis.fetch;
    let res: Response;
    try {
      res = await f(`${rdap}domain/${encodeURIComponent(domain)}`, {
        headers: { accept: 'application/rdap+json, application/json' },
        // A referral elsewhere isn't followed.
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ExpiryReadError(
        err instanceof Error && err.name === 'TimeoutError' ? 'Timeout' : 'RDAP unreachable',
      );
    }
    if (res.status === 404) throw new ExpiryReadError('Domain not found (RDAP 404)');
    if (!res.ok) throw new ExpiryReadError(`RDAP ${res.status}`);
    const expiresAt = parseRdapExpiry(await cappedText(res));
    if (!expiresAt) throw new ExpiryReadError('No expiry date in the RDAP answer');
    return { expiresAt, source: 'rdap' };
  }
  const whois = WHOIS_SERVERS[tld];
  if (!whois) throw new ExpiryReadError(`No registry lookup for .${tld}`);
  let text: string;
  try {
    text = await (opts.whois ?? whoisQuery)(whois.host, whois.query(domain), timeoutMs);
  } catch (err) {
    throw err instanceof ExpiryReadError ? err : new ExpiryReadError('WHOIS unreachable');
  }
  const expiresAt = parseWhoisExpiry(tld, text);
  if (!expiresAt) throw new ExpiryReadError('No expiry date in the WHOIS answer');
  return { expiresAt, source: 'whois' };
}

async function cappedText(res: Response): Promise<string> {
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > EXPIRY_MAX_BYTES) throw new ExpiryReadError('RDAP answer too large');
  const text = await res.text();
  if (text.length > EXPIRY_MAX_BYTES) throw new ExpiryReadError('RDAP answer too large');
  return text;
}

/** The `expiration` event of an RDAP domain answer, or null. */
export function parseRdapExpiry(body: string): Date | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = rdapDomainSchema.safeParse(json);
  if (!parsed.success) return null;
  const event = parsed.data.events.find((e) => e.eventAction === 'expiration');
  return validDate(event?.eventDate);
}

/**
 * The expiry in a WHOIS answer, or null.
 * - .co: `Registry Expiry Date: 2027-03-01T23:59:59.0Z`.
 * - .jp: a `co.jp`-style domain says `[State] Connected (2027/06/30)`, a plain `.jp` one
 *   `[Expires on] 2027/06/30`. JPRS dates are Japan days with no time: read as the end of that day.
 */
export function parseWhoisExpiry(tld: string, text: string): Date | null {
  if (tld === 'co') return validDate(text.match(/Registry Expiry Date:\s*(\S+)/)?.[1]);
  if (tld === 'jp') {
    const m =
      text.match(/\[State\]\s+Connected \((\d{4})\/(\d{2})\/(\d{2})\)/) ??
      text.match(/\[Expires on\]\s+(\d{4})\/(\d{2})\/(\d{2})/);
    return m ? validDate(`${m[1]}-${m[2]}-${m[3]}T23:59:59+09:00`) : null;
  }
  return null;
}

function validDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** One WHOIS query on port 43: the whole answer, capped. Only the pinned servers above are asked. */
export const whoisQuery = (server: string, query: string, timeoutMs: number, port = 43): Promise<string> =>
  new Promise((resolve, reject) => {
    let out = '';
    let done = false;
    const finish = (err: Error | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(out);
    };
    const socket = net.connect(port, server, () => socket.write(`${query}\r\n`));
    socket.setEncoding('utf8');
    const timer = setTimeout(() => finish(new ExpiryReadError('Timeout')), timeoutMs);
    socket.on('data', (chunk: string) => {
      out += chunk;
      if (out.length > EXPIRY_MAX_BYTES) finish(new ExpiryReadError('WHOIS answer too large'));
    });
    socket.once('end', () => finish(null));
    socket.once('error', (err) => finish(new ExpiryReadError(errorText(err))));
  });
