import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CRAWLER_CLIENTS, PROBE_USER_AGENT } from '@dxt/shared';
import { runHttpCheck, sameSite } from './http-check';

// A local server that answers per path, so every outcome is tested over real HTTP.
let server: Server;
let base: string;
let lastHeaders: IncomingHttpHeaders = {};
// A second origin, as a redirect target on another host.
let otherServer: Server;
let other: string;
let otherHeaders: IncomingHttpHeaders = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    lastHeaders = req.headers;
    switch (req.url) {
      case '/ok':
        res.writeHead(200, { 'content-type': 'text/html' }).end('<h1>Welcome</h1>');
        break;
      case '/big':
        res.writeHead(200).end('x'.repeat(40_000));
        break;
      case '/deep-keyword':
        // The brand keyword far past the first 16 KB, as on a real home page.
        res.writeHead(200).end(`${'x'.repeat(100_000)}<footer>Welcome</footer>`);
        break;
      case '/wix-deep':
        // A Wix home page: ~300 KB of inline CSS before the <title> with the brand (D-026).
        res.writeHead(200).end(`${'x'.repeat(300_000)}<title>VOCA | Agency</title><p>Index of /</p>`);
        break;
      case '/too-deep':
        res.writeHead(200).end(`${'x'.repeat(4_000_000)}<title>VOCA</title>`);
        break;
      case '/stall-tail':
        // The sample arrives, then the rest never does (the brand isn't in it).
        res.writeHead(200);
        res.write('x'.repeat(300_000));
        break;
      case '/broken-tail':
        // The sample arrives, then the connection drops.
        res.writeHead(200);
        res.write('x'.repeat(300_000));
        setTimeout(() => res.destroy(), 20);
        break;
      case '/split':
        // The keyword arrives in two chunks.
        res.writeHead(200);
        res.write(`${'x'.repeat(70_000)}<title>DxT `);
        setTimeout(() => res.end('Solutions</title>'), 20);
        break;
      case '/defaced':
        res.writeHead(200).end('<h1>Index of /</h1>');
        break;
      case '/spam':
        // A hacked page: gambling links injected near the top (D-041).
        res.writeHead(200).end('<h1>Welcome</h1><a href="//x">Best SLOT  online</a> บาคาร่า');
        break;
      case '/booking':
        res.writeHead(200).end('<h1>Book</h1><p>Select a time slot</p>');
        break;
      case '/deep-spam':
        // The spam past the 256 KB sample, at the end of <body>.
        res.writeHead(200).end(`<h1>Welcome</h1>${'x'.repeat(300_000)}<a>บาคาร่า</a><p>Index of /</p>`);
        break;
      case '/split-spam':
        // A phrase arriving in two chunks past the sample.
        res.writeHead(200);
        res.write(`${'x'.repeat(300_000)}<a>slot `);
        setTimeout(() => res.end('online</a>'), 20);
        break;
      case '/tis-620':
        // A Thai page in TIS-620 / windows-874: "บาคาร่า".
        res
          .writeHead(200, { 'content-type': 'text/html; charset=windows-874' })
          .end(Buffer.from([0xba, 0xd2, 0xa4, 0xd2, 0xc3, 0xe8, 0xd2]));
        break;
      case '/bad-charset':
        res.writeHead(200, { 'content-type': 'text/html; charset=nonsense' }).end('slot online');
        break;
      case '/down':
        res.writeHead(504).end('Gateway Timeout');
        break;
      case '/challenge':
        res.writeHead(403, { 'cf-mitigated': 'challenge' }).end('<title>Just a moment...</title>');
        break;
      case '/redirect-same':
        res.writeHead(302, { location: '/ok' }).end();
        break;
      case '/redirect-other':
        res.writeHead(301, { location: `${other}/seen` }).end();
        break;
      case '/loop':
        res.writeHead(302, { location: '/loop' }).end();
        break;
      case '/hang':
        break; // never answers
      default:
        res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  otherServer = createServer((req, res) => {
    otherHeaders = req.headers;
    res.writeHead(200).end('elsewhere');
  });
  await new Promise<void>((resolve) => otherServer.listen(0, '127.0.0.1', resolve));
  other = `http://127.0.0.1:${(otherServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  otherServer.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => otherServer.close(resolve));
});

describe('runHttpCheck', () => {
  it('passes a 200 and records status, timings and the body sample', async () => {
    const result = await runHttpCheck({ allowPrivateTargets: true, url: `${base}/ok` });
    expect(result).toMatchObject({ outcome: 'pass', statusCode: 200, error: null });
    expect(result.responseMs).toBeGreaterThanOrEqual(0);
    expect(result.ttfbMs).toBeGreaterThanOrEqual(0);
    expect(result.bodySample).toContain('Welcome');
  });

  it('sends the identifying User-Agent and the WAF secret header', async () => {
    await runHttpCheck({
      allowPrivateTargets: true,
      url: `${base}/ok`,
      headers: { 'x-dxt-monitor': 'secret' },
    });
    expect(lastHeaders['user-agent']).toBe(PROBE_USER_AGENT);
    expect(lastHeaders['x-dxt-monitor']).toBe('secret');
  });

  it('keeps only the first 256 KB of the body', async () => {
    const result = await runHttpCheck({ allowPrivateTargets: true, url: `${base}/wix-deep` });
    expect(result.bodySample).toHaveLength(262_144);
  });

  it('records the final URL after the redirects (PROBLEM · Redirect, D-022)', async () => {
    expect((await runHttpCheck({ allowPrivateTargets: true, url: `${base}/ok` })).finalUrl).toBe(
      `${base}/ok`,
    );
    expect((await runHttpCheck({ allowPrivateTargets: true, url: `${base}/redirect-same` })).finalUrl).toBe(
      `${base}/ok`,
    );
    expect((await runHttpCheck({ allowPrivateTargets: true, url: `${base}/redirect-other` })).finalUrl).toBe(
      `${other}/seen`,
    );
  });

  it('checks keywords in the body, never failing the check (PROBLEM · Keyword, D-022)', async () => {
    const found = await runHttpCheck({
      allowPrivateTargets: true,
      url: `${base}/ok`,
      mustContain: ['Welcome'],
    });
    expect(found).toMatchObject({ outcome: 'pass', keywordMissing: [], keywordForbidden: [] });

    // INC-0129 WeCare Asia: a broken deploy lost the brand keyword.
    const missing = await runHttpCheck({
      allowPrivateTargets: true,
      url: `${base}/defaced`,
      mustContain: ['Welcome'],
      mustNotContain: ['Index of /', 'Database error'],
    });
    expect(missing).toMatchObject({
      outcome: 'pass',
      keywordMissing: ['Welcome'],
      keywordForbidden: ['Index of /'],
    });
  });

  it('cuts a long keyword list and long keywords to what the stores take, never failing the batch', async () => {
    const many = Array.from({ length: 25 }, (_, i) => `missing-${i}-${'x'.repeat(250)}`);
    const result = await runHttpCheck({ allowPrivateTargets: true, url: `${base}/ok`, mustContain: many });
    expect(result.keywordMissing).toHaveLength(20);
    expect(result.keywordMissing![0]).toHaveLength(200);
  });

  it('matches keywords case-sensitively, like the browser verifier', async () => {
    const result = await runHttpCheck({
      allowPrivateTargets: true,
      url: `${base}/ok`,
      mustContain: ['welcome'],
    });
    expect(result.keywordMissing).toEqual(['welcome']);
  });

  it('reads up to 256 KB when the monitor has keywords', async () => {
    const result = await runHttpCheck({
      allowPrivateTargets: true,
      url: `${base}/deep-keyword`,
      mustContain: ['Welcome'],
    });
    expect(result.keywordMissing).toEqual([]);
  });

  it('looks for a must-contain keyword past 256 KB, up to about 3 MB (D-026)', async () => {
    const deep = await runHttpCheck({
      allowPrivateTargets: true,
      url: `${base}/wix-deep`,
      mustContain: ['VOCA'],
      mustNotContain: ['Index of /'],
    });
    // Found deep; a must-not-contain word past the 256 KB sample is not looked for.
    expect(deep).toMatchObject({ keywordMissing: [], keywordForbidden: [] });
    expect(deep.bodySample).toHaveLength(262_144);

    const tooDeep = await runHttpCheck({
      allowPrivateTargets: true,
      url: `${base}/too-deep`,
      mustContain: ['VOCA'],
    });
    expect(tooDeep.keywordMissing).toEqual(['VOCA']);
  });

  it('a tail that stalls or drops during the keyword scan is "not checked", never a hard fail', async () => {
    const stalled = await runHttpCheck({
      allowPrivateTargets: true,
      url: `${base}/stall-tail`,
      timeoutMs: 500,
      mustContain: ['VOCA'],
    });
    expect(stalled).toMatchObject({ outcome: 'pass', statusCode: 200, keywordMissing: null, error: null });
    // The response time ends with the sample, not with the timeout.
    expect(stalled.responseMs).toBeLessThan(500);

    const broken = await runHttpCheck({
      allowPrivateTargets: true,
      url: `${base}/broken-tail`,
      mustContain: ['VOCA'],
    });
    expect(broken).toMatchObject({ outcome: 'pass', keywordMissing: null });
  });

  it('finds a keyword split across two chunks of the body', async () => {
    const result = await runHttpCheck({
      allowPrivateTargets: true,
      url: `${base}/split`,
      mustContain: ['DxT Solutions', 'Gone'],
    });
    expect(result.keywordMissing).toEqual(['Gone']);
  });

  it("checks no keywords on HEAD or on a response that didn't pass", async () => {
    const head = await runHttpCheck({
      allowPrivateTargets: true,
      url: `${base}/ok`,
      method: 'HEAD',
      mustContain: ['Welcome'],
    });
    expect(head.keywordMissing).toBeNull();
    // A challenge page or a 5xx says nothing about the content.
    const challenge = await runHttpCheck({
      allowPrivateTargets: true,
      url: `${base}/challenge`,
      mustContain: ['Welcome'],
    });
    expect(challenge).toMatchObject({ outcome: 'blocked', keywordMissing: null });
    const down = await runHttpCheck({
      allowPrivateTargets: true,
      url: `${base}/down`,
      mustContain: ['Welcome'],
    });
    expect(down).toMatchObject({ outcome: 'fail', keywordMissing: null, finalUrl: `${base}/down` });
  });

  describe('the shared forbidden list (D-041, D-042)', () => {
    it('checks every GET, even a monitor without keywords of its own', async () => {
      const clean = await runHttpCheck({ allowPrivateTargets: true, url: `${base}/ok` });
      expect(clean).toMatchObject({ keywordMissing: [], keywordForbidden: [] });
      const spam = await runHttpCheck({ allowPrivateTargets: true, url: `${base}/spam` });
      // Case and spacing don't matter; the list's own entry is reported.
      expect(spam.keywordForbidden).toEqual(['บาคาร่า', 'slot online']);
    });

    it('reports a site’s own word first, once, and keeps it case-sensitive', async () => {
      const result = await runHttpCheck({
        allowPrivateTargets: true,
        url: `${base}/spam`,
        mustNotContain: ['บาคาร่า', 'SLOT  online', 'slot online'],
      });
      expect(result.keywordForbidden).toEqual(['บาคาร่า', 'SLOT  online', 'slot online']);
    });

    it('"Select a time slot" on a booking page is no hit', async () => {
      const result = await runHttpCheck({ allowPrivateTargets: true, url: `${base}/booking` });
      expect(result.keywordForbidden).toEqual([]);
    });

    it('a phrase past 256 KB: the probe misses it, the crawler’s whole-body read finds it', async () => {
      const probe = await runHttpCheck({
        allowPrivateTargets: true,
        url: `${base}/deep-spam`,
        mustNotContain: ['Index of /'],
      });
      expect(probe.keywordForbidden).toEqual([]);
      expect(probe.scanComplete).toBeUndefined();
      const crawler = await runHttpCheck({
        allowPrivateTargets: true,
        url: `${base}/deep-spam`,
        mustNotContain: ['Index of /'],
        scanWholeBody: true,
      });
      expect(crawler).toMatchObject({ keywordForbidden: ['Index of /', 'บาคาร่า'], scanComplete: true });
      expect(crawler.bodySample).toHaveLength(262_144);
    });

    it('finds a phrase split across two chunks in the whole-body read', async () => {
      const result = await runHttpCheck({
        allowPrivateTargets: true,
        url: `${base}/split-spam`,
        scanWholeBody: true,
      });
      expect(result.keywordForbidden).toEqual(['slot online']);
    });

    it('a whole-body read cut at about 3 MB says so', async () => {
      const result = await runHttpCheck({
        allowPrivateTargets: true,
        url: `${base}/too-deep`,
        scanWholeBody: true,
      });
      expect(result).toMatchObject({ keywordForbidden: [], scanComplete: false });
    });

    it('reads a TIS-620 Thai page in its own charset; an unknown charset falls back to UTF-8', async () => {
      const thai = await runHttpCheck({ allowPrivateTargets: true, url: `${base}/tis-620` });
      expect(thai.keywordForbidden).toEqual(['บาคาร่า']);
      const unknown = await runHttpCheck({ allowPrivateTargets: true, url: `${base}/bad-charset` });
      expect(unknown.keywordForbidden).toEqual(['slot online']);
    });
  });

  describe('the crawler’s identity (D-042)', () => {
    it('sends the Googlebot User-Agent instead of the probe’s', async () => {
      await runHttpCheck({ allowPrivateTargets: true, url: `${base}/ok`, client: CRAWLER_CLIENTS.googlebot });
      expect(lastHeaders['user-agent']).toBe(CRAWLER_CLIENTS.googlebot.userAgent);
      expect(lastHeaders.referer).toBeUndefined();
    });

    it('keeps the User-Agent and Referer on every hop; the secret header stays on the own site', async () => {
      const result = await runHttpCheck({
        allowPrivateTargets: true,
        url: `${base}/redirect-other`,
        headers: { 'x-dxt-monitor': 'secret' },
        client: CRAWLER_CLIENTS.google_referer,
      });
      expect(result).toMatchObject({ outcome: 'pass', finalUrl: `${other}/seen` });
      expect(lastHeaders['x-dxt-monitor']).toBe('secret');
      expect(otherHeaders['user-agent']).toBe(CRAWLER_CLIENTS.google_referer.userAgent);
      expect(otherHeaders.referer).toBe('https://www.google.com/');
      expect(otherHeaders['x-dxt-monitor']).toBeUndefined();
    });
  });

  it('fails on a 5xx (INC-0142: HTTP 504 at SIN)', async () => {
    expect(await runHttpCheck({ allowPrivateTargets: true, url: `${base}/down` })).toMatchObject({
      outcome: 'fail',
      statusCode: 504,
    });
  });

  it('marks a bot challenge as blocked, not failed', async () => {
    expect(await runHttpCheck({ allowPrivateTargets: true, url: `${base}/challenge` })).toMatchObject({
      outcome: 'blocked',
      statusCode: 403,
    });
  });

  it('fails on a timeout with the error "Timeout"', async () => {
    const result = await runHttpCheck({ allowPrivateTargets: true, url: `${base}/hang`, timeoutMs: 200 });
    expect(result).toMatchObject({ outcome: 'fail', statusCode: null, error: 'Timeout', finalUrl: null });
  });

  it('fails when the connection is refused', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));

    const result = await runHttpCheck({ allowPrivateTargets: true, url: `http://127.0.0.1:${port}/` });
    expect(result).toMatchObject({ outcome: 'fail', statusCode: null, error: 'ECONNREFUSED' });
  });

  it('follows a redirect on the same origin with the secret header', async () => {
    const result = await runHttpCheck({
      allowPrivateTargets: true,
      url: `${base}/redirect-same`,
      headers: { 'x-dxt-monitor': 'secret' },
    });
    expect(result).toMatchObject({ outcome: 'pass', statusCode: 200 });
    expect(lastHeaders['x-dxt-monitor']).toBe('secret');
  });

  it('never sends the secret header to the host a redirect points at', async () => {
    const result = await runHttpCheck({
      allowPrivateTargets: true,
      url: `${base}/redirect-other`,
      headers: { 'x-dxt-monitor': 'secret' },
    });
    expect(result).toMatchObject({ outcome: 'pass', statusCode: 200 });
    expect(otherHeaders['x-dxt-monitor']).toBeUndefined();
    expect(otherHeaders['user-agent']).toBe(PROBE_USER_AGENT);
  });

  it('gives up after 5 redirects', async () => {
    expect(await runHttpCheck({ allowPrivateTargets: true, url: `${base}/loop` })).toMatchObject({
      outcome: 'fail',
      error: 'Too many redirects',
    });
  });

  it('refuses private targets in a deployed probe (SSRF)', async () => {
    expect(await runHttpCheck({ url: `${base}/ok` })).toMatchObject({
      outcome: 'fail',
      statusCode: null,
      error: 'Target not allowed: port',
    });
    expect(await runHttpCheck({ url: 'http://169.254.169.254/latest/meta-data/' })).toMatchObject({
      error: 'Target not allowed: private or reserved address',
    });
    const rebound = await runHttpCheck({
      url: 'https://looks-public.example.test/',
      lookup: async () => [{ address: '10.0.0.5' }],
    });
    expect(rebound.error).toBe('Target not allowed: private or reserved address');
  });

  it('connects to the address its own lookup returned, one lookup per hop (D-040)', async () => {
    // `pinned.test` exists nowhere but this lookup: reaching the local server proves the connection
    // used the address that was resolved (and checked), not a second resolution.
    const asked: string[] = [];
    const port = new URL(base).port;
    const result = await runHttpCheck({
      allowPrivateTargets: true,
      url: `http://pinned.test:${port}/redirect-same`,
      lookup: async (host) => (asked.push(host), [{ address: '127.0.0.1' }]),
    });
    expect(result).toMatchObject({
      outcome: 'pass',
      statusCode: 200,
      finalUrl: `http://pinned.test:${port}/ok`,
    });
    // Two hops (the redirect and /ok), one lookup each — the guard and fetch used to resolve twice per hop.
    expect(asked).toEqual(['pinned.test', 'pinned.test']);
  });

  it('over https, a pinned connection still verifies the certificate against the hostname, not the address', async () => {
    // A self-signed certificate for `pinned.test` only (test fixture). The lookup pins 127.0.0.1;
    // TLS must still send SNI and check the name, so the same server is refused under another name.
    const fixtures = new URL('../test-fixtures/', import.meta.url);
    const cert = readFileSync(new URL('pinned.test.crt', fixtures), 'utf8');
    const tls = createHttpsServer(
      { key: readFileSync(new URL('pinned.test.key', fixtures)), cert },
      (_, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('ok'),
    );
    await new Promise<void>((r) => tls.listen(0, '127.0.0.1', r));
    const port = (tls.address() as AddressInfo).port;
    const check = (host: string) =>
      runHttpCheck({
        allowPrivateTargets: true,
        url: `https://${host}:${port}/`,
        lookup: async () => [{ address: '127.0.0.1' }],
        tlsCa: cert,
      });
    try {
      expect(await check('pinned.test')).toMatchObject({ outcome: 'pass', statusCode: 200 });
      expect((await check('other.test')).error).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    } finally {
      await new Promise((r) => tls.close(r));
    }
  });

  it('a DNS failure reads as its code, which the messages word as "DNS error"', async () => {
    const result = await runHttpCheck({
      url: 'https://gone.example.test/',
      lookup: () =>
        Promise.reject(
          Object.assign(new Error('getaddrinfo ENOTFOUND gone.example.test'), { code: 'ENOTFOUND' }),
        ),
    });
    expect(result).toMatchObject({ outcome: 'fail', error: 'ENOTFOUND' });
  });

  it('refuses at the connection when the host resolves to a private address, whatever the URL says', async () => {
    const result = await runHttpCheck({
      url: 'https://rebinds.example.test/',
      lookup: async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }],
    });
    expect(result).toMatchObject({
      outcome: 'fail',
      error: 'Target not allowed: private or reserved address',
    });
  });

  it('reads no body for a HEAD check', async () => {
    const result = await runHttpCheck({ allowPrivateTargets: true, url: `${base}/ok`, method: 'HEAD' });
    expect(result).toMatchObject({ outcome: 'pass', statusCode: 200, bodySample: '' });
  });

  it('counts DNS resolution against the timeout', async () => {
    const result = await runHttpCheck({
      url: 'https://slow-dns.example.test/',
      timeoutMs: 100,
      lookup: () => new Promise(() => {}),
    });
    expect(result).toMatchObject({ outcome: 'fail', error: 'Timeout' });
  });
});

describe('sameSite (where the WAF secret header may go)', () => {
  const first = new URL('http://site.example.test/');
  it.each([
    ['http://site.example.test/next', true],
    ['https://site.example.test/', true], // upgrade on default ports
    ['https://www.site.example.test/', false],
    ['http://other.example.test/', false],
    ['https://site.example.test:8443/', false],
  ])('%s → %s', (to, expected) => {
    expect(sameSite(new URL(to), first)).toBe(expected);
  });

  it('never follows a downgrade to plain http', () => {
    expect(sameSite(new URL('http://site.example.test/'), new URL('https://site.example.test/'))).toBe(false);
  });
});
