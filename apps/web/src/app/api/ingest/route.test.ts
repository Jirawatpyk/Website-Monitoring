// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnv, TEST_ENV } from '../../../../test/env';

const m = vi.hoisted(() => ({
  after: vi.fn(),
  due: vi.fn(),
  store: vi.fn(),
  engine: vi.fn(),
}));
vi.mock('next/server', () => ({ after: m.after }));
vi.mock('@/server/db', () => ({ serviceDb: () => 'db' }));
vi.mock('@/server/ingest/bangkok', () => ({
  dueForBangkok: m.due,
  storeBangkokResults: m.store,
}));
vi.mock('@/server/engine/engine-and-deliver', () => ({ engineAfterReport: m.engine }));

const NOW = Date.parse('2026-10-07T03:00:30Z');
beforeEach(() => {
  stubServerEnv();
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  m.store.mockImplementation((_db: unknown, results: unknown[]) => Promise.resolve(results.length));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const TOKEN = `Bearer ${TEST_ENV.INGEST_TOKEN}`;
const result = (checkedAt: string, over: Record<string, unknown> = {}) => ({
  monitorId: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
  checkedAt,
  outcome: 'pass',
  statusCode: 200,
  responseMs: 120,
  ttfbMs: 80,
  resolvedIp: null,
  error: null,
  ...over,
});
const post = (body: unknown, authorization = TOKEN) =>
  new Request('https://monitor.dxt.example/api/ingest', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const get = (authorization?: string) =>
  new Request('https://monitor.dxt.example/api/ingest', {
    headers: authorization ? { authorization } : {},
  });

describe('POST /api/ingest (Bangkok probe)', () => {
  it.each([
    ['no token', ''],
    ['a wrong token', `Bearer ${'x'.repeat(32)}`],
  ])('refuses %s', async (_name, authorization) => {
    const { POST } = await import('./route');
    const res = await POST(post({ results: [result('2026-10-07T03:00:01Z')] }, authorization));
    expect(res.status).toBe(401);
    expect(m.store).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a batch', async () => {
    const { POST } = await import('./route');
    expect((await POST(post({ results: [{ monitorId: 'x' }] }))).status).toBe(400);
  });

  it.each([
    ['more than 5 min old', '2026-10-07T02:55:29Z'],
    ['more than 5 min ahead', '2026-10-07T03:05:31Z'],
  ])('refuses a batch with a result %s (replay, clock skew)', async (_name, checkedAt) => {
    const { POST } = await import('./route');
    const res = await POST(post({ results: [result('2026-10-07T03:00:01Z'), result(checkedAt)] }));
    expect(res.status).toBe(422);
    expect(m.store).not.toHaveBeenCalled();
  });

  it('stores the batch as Bangkok, then runs the engine after the response — even for a pass', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      post({ results: [result('2026-10-07T03:00:01Z', { location: 'SIN', attempt: 2 })] }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: 1 });
    const [, stored] = m.store.mock.calls[0] as [unknown, Record<string, unknown>[]];
    // The sender's location is dropped; the attempt is kept.
    expect(stored[0]).not.toHaveProperty('location');
    expect(stored[0]).toMatchObject({ attempt: 2 });

    expect(m.engine).not.toHaveBeenCalled();
    await (m.after.mock.calls[0] as [() => Promise<void>])[0]();
    expect(m.engine).toHaveBeenCalledWith('db', expect.anything(), NOW + 50_000, 'ingest');
  });

  it('passes the batch’s control check to the store (D-027)', async () => {
    const { POST } = await import('./route');
    const control = { ok: false };
    await POST(post({ results: [result('2026-10-07T03:00:01Z')], control }));
    expect(m.store.mock.calls[0]?.[3]).toEqual(control);
  });
});

describe('GET /api/ingest (monitors due for Bangkok)', () => {
  it('refuses a call without the token', async () => {
    const { GET } = await import('./route');
    expect((await GET(get())).status).toBe(401);
    expect(m.due).not.toHaveBeenCalled();
  });

  it('lists the monitors due this minute', async () => {
    const monitors = [{ id: 'm1', url: 'https://a.example.test', method: 'GET', timeoutMs: 10_000 }];
    m.due.mockResolvedValue(monitors);
    const { GET } = await import('./route');
    const res = await GET(get(TOKEN));
    expect(await res.json()).toEqual({ monitors });
    // No `?confirm=1`: an agent that doesn't echo the flag gets no D-051 confirm checks.
    expect(m.due).toHaveBeenCalledWith('db', new Date(NOW), false);
  });

  it('gives confirm checks only to an agent that asks with ?confirm=1 (D-051)', async () => {
    m.due.mockResolvedValue([]);
    const { GET } = await import('./route');
    const ask = (query: string) =>
      new Request(`https://monitor.example.test/api/ingest${query}`, { headers: get(TOKEN).headers });
    await GET(ask('?confirm=1'));
    expect(m.due).toHaveBeenLastCalledWith('db', new Date(NOW), true);
    await GET(ask('?confirm=true'));
    expect(m.due).toHaveBeenLastCalledWith('db', new Date(NOW), false);
  });
});
