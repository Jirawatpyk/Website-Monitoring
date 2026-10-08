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

beforeEach(() => vi.clearAllMocks());

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
