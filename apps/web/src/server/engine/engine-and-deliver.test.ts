// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fake-db';
import { TEST_ENV } from '../../../test/env';
import type { ServerEnv } from '@/lib/env';
import { engineAfterReport } from './engine-and-deliver';

const env = TEST_ENV as unknown as ServerEnv;

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
