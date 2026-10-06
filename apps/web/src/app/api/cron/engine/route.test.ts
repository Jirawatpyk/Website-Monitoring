// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnv, TEST_ENV } from '../../../../../test/env';

const mocks = vi.hoisted(() => ({ runEngine: vi.fn(), dispatch: vi.fn() }));
vi.mock('@/server/engine/run-engine', () => ({ runEngine: mocks.runEngine }));
vi.mock('@/server/db', () => ({ serviceDb: () => 'db' }));
vi.mock('@/server/notifier/dispatch', () => ({ dispatchNotifications: mocks.dispatch }));

beforeEach(() => {
  stubServerEnv();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  mocks.runEngine.mockResolvedValue({ ok: true, monitors: 1, opened: 0, recovered: 0, settled: 0 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const call = (authorization?: string) =>
  new Request('https://monitor.dxt.example/api/cron/engine', {
    headers: authorization ? { authorization } : {},
  });

describe('GET /api/cron/engine', () => {
  it('refuses a call without the cron secret', async () => {
    const { GET } = await import('./route');
    expect((await GET(call())).status).toBe(401);
    expect(mocks.runEngine).not.toHaveBeenCalled();
  });

  it('runs the engine with the service client', async () => {
    const { GET } = await import('./route');
    const res = await GET(call(`Bearer ${TEST_ENV.CRON_SECRET}`));
    expect(res.status).toBe(200);
    expect(mocks.runEngine).toHaveBeenCalledWith('db');
    expect(await res.json()).toMatchObject({ job: 'engine', ok: true, monitors: 1 });
  });

  it('sends right away what it queued, and only then', async () => {
    const { GET } = await import('./route');
    expect(mocks.dispatch).not.toHaveBeenCalled();
    mocks.runEngine.mockResolvedValue({ ok: true, monitors: 1, opened: 1, recovered: 0, settled: 0 });
    mocks.dispatch.mockResolvedValue({ ok: true, sent: 1, failed: 0 });
    const res = await GET(call(`Bearer ${TEST_ENV.CRON_SECRET}`));
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ db: 'db' }));
    expect(await res.json()).toMatchObject({ opened: 1, delivery: { sent: 1 } });
  });
});
