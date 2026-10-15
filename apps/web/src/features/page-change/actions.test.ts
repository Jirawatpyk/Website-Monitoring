// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: m.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));

const { acceptBaseline, undoBaseline } = await import('./actions');
const CHECK = '7c481a3b-6979-4c48-97eb-50a8d27c4e41';
const MONITOR = '1b2c3d4e-6979-4c48-97eb-50a8d27c4e41';

afterEach(() => vi.clearAllMocks());

describe('acceptBaseline (spec §26.5, D-046 item 9)', () => {
  it('accepts through the SQL function and says when it applies', async () => {
    m.rpc.mockResolvedValue({ data: '2026-10-15T03:07:10Z', error: null });
    expect(await acceptBaseline({ checkId: CHECK, reason: '  Client redesign  ' })).toEqual({
      ok: true,
      appliesAt: '2026-10-15T03:07:10Z',
    });
    expect(m.rpc).toHaveBeenCalledWith('accept_page_baseline', {
      p_check_id: CHECK,
      p_reason: 'Client redesign',
    });
    expect(m.revalidatePath).toHaveBeenCalledWith('/incidents', 'layout');
    expect(m.revalidatePath).toHaveBeenCalledWith('/sites', 'layout');
  });

  it('asks for a reason before any round trip, and refuses a bad fetch id', async () => {
    expect(await acceptBaseline({ checkId: CHECK, reason: '   ' })).toMatchObject({
      ok: false,
      field: 'reason',
    });
    expect(await acceptBaseline({ checkId: 'nope', reason: 'x' })).toEqual({
      ok: false,
      message: 'This fetch can’t become the baseline.',
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: '42501', message: 'x' }, 'Only an Admin can accept a new baseline.'],
    [
      { code: '55000', message: 'A new baseline is already waiting to apply' },
      'A new baseline is already waiting to apply',
    ],
    [{ code: 'XX000', message: 'boom' }, 'Couldn’t reach the server. Check your connection and try again.'],
  ])('a refusal %o reads "%s"', async (error, message) => {
    m.rpc.mockResolvedValue({ data: null, error });
    expect(await acceptBaseline({ checkId: CHECK, reason: 'x' })).toMatchObject({ ok: false, message });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it('a reason refused by the SQL marks the field', async () => {
    m.rpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'Type a reason', hint: 'reason_required' },
    });
    expect(await acceptBaseline({ checkId: CHECK, reason: 'x' })).toEqual({
      ok: false,
      message: 'Type a reason',
      field: 'reason',
    });
  });
});

describe('undoBaseline', () => {
  it('undoes through the SQL function', async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    expect(await undoBaseline(MONITOR)).toEqual({ ok: true });
    expect(m.rpc).toHaveBeenCalledWith('undo_page_baseline', { p_monitor_id: MONITOR });
  });

  it.each([
    [{ code: '42501' }, 'Only the person who accepted it can undo it.'],
    [{ code: '55000' }, 'Too late to undo — the new baseline applies now.'],
    [{ code: 'XX000' }, 'Couldn’t reach the server. Check your connection and try again.'],
  ])('a refusal %o reads "%s"', async (error, message) => {
    m.rpc.mockResolvedValue({ data: null, error: { message: '', ...error } });
    expect(await undoBaseline(MONITOR)).toEqual({ ok: false, message });
  });

  it('refuses a bad monitor id', async () => {
    expect(await undoBaseline('nope')).toEqual({ ok: false, message: 'Nothing to undo.' });
  });
});
