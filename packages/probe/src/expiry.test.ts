import { readFileSync } from 'node:fs';
import { createServer as createNetServer, type AddressInfo, type Socket } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EXPIRY_MAX_BYTES,
  cleanText,
  hasRegistryLookup,
  ExpiryReadError,
  parseRdapExpiry,
  parseWhoisExpiry,
  readCertificate,
  readDomainExpiry,
  whoisQuery,
} from './expiry';

// S13 (D-066). The fixture is a self-signed certificate for `pinned.test`, valid until
// 18 Sep 2126 18:05:21 UTC: the reader must read it although nothing trusts it (a broken chain, D-029).
const fixtures = new URL('../test-fixtures/', import.meta.url);
const key = readFileSync(new URL('pinned.test.key', fixtures));
const cert = readFileSync(new URL('pinned.test.crt', fixtures), 'utf8');
const local = async () => [{ address: '127.0.0.1' }];

/** A net server whose open sockets can be torn down (net.Server has no closeAllConnections). */
function tracked(onSocket: (s: Socket) => void) {
  const sockets = new Set<Socket>();
  const server = createNetServer((s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
    onSocket(s);
  });
  const close = () => {
    for (const s of sockets) s.destroy();
    return new Promise((r) => server.close(r));
  };
  return { server, close };
}

