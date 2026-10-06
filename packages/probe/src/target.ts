import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * SSRF guard (CLAUDE.md → Security): a probe only fetches public internet hosts on the standard web
 * ports. Checked before every request and every redirect hop, from every location — the same code
 * runs on Vercel and on the Thai VPS, where a LAN and the host itself would be reachable.
 * Residual risk: DNS can change between this check and the connection (rebinding); pinning the
 * connection to the checked address is a follow-up.
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
  ['64:ff9b::', 96], // NAT64 — may map to private IPv4
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

const defaultLookup: Lookup = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/** Throws TargetNotAllowedError unless `url` is http(s) on port 80/443 and resolves only to public addresses. */
export async function assertPublicTarget(url: URL, lookup: Lookup = defaultLookup): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TargetNotAllowedError('scheme');
  if (url.port && url.port !== '80' && url.port !== '443') throw new TargetNotAllowedError('port');
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host);
  if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
    throw new TargetNotAllowedError('private or reserved address');
  }
}
