// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnv, TEST_ENV } from '../../../../test/env';
import type * as Jobs from '@/server/verifier/jobs';

const m = vi.hoisted(() => ({ after: vi.fn(), lease: vi.fn(), complete: vi.fn(), engine: vi.fn() }));
vi.mock('next/server', () => ({ after: m.after }));
vi.mock('@/server/db', () => ({ serviceDb: () => 'db' }));
vi.mock('@/server/engine/engine-and-deliver', () => ({ engineAfterReport: m.engine }));
vi.mock('@/server/verifier/jobs', async (original) => ({
  ...(await original<typeof Jobs>()),
  leaseJobs: m.lease,
  completeJob: m.complete,
}));

beforeEach(() => stubServerEnv());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const TOKEN = `Bearer ${TEST_ENV.INGEST_TOKEN}`;
const get = (query = '', authorization = TOKEN) =>
  new Request(`https://monitor.dxt.example/api/jobs${query}`, { headers: { authorization } });
const post = (body: unknown, authorization = TOKEN) =>
  new Request('https://monitor.dxt.example/api/jobs', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const verdict = { jobId: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f', result: 'loaded', screenshot: true };

describe('GET /api/jobs (lease)', () => {
  it('refuses a wrong token (Done-when 4)', async () => {
    const { GET } = await import('./route');
    expect((await GET(get('', `Bearer ${'x'.repeat(32)}`))).status).toBe(401);
    expect(m.lease).not.toHaveBeenCalled();
  });

  it('refuses a poll for more than 3 jobs', async () => {
    const { GET } = await import('./route');
    expect((await GET(get('?max=9'))).status).toBe(400);
  });

  it('leases jobs', async () => {
    m.lease.mockResolvedValue([{ id: 'j1' }]);
    const { GET } = await import('./route');
    const res = await GET(get('?max=2&sessions=1'));
    expect(await res.json()).toEqual({ jobs: [{ id: 'j1' }] });
    expect(m.lease).toHaveBeenCalledWith('db', { max: 2, sessions: 1 }, expect.any(Date));
  });
});

describe('POST /api/jobs (result)', () => {
  it('refuses a wrong token (Done-when 4)', async () => {
    const { POST } = await import('./route');
    expect((await POST(post(verdict, 'Bearer nope'))).status).toBe(401);
    expect(m.complete).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a verdict', async () => {
    const { POST } = await import('./route');
    expect((await POST(post({ ...verdict, result: 'maybe' }))).status).toBe(400);
  });

  it('refuses a verdict after the lease ran out with 409 (Done-when 4)', async () => {
    m.complete.mockResolvedValue({ ok: false });
    const { POST } = await import('./route');
    const res = await POST(post(verdict));
    expect(res.status).toBe(409);
    expect(m.after).not.toHaveBeenCalled();
  });

  it('records a verify verdict, then judges its round after the response', async () => {
    m.complete.mockResolvedValue({ ok: true, kind: 'verify' });
    const { POST } = await import('./route');
    expect((await POST(post(verdict))).status).toBe(200);
    await (m.after.mock.calls[0] as [() => Promise<void>])[0]();
    expect(m.engine).toHaveBeenCalledWith('db', expect.anything(), expect.any(Number), 'jobs');
  });

  it('an evidence screenshot needs no engine run', async () => {
    m.complete.mockResolvedValue({ ok: true, kind: 'evidence' });
    const { POST } = await import('./route');
    expect((await POST(post(verdict))).status).toBe(200);
    expect(m.after).not.toHaveBeenCalled();
  });
});
