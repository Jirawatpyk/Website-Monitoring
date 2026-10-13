// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fake-db';
import { TEST_ENV } from '../../../test/env';
import type { ServerEnv } from '@/lib/env';
import { engineAfterReport, engineAndDeliver } from './engine-and-deliver';

const env = TEST_ENV as unknown as ServerEnv;

describe('engineAndDeliver', () => {
  it.each([
    ['on', true],
    ['off', false],
  ] as const)(
    'DEFACEMENT_ALERTS=%s reaches the engine as defacementAlerts: %s (D-042)',
    async (value, on) => {
      const engine = vi.fn().mockResolvedValue({ ok: true, notified: 0, alerts: 0 });
      const { db } = fakeDb();
      await engineAndDeliver(db, { ...env, DEFACEMENT_ALERTS: value }, 1, engine);
      expect(engine).toHaveBeenCalledWith(db, expect.any(Date), { defacementAlerts: on });
    },
  );
});

describe('engineAfterReport', () => {
  it('logs the run after a VPS report, and logs a failure without throwing', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = fakeDb();
    const run = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, opened: 1 })
      .mockRejectedValueOnce(new Error('down'));
    await engineAfterReport(db, env, 1, 'ingest', run);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"source":"ingest","ok":true,"opened":1'));
    await engineAfterReport(db, env, 1, 'jobs', run);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('engine_after_report_failed'));
    info.mockRestore();
    error.mockRestore();
  });
});
