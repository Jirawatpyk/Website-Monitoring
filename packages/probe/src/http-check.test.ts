import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROBE_USER_AGENT } from '@dxt/shared';
import { runHttpCheck } from './http-check';

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
    expect(result).toMatchObject({ outcome: 'fail', statusCode: null, error: 'Timeout' });
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
});
