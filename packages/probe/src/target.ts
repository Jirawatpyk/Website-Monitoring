import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * SSRF guard (CLAUDE.md → Security): a probe only fetches public internet hosts on the standard web
 * ports. Checked before every request and every redirect hop, from every location — the same code
 * runs on Vercel and on the Thai VPS, where a LAN and the host itself would be reachable.
 * A probe's request resolves its host once, inside the connection (`publicOnlyLookup`, D-040): the
 * address that passed is the one it connects to, so DNS can't change in between (rebinding) and a
 * hop costs one lookup, not two. `assertPublicTarget` (resolve and check, no connection) stays for
 * saving a site and for the browser verifier.
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::', 96], // IPv4-compatible (deprecated) — ::7f00:1 is 127.0.0.1
  ['64:ff9b::', 96], // NAT64 — may map to private IPv4
  ['2002::', 16], // 6to4 — embeds an IPv4, private ones included
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
  ['2001:db8::', 32], // documentation
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** True for an address a probe must never connect to (private, loopback, link-local, reserved). */
export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isBlockedAddress(mapped[1]!);
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) return blocked.check(address, 'ipv6');
  return true;
}

export class TargetNotAllowedError extends Error {
  constructor(reason: string) {
    super(`Target not allowed: ${reason}`);
    this.name = 'TargetNotAllowedError';
  }
}

export type Lookup = (hostname: string) => Promise<{ address: string }[]>;

// The process's default order (no `verbatim`): the VPS runs with --dns-result-order=ipv4first because
// it has no IPv6 route, and a connection now goes to these addresses.
export const defaultLookup: Lookup = (hostname) => dnsLookup(hostname, { all: true });

const refusedAddress = () => new TargetNotAllowedError('private or reserved address');

/**
 * Scheme, port and an IP-literal host — everything but DNS. Throws TargetNotAllowedError unless `url`
 * is http(s) on port 80/443 and, if its host is an address, a public one. Returns the host for a lookup,
 * or null for an IP literal (a connection to it does no lookup).
 */
export function assertPublicUrl(url: URL): string | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TargetNotAllowedError('scheme');
  if (url.port && url.port !== '80' && url.port !== '443') throw new TargetNotAllowedError('port');
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (!isIP(host)) return host;
  if (isBlockedAddress(host)) throw refusedAddress();
  return null;
}

/** Throws TargetNotAllowedError unless `url` is http(s) on port 80/443 and resolves only to public addresses. */
export async function assertPublicTarget(
  url: URL,
  lookup: Lookup = defaultLookup,
  signal?: AbortSignal,
): Promise<void> {
  const host = assertPublicUrl(url);
  if (host === null) return;
  // The DNS lookup counts against the check's timeout like the request itself.
  const addresses = await withSignal(lookup(host), signal);
  if (refused(addresses)) throw refusedAddress();
}

/**
 * The one rule both guards apply to a lookup's answer: no address, anything that isn't one, or any
 * private / reserved address refuses the whole host (`allowPrivate`: local development and tests).
 */
function refused(addresses: readonly { address: string }[], allowPrivate = false): boolean {
  if (!addresses.length || addresses.some((a) => !isIP(a.address))) return true;
  return !allowPrivate && addresses.some((a) => isBlockedAddress(a.address));
}

type LookupAddress = { address: string; family: number };
type LookupCallback = (err: Error | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A `net.connect` lookup that resolves once and refuses the connection unless every address is public
 * (`allowPrivate`: local development and tests only). Handed to the HTTP client's connector, so the
 * request goes to exactly the address checked. Answers both forms Node asks for: one address, or all
 * of them (`options.all`, family autoselection) — of the family asked for, when one is.
 */
export function publicOnlyLookup(lookup: Lookup = defaultLookup, allowPrivate = false) {
  return (
    hostname: string,
    options: { all?: boolean; family?: number | string },
    callback: LookupCallback,
  ): void => {
    lookup(hostname).then(
      (found) => {
        if (refused(found, allowPrivate)) return callback(refusedAddress(), '');
        // Every address was checked above; a family filter only narrows the answer.
        const all = found.map((a) => ({ address: a.address, family: isIP(a.address) }));
        const f = options.family;
        const wanted = f === 4 || f === 'IPv4' ? 4 : f === 6 || f === 'IPv6' ? 6 : 0;
        const addresses = wanted ? all.filter((a) => a.family === wanted) : all;
        if (!addresses.length) {
          return callback(
            Object.assign(new Error(`No IPv${wanted} address for ${hostname}`), { code: 'ENOTFOUND' }),
            '',
          );
        }
        if (options.all) return callback(null, addresses);
        callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      (err: unknown) => callback(err instanceof Error ? err : new Error(String(err)), ''),
    );
  };
}

function withSignal<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}
