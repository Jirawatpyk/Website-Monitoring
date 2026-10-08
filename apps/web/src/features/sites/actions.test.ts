// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  createSite: vi.fn(),
  updateSite: vi.fn(),
  setMonitoring: vi.fn(),
  deleteSite: vi.fn(),
  saveMonitors: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: vi.fn() }) }));
const access = vi.hoisted(() => ({ getAccess: vi.fn() }));
vi.mock('@/lib/auth/session', () => access);
vi.mock('./mutations', () => ({
  createSite: m.createSite,
  updateSite: m.updateSite,
  setMonitoring: m.setMonitoring,
  deleteSite: m.deleteSite,
  saveMonitors: m.saveMonitors,
}));

const actions = await import('./actions');
const OK = { ok: true, siteId: 's1' };
const NO = { ok: false, message: 'no' };

beforeEach(() => {
  vi.clearAllMocks();
  access.getAccess.mockResolvedValue({
    status: 'active',
    profile: { id: 'u', email: 'a@x.test', displayName: 'Tao', role: 'admin' },
  });
});

describe('Sites Server Actions', () => {
  it.each([
    ['createSite', () => actions.createSite({} as never), m.createSite],
    ['updateSite', () => actions.updateSite({} as never), m.updateSite],
    ['setSiteMonitoring', () => actions.setSiteMonitoring('s1', true), m.setMonitoring],
    ['saveMonitors', () => actions.saveMonitors({} as never), m.saveMonitors],
  ] as const)('%s refreshes the Sites pages only after a success', async (_, call, mutation) => {
    mutation.mockResolvedValueOnce(OK);
    expect(await call()).toEqual(OK);
    expect(m.revalidatePath).toHaveBeenCalledWith('/sites');
    expect(m.revalidatePath).toHaveBeenCalledWith('/sites/s1', 'layout');
    m.revalidatePath.mockClear();
    mutation.mockResolvedValueOnce(NO);
    expect(await call()).toEqual(NO);
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  // Security review L2: nobody but an Admin gets as far as zod or a DNS lookup.
  it('refuses anyone but an Admin before doing anything', async () => {
    access.getAccess.mockResolvedValue({
      status: 'active',
      profile: { id: 'u', email: 'v@x.test', displayName: 'V', role: 'viewer' },
    });
    for (const call of [
      () => actions.createSite({} as never),
      () => actions.updateSite({} as never),
      () => actions.setSiteMonitoring('s1', true),
      () => actions.deleteSite('s1'),
      () => actions.saveMonitors({} as never),
    ]) {
      expect(await call()).toEqual({ ok: false, message: 'Only an Admin can change sites and monitors.' });
    }
    expect(m.createSite).not.toHaveBeenCalled();
    expect(m.saveMonitors).not.toHaveBeenCalled();
  });

  it('deleteSite refreshes the list only', async () => {
    m.deleteSite.mockResolvedValueOnce(OK);
    await actions.deleteSite('s1');
    expect(m.revalidatePath.mock.calls).toEqual([['/sites']]);
    m.revalidatePath.mockClear();
    m.deleteSite.mockResolvedValueOnce(NO);
    await actions.deleteSite('s1');
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});