describe('readCertificate', () => {
  const server = createTlsServer({ key, cert }, (s) => s.end());
  let port = 0;
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('reads the dates of a certificate nobody trusts (self-signed), without a request', async () => {
    const read = await readCertificate('pinned.test', { port, lookup: local, allowPrivate: true });
    expect(read.expiresAt.toISOString()).toBe('2126-09-18T18:05:21.000Z');
    expect(read.validFrom.toISOString()).toBe('2026-10-12T18:05:21.000Z');
    expect(read.issuer).toBe('pinned.test');
  });

  it.each(['127.0.0.1', '169.254.169.254', '10.0.0.5'])(
    'refuses the IP literal %s at once (a literal does no lookup, so the lookup guard never sees it)',
    async (ip) => {
      await expect(readCertificate(ip, { port })).rejects.toThrow(new ExpiryReadError('Address not allowed'));
    },
  );

  it('refuses a private address unless allowed (the probes’ SSRF guard)', async () => {
    await expect(readCertificate('pinned.test', { port, lookup: local })).rejects.toThrow(
      new ExpiryReadError('Address not allowed'),
    );
  });

  it('a closed port reads as its error code', async () => {
    const closed = createNetServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const free = (closed.address() as AddressInfo).port;
    await new Promise((r) => closed.close(r));
    await expect(
      readCertificate('pinned.test', { port: free, lookup: local, allowPrivate: true }),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('a server that never answers the handshake times out', async () => {
    const silent = tracked(() => {});
    await new Promise<void>((r) => silent.server.listen(0, '127.0.0.1', r));
    const p = (silent.server.address() as AddressInfo).port;
    try {
      await expect(
        readCertificate('pinned.test', { port: p, lookup: local, allowPrivate: true, timeoutMs: 200 }),
      ).rejects.toThrow('Timeout');
    } finally {
      await silent.close();
    }
  });
});

// Answers captured from the registries on 17 Nov 2026 (trimmed).
const RDAP_COM = JSON.stringify({
  objectClassName: 'domain',
  ldhName: 'CANDO-ASIA.COM',
  events: [
    { eventAction: 'registration', eventDate: '2008-05-21T04:08:18Z' },
    { eventAction: 'expiration', eventDate: '2027-05-21T04:08:18Z' },
    { eventAction: 'last update of RDAP database', eventDate: '2026-11-17T07:03:09Z' },
  ],
});
const WHOIS_CO = 'Domain Name: muvmi.co\r\nRegistry Expiry Date: 2027-03-01T23:59:59.0Z\r\nRegistrar: X\r\n';
const WHOIS_JP =
  '[Domain Name]                   FUJILINKS.CO.JP\n[State]                         Connected (2027/06/30)\n[Connected Date]                2000/06/22\n';

describe('parsers', () => {
  it('RDAP: the expiration event', () => {
    expect(parseRdapExpiry(RDAP_COM)?.toISOString()).toBe('2027-05-21T04:08:18.000Z');
    expect(parseRdapExpiry(JSON.stringify({ events: [] }))).toBeNull();
    expect(parseRdapExpiry('not json')).toBeNull();
    expect(parseRdapExpiry(JSON.stringify({ events: 'x' }))).toBeNull();
    expect(
      parseRdapExpiry(JSON.stringify({ events: [{ eventAction: 'expiration', eventDate: 'soon' }] })),
    ).toBeNull();
  });

  it('WHOIS: .co and .jp (a Japan day, read as its end)', () => {
    expect(parseWhoisExpiry('co', WHOIS_CO)?.toISOString()).toBe('2027-03-01T23:59:59.000Z');
    expect(parseWhoisExpiry('jp', WHOIS_JP)?.toISOString()).toBe('2027-06-30T14:59:59.000Z');
    expect(parseWhoisExpiry('jp', '[Expires on]                    2027/01/31\n')?.toISOString()).toBe(
      '2027-01-31T14:59:59.000Z',
    );
    expect(parseWhoisExpiry('jp', 'No match!!')).toBeNull();
    expect(parseWhoisExpiry('de', WHOIS_CO)).toBeNull();
  });
});

describe('readDomainExpiry', () => {
  const answer =
    (body: string, init: ResponseInit = {}): typeof fetch =>
    async (url) => {
      asked.push(String(url));
      return new Response(body, init);
    };
  let asked: string[] = [];

  it('asks the TLD’s pinned RDAP server, follows no redirect', async () => {
    asked = [];
    let redirect: RequestInit['redirect'];
    const read = await readDomainExpiry('cando-asia.com', {
      fetch: async (url, init) => {
        asked.push(String(url));
        redirect = init?.redirect;
        return new Response(RDAP_COM);
      },
    });
    expect(read).toEqual({ expiresAt: new Date('2027-05-21T04:08:18Z'), source: 'rdap' });
    expect(asked).toEqual(['https://rdap.verisign.com/com/v1/domain/cando-asia.com']);
    expect(redirect).toBe('error');
  });

  it('.co.th / .ac.th go to THNIC', async () => {
    asked = [];
    await readDomainExpiry('tubtong.ac.th', {
      fetch: answer(
        JSON.stringify({ events: [{ eventAction: 'expiration', eventDate: '2027-04-28T01:48:35Z' }] }),
      ),
    });
    expect(asked).toEqual(['https://rdap.thains.co.th/domain/tubtong.ac.th']);
  });

  it('RDAP failures read as short reasons', async () => {
    await expect(readDomainExpiry('a.com', { fetch: answer('', { status: 404 }) })).rejects.toThrow(
      'Domain not found (RDAP 404)',
    );
    await expect(readDomainExpiry('a.com', { fetch: answer('', { status: 503 }) })).rejects.toThrow(
      'RDAP 503',
    );
    await expect(readDomainExpiry('a.com', { fetch: answer('{}') })).rejects.toThrow(
      'No expiry date in the RDAP answer',
    );
    await expect(
      readDomainExpiry('a.com', { fetch: answer('x'.repeat(EXPIRY_MAX_BYTES + 1)) }),
    ).rejects.toThrow('RDAP answer too large');
    await expect(
      readDomainExpiry('a.com', {
        fetch: answer('{}', { headers: { 'content-length': String(EXPIRY_MAX_BYTES + 1) } }),
      }),
    ).rejects.toThrow('RDAP answer too large');
    await expect(
      readDomainExpiry('a.com', {
        fetch: async () => {
          throw new TypeError('fetch failed');
        },
      }),
    ).rejects.toThrow('RDAP unreachable');
    await expect(
      readDomainExpiry('a.com', {
        fetch: async () => {
          throw Object.assign(new Error('t'), { name: 'TimeoutError' });
        },
      }),
    ).rejects.toThrow('Timeout');
  });

  it('.co and .jp ask their pinned WHOIS server', async () => {
    const queries: string[] = [];
    const whois = async (server: string, query: string) => {
      queries.push(`${server} ${query}`);
      return server === 'whois.jprs.jp' ? WHOIS_JP : WHOIS_CO;
    };
    expect(await readDomainExpiry('muvmi.co', { whois })).toEqual({
      expiresAt: new Date('2027-03-01T23:59:59Z'),
      source: 'whois',
    });
    expect((await readDomainExpiry('fujilinks.co.jp', { whois })).source).toBe('whois');
    expect(queries).toEqual(['whois.registry.co muvmi.co', 'whois.jprs.jp fujilinks.co.jp/e']);
    await expect(readDomainExpiry('muvmi.co', { whois: async () => 'No match' })).rejects.toThrow(
      'No expiry date in the WHOIS answer',
    );
    await expect(
      readDomainExpiry('muvmi.co', {
        whois: async () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('WHOIS unreachable');
  });

  it('a chunked answer is refused at the cap, not after reading it whole', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(16 * 1024));
      },
    });
    await expect(readDomainExpiry('a.com', { fetch: async () => new Response(body) })).rejects.toThrow(
      'RDAP answer too large',
    );
    expect(pulled).toBeLessThanOrEqual(6);
  });

  it('a body that stalls past the timeout reads as Timeout', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
      },
    });
    await expect(readDomainExpiry('a.com', { fetch: async () => new Response(body) })).rejects.toThrow(
      'Timeout',
    );
    const broken = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(new Error('reset'));
      },
    });
    await expect(readDomainExpiry('a.com', { fetch: async () => new Response(broken) })).rejects.toThrow(
      'RDAP unreachable',
    );
  });

  it('an answer with many events still finds its expiration', async () => {
    const events = Array.from({ length: 80 }, (_, i) => ({
      eventAction: 'transfer',
      eventDate: `2010-01-${(i % 28) + 1}T00:00:00Z`,
    }));
    events.push({ eventAction: 'expiration', eventDate: '2027-05-21T04:08:18Z' });
    expect(parseRdapExpiry(JSON.stringify({ events }))?.toISOString()).toBe('2027-05-21T04:08:18.000Z');
  });

  it('a TLD with no lookup says so', async () => {
    await expect(readDomainExpiry('example.de')).rejects.toThrow('No registry lookup for .de');
  });
});

