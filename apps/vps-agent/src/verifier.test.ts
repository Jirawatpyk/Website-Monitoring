import { describe, expect, it, vi } from 'vitest';
import type { Api, LeasedJob } from './api';
import { createVerifierPool, judgeVisit, verifyJob, type PageBrowser, type PageVisit } from './verifier';

const visit = (over: Partial<PageVisit> = {}): PageVisit => ({
  status: 200,
  headers: {},
  html: '<html><body><h1>Tubtong</h1></body></html>',
  screenshot: new Uint8Array([0xff, 0xd8]),
  ...over,
});
const job = (over: Partial<LeasedJob> = {}): LeasedJob => ({
  id: 'j1',
  kind: 'verify',
  url: 'https://tubtong.example.test',
  mustContain: ['Tubtong'],
  upload: { url: 'https://storage.example.test/upload/sign/2026-10/j1.jpg?token=t', path: '2026-10/j1.jpg' },
  ...over,
});
const fakeApi = (accepted = true): Api => ({
  dueMonitors: vi.fn(),
  postResults: vi.fn(),
  leaseJobs: vi.fn(async () => []),
  completeJob: vi.fn(async () => accepted),
});
const browserOf = (v: PageVisit | Error): PageBrowser => ({
  visit: vi.fn(async () => {
    if (v instanceof Error) throw v;
    return v;
  }),
});
const quiet = () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
};

describe('judgeVisit (StatusModel, D-020)', () => {
  it.each<[string, Partial<PageVisit>, string[], string, string | null]>([
    ['page loads, keyword found → loaded', {}, ['Tubtong'], 'loaded', null],
    ['keyword missing → failed', {}, ['Book now'], 'failed', 'Keyword missing: Book now'],
    ['5xx → failed', { status: 503, html: 'Service Unavailable' }, [], 'failed', 'HTTP 503'],
    ['nothing answered → failed', { status: null }, [], 'failed', 'No response'],
    [
      'a challenge page in the browser too → blocked, not failed',
      { status: 403, html: '<title>Just a moment...</title>' },
      [],
      'blocked',
      'Bot protection in the browser too (HTTP 403)',
    ],
    [
      'an Akamai "Access Denied" → blocked',
      { status: 403, html: '<H1>Access Denied</H1>' },
      [],
      'blocked',
      'Bot protection in the browser too (HTTP 403)',
    ],
    [
      'a Cloudflare mitigation header → blocked',
      { status: 429, headers: { 'cf-mitigated': 'challenge' }, html: '' },
      [],
      'blocked',
      'Bot protection in the browser too (HTTP 429)',
    ],
    [
      'a plain 403 without a WAF signature → failed',
      { status: 403, html: 'Forbidden' },
      [],
      'failed',
      'HTTP 403',
    ],
  ])('%s', (_name, over, mustContain, result, detail) => {
    expect(judgeVisit(visit(over), mustContain)).toEqual({ result, detail });
  });
});

describe('verifyJob', () => {
  it('opens the page in 20 s, uploads the screenshot to the signed URL and reports', async () => {
    quiet();
    const api = fakeApi();
    const browser = browserOf(visit());
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    expect(await verifyJob(job(), { api, browser, fetchImpl })).toBe(true);
    expect(browser.visit).toHaveBeenCalledWith('https://tubtong.example.test', 20_000);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://storage.example.test/upload/sign/2026-10/j1.jpg?token=t',
      expect.objectContaining({ method: 'PUT', headers: { 'content-type': 'image/jpeg' } }),
    );
    expect(api.completeJob).toHaveBeenCalledWith({
      jobId: 'j1',
      result: 'loaded',
      detail: null,
      httpStatus: 200,
      screenshot: true,
    });
  });

  it.each([
    ['a timeout', new Error('page.goto: Timeout 20000ms exceeded.'), 'Page didn’t load in 20 s'],
    [
      'a DNS error',
      new Error('net::ERR_NAME_NOT_RESOLVED at https://x\n  stack'),
      'net::ERR_NAME_NOT_RESOLVED at https://x',
    ],
  ])('reports %s as failed, with no screenshot', async (_name, err, detail) => {
    quiet();
    const api = fakeApi();
    const fetchImpl = vi.fn();
    await verifyJob(job(), { api, browser: browserOf(err), fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(api.completeJob).toHaveBeenCalledWith({
      jobId: 'j1',
      result: 'failed',
      detail,
      httpStatus: null,
      screenshot: false,
    });
  });

  it.each([
    ['the upload is refused', async () => new Response(null, { status: 400 })],
    ['the upload throws', async () => Promise.reject(new Error('reset'))],
  ])('still reports the verdict when %s', async (_name, impl) => {
    quiet();
    const api = fakeApi();
    await verifyJob(job(), { api, browser: browserOf(visit()), fetchImpl: vi.fn(impl) });
    expect(api.completeJob).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'loaded', screenshot: false }),
    );
  });

  it('skips the upload without a signed URL, and passes on a refused (late) verdict', async () => {
    quiet();
    const fetchImpl = vi.fn();
    expect(
      await verifyJob(job({ upload: null }), { api: fakeApi(false), browser: browserOf(visit()), fetchImpl }),
    ).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('createVerifierPool (at most N sessions, PRD §5)', () => {
  it('leases only as many jobs as there are free sessions, and beats even when full', async () => {
    quiet();
    const api = fakeApi();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const browser: PageBrowser = { visit: vi.fn(async () => (await gate, visit())) };
    vi.mocked(api.leaseJobs)
      .mockResolvedValueOnce([job({ id: 'a' }), job({ id: 'b' })])
      .mockResolvedValue([]);
    const pool = createVerifierPool({ api, browser, fetchImpl: vi.fn(async () => new Response()) }, 2);

    expect(await pool.poll()).toBe(2);
    expect(api.leaseJobs).toHaveBeenLastCalledWith(2, 0);
    expect(pool.active).toBe(2);
    await pool.poll();
    expect(api.leaseJobs).toHaveBeenLastCalledWith(0, 2);

    release();
    await pool.drain();
    expect(pool.active).toBe(0);
    expect(api.completeJob).toHaveBeenCalledTimes(2);
  });

  it('a job that throws frees its session', async () => {
    quiet();
    const api = fakeApi();
    vi.mocked(api.completeJob).mockRejectedValue(new Error('500'));
    vi.mocked(api.leaseJobs).mockResolvedValueOnce([job()]);
    const pool = createVerifierPool(
      { api, browser: browserOf(visit()), fetchImpl: vi.fn(async () => new Response()) },
      1,
    );
    await pool.poll();
    await pool.drain();
    expect(pool.active).toBe(0);
  });
});
