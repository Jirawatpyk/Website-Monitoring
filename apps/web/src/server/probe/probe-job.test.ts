// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnv } from '../../../test/env';

const mocks = vi.hoisted(() => ({ runProbe: vi.fn(), engine: vi.fn() }));
vi.mock('./run-probe', () => ({ runProbe: mocks.runProbe, PROBE_BUDGET_MS: 85_000 }));
vi.mock('../db', () => ({ serviceDb: () => 'db' }));
vi.mock('../engine/engine-and-deliver', () => ({ engineAndDeliver: mocks.engine }));

beforeEach(() => {
  vi.resetModules();
  stubServerEnv();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  mocks.runProbe.mockResolvedValue({ ok: true, checked: 0 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('probeJob', () => {
  it('passes the secret header and the Vercel region to the probe', async () => {
    vi.stubEnv('PROBE_SECRET_HEADER_VALUE', 'secret');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_REGION', 'hnd1');
    const { probeJob } = await import('./probe-job');
    const res = await probeJob('TYO');
    expect(mocks.runProbe).toHaveBeenCalledWith({
      db: 'db',
      location: 'TYO',
      secretHeader: { name: 'X-DxT-Monitor', value: 'secret' },
      vercel: { region: 'hnd1' },
      allowPrivateTargets: false,
    });
    expect(await res.json()).toMatchObject({ job: 'probe-tyo', region: 'hnd1', ok: true });
  });

  it('allows private targets only off Vercel with the explicit opt-in', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('PROBE_ALLOW_PRIVATE_TARGETS', '1');
    let { probeJob } = await import('./probe-job');
    await probeJob('SIN');
    expect(mocks.runProbe).toHaveBeenLastCalledWith(expect.objectContaining({ allowPrivateTargets: false }));
    vi.stubEnv('VERCEL', '');
    vi.resetModules();
    ({ probeJob } = await import('./probe-job'));
    await probeJob('SIN');
    expect(mocks.runProbe).toHaveBeenLastCalledWith(expect.objectContaining({ allowPrivateTargets: true }));
  });

  it('sends no secret header when none is configured, and skips the region check off Vercel', async () => {
    vi.stubEnv('VERCEL', '');
    const { probeJob } = await import('./probe-job');
    await probeJob('SIN');
    expect(mocks.runProbe).toHaveBeenCalledWith(
      expect.objectContaining({ secretHeader: undefined, vercel: null }),
    );
  });

  describe('runs the engine right after a failed recheck (PRD §9: alert within 30 s of the confirm)', () => {
    it('runs it, with the probe’s own deadline, when a recheck failed', async () => {
      mocks.runProbe.mockResolvedValue({ ok: true, checked: 1, failed: 1, rechecked: 1, recheckFailed: 1 });
      mocks.engine.mockResolvedValue({ ok: true, opened: 1 });
      const { probeJob } = await import('./probe-job');
      const res = await probeJob('SIN', () => 1_000);
      expect(mocks.engine).toHaveBeenCalledWith('db', expect.anything(), 86_000);
      expect(await res.json()).toMatchObject({ ok: true, recheckFailed: 1, engine: { opened: 1 } });
    });

    it('skips it when every recheck passed, or too little time is left', async () => {
      mocks.runProbe.mockResolvedValue({ ok: true, checked: 1, failed: 1, rechecked: 1, recheckFailed: 0 });
      const { probeJob } = await import('./probe-job');
      await probeJob('SIN');
      mocks.runProbe.mockResolvedValue({ ok: true, recheckFailed: 1 });
      const times = [0, 70_000];
      await probeJob('SIN', () => times.shift() ?? 70_000);
      expect(mocks.engine).not.toHaveBeenCalled();
    });

    it('keeps the probe green when the engine fails (the engine cron retries)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.runProbe.mockResolvedValue({ ok: true, recheckFailed: 2 });
      mocks.engine.mockRejectedValue(new Error('db down'));
      const { probeJob } = await import('./probe-job');
      const res = await probeJob('TYO');
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, engine: { ok: false } });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('probe_engine_trigger_failed'));
    });
  });
});
