import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROBE_USER_AGENT } from '@dxt/shared';
import { runHttpCheck } from './http-check';

// A local server that answers per path, so every outcome is tested over real HTTP.
let server: Server;
let base: string;
let lastHeaders: IncomingHttpHeaders = {};

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
      case '/hang':
        break; // never answers
      default:
        res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe('runHttpCheck', () => {
  it('passes a 200 and records status, timings and the body sample', async () => {
    const result = await runHttpCheck({ url: `${base}/ok` });
    expect(result).toMatchObject({ outcome: 'pass', statusCode: 200, error: null });
    expect(result.responseMs).toBeGreaterThanOrEqual(0);
    expect(result.ttfbMs).toBeGreaterThanOrEqual(0);
    expect(result.bodySample).toContain('Welcome');
  });

  it('sends the identifying User-Agent and the WAF secret header', async () => {
    await runHttpCheck({ url: `${base}/ok`, headers: { 'x-dxt-monitor': 'secret' } });
    expect(lastHeaders['user-agent']).toBe(PROBE_USER_AGENT);
    expect(lastHeaders['x-dxt-monitor']).toBe('secret');
  });

  it('keeps only the first 16 KB of the body', async () => {
    const result = await runHttpCheck({ url: `${base}/big` });
    expect(result.bodySample).toHaveLength(16_384);
  });

  it('fails on a 5xx (INC-0142: HTTP 504 at SIN)', async () => {
    expect(await runHttpCheck({ url: `${base}/down` })).toMatchObject({ outcome: 'fail', statusCode: 504 });
  });

  it('marks a bot challenge as blocked, not failed', async () => {
    expect(await runHttpCheck({ url: `${base}/challenge` })).toMatchObject({
      outcome: 'blocked',
      statusCode: 403,
    });
  });

  it('fails on a timeout with the error "Timeout"', async () => {
    const result = await runHttpCheck({ url: `${base}/hang`, timeoutMs: 200 });
    expect(result).toMatchObject({ outcome: 'fail', statusCode: null, error: 'Timeout' });
  });

  it('fails when the connection is refused', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));

    const result = await runHttpCheck({ url: `http://127.0.0.1:${port}/` });
    expect(result).toMatchObject({ outcome: 'fail', statusCode: null, error: 'ECONNREFUSED' });
  });
});
