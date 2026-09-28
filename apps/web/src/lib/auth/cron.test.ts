import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnv, TEST_ENV } from '../../../test/env';
import { notImplemented } from './bearer';
import { cronHandler } from './cron';

beforeEach(() => stubServerEnv());
afterEach(() => vi.unstubAllEnvs());

const call = (authorization?: string) =>
  new Request('https://monitor.example.com/api/cron/engine', {
    headers: authorization ? { authorization } : {},
  });

describe('cronHandler', () => {
  it('runs the handler for Vercel Cron (Bearer CRON_SECRET)', async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const response = await cronHandler(handler)(call(`Bearer ${TEST_ENV.CRON_SECRET}`));
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('refuses a missing or wrong secret with 401 and never runs the handler', async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }));
    for (const header of [undefined, `Bearer ${TEST_ENV.INGEST_TOKEN}`]) {
      const response = await cronHandler(handler)(call(header));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
    }
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('notImplemented', () => {
  it('answers 501 naming the stub', async () => {
    const response = notImplemented('engine');
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: 'not_implemented', what: 'engine' });
  });
});
