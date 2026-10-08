import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROBE_USER_AGENT } from '@dxt/shared';
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

  it('keeps only the first 16 KB of the body', async () => {
    const result = await runHttpCheck({ allowPrivateTargets: true, url: `${base}/big` });
    expect(result.bodySample).toHaveLength(16_384);
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
    // Without keywords the sample stays 16 KB.
    expect(
      (await runHttpCheck({ allowPrivateTargets: true, url: `${base}/deep-keyword` })).bodySample,
    ).toHaveLength(16_384);
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

  it("checks no keywords without any, on HEAD, or on a response that didn't pass", async () => {
    const none = await runHttpCheck({ allowPrivateTargets: true, url: `${base}/ok` });
    expect(none).toMatchObject({ keywordMissing: null, keywordForbidden: null });
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
