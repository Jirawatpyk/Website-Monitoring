import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from './api';
import { ping } from './healthchecks';

const TOKEN = 't'.repeat(32);
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const MONITOR = {
  id: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
  url: 'https://a.example.test/',
  method: 'GET',
  timeoutMs: 10_000,
};
const JOB = {
  id: '7a1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
  kind: 'verify',
  url: 'https://a.example.test/',
  mustContain: [],
  upload: null,
};

afterEach(() => vi.restoreAllMocks());

describe('createApi — the only way out of the VPS (PRD §10)', () => {
  it('asks for due monitors with the bearer token, at API_BASE_URL only', async () => {
    const fetchImpl = vi.fn(async () => ok({ monitors: [MONITOR] }));
    const api = createApi('https://monitor.example.test', TOKEN, fetchImpl);
    expect(await api.dueMonitors()).toEqual([MONITOR]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://monitor.example.test/api/ingest');
    expect(init.headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
  });

  it('posts results and leases jobs', async () => {
    const fetchImpl = vi.fn(async (url: URL) =>
      url.pathname === '/api/jobs' ? ok({ jobs: [JOB] }) : ok({ ok: true }),
    );
    const api = createApi('https://monitor.example.test', TOKEN, fetchImpl as unknown as typeof fetch);
    await api.postResults([]);
    expect(await api.leaseJobs(2, 1)).toEqual([JOB]);
    const [leaseUrl] = fetchImpl.mock.calls[1] as unknown as [URL];
    expect(leaseUrl.search).toBe('?max=2&sessions=1');
    const [, postInit] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(postInit).toMatchObject({ method: 'POST', body: '{"results":[]}' });
  });

  it('refuses a response that doesn’t match the shared shape (no silent misread)', async () => {
    const api = createApi(
      'https://m.example.test',
      TOKEN,
      vi.fn(async () => ok({ jobs: [{ id: 'j1' }] })),
    );
    await expect(api.leaseJobs(1, 0)).rejects.toThrow();
  });

  it('reports a verdict: true when taken, false after the lease ran out (409)', async () => {
    const verdict = {
      jobId: 'j1',
      result: 'loaded' as const,
      detail: null,
      httpStatus: 200,
      screenshot: true,
    };
    const taken = createApi(
      'https://m.example.test',
      TOKEN,
      vi.fn(async () => ok({ ok: true })),
    );
    expect(await taken.completeJob(verdict)).toBe(true);
    const late = createApi(
      'https://m.example.test',
      TOKEN,
      vi.fn(async () => new Response(null, { status: 409 })),
    );
    expect(await late.completeJob(verdict)).toBe(false);
    const broken = createApi(
      'https://m.example.test',
      TOKEN,
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    await expect(broken.completeJob(verdict)).rejects.toThrow(ApiError);
  });

  it('throws on any other refusal, naming the route and status — never the token', async () => {
    const api = createApi(
      'https://m.example.test',
      TOKEN,
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    const err = await api.dueMonitors().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(String(err)).toBe('Error: /api/ingest answered 401');
    expect(String(err)).not.toContain(TOKEN);
    await expect(api.leaseJobs(1, 0)).rejects.toThrow('/api/jobs answered 401');
  });
});

describe('ping (Healthchecks)', () => {
  it('pings ok or /fail, skips without a URL, and never throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response());
    await ping('https://hc-ping.example.test/abc/', 'fail', fetchImpl);
    await ping('https://hc-ping.example.test/abc', 'ok', fetchImpl);
    await ping(undefined, 'ok', fetchImpl);
    expect(fetchImpl.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
      'https://hc-ping.example.test/abc/fail',
      'https://hc-ping.example.test/abc',
    ]);
    await expect(
      ping(
        'https://hc-ping.example.test/abc',
        'ok',
        vi.fn(async () => Promise.reject(new Error('x'))),
      ),
    ).resolves.toBeUndefined();
  });
});