describe('whoisQuery', () => {
  it('sends the query line and returns the whole answer', async () => {
    let got = '';
    const server = createNetServer((s) => {
      s.once('data', (d) => {
        got = String(d);
        s.end(WHOIS_CO);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      expect(await whoisQuery('127.0.0.1', 'muvmi.co', 2000, port)).toBe(WHOIS_CO);
      expect(got).toBe('muvmi.co\r\n');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('caps the answer and times out', async () => {
    const big = tracked((s) => s.write('x'.repeat(EXPIRY_MAX_BYTES + 10)));
    const silent = tracked(() => {});
    await new Promise<void>((r) => big.server.listen(0, '127.0.0.1', r));
    await new Promise<void>((r) => silent.server.listen(0, '127.0.0.1', r));
    const port = (s: typeof big) => (s.server.address() as AddressInfo).port;
    try {
      await expect(whoisQuery('127.0.0.1', 'a.co', 2000, port(big))).rejects.toThrow(
        'WHOIS answer too large',
      );
      await expect(whoisQuery('127.0.0.1', 'a.co', 100, port(silent))).rejects.toThrow('Timeout');
    } finally {
      await big.close();
      await silent.close();
    }
  });
});

describe('cleanText, hasRegistryLookup', () => {
  it('strips control characters (a NUL breaks a text write), trims and cuts', () => {
    expect(cleanText('Evil\u0000 CA\n', 200)).toBe('Evil CA');
    expect(cleanText('x'.repeat(250), 200)).toHaveLength(200);
    expect(cleanText(undefined, 10)).toBe('');
    expect(new ExpiryReadError('\u0000').message).toBe('Read failed');
  });
  it('knows which domains a registry here can read', () => {
    expect(hasRegistryLookup('voca.co.th')).toBe(true);
    expect(hasRegistryLookup('muvmi.co')).toBe(true);
    expect(hasRegistryLookup('example.de')).toBe(false);
    expect(hasRegistryLookup('203.0.113.9')).toBe(false);
  });
});
