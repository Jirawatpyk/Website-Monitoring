// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnv } from '../../../test/env';

const mocks = vi.hoisted(() => ({ runProbe: vi.fn() }));
vi.mock('./run-probe', () => ({ runProbe: mocks.runProbe }));
vi.mock('../db', () => ({ serviceDb: () => 'db' }));

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
});
