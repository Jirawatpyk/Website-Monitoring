import { afterEach, describe, expect, it, vi } from 'vitest';
import * as m from './mutations';

const SWAP = '00000000-0000-4000-8000-0000000000c1';
const SHIFT = '00000000-0000-4000-8000-0000000000d1';
const OTHER = '00000000-0000-4000-8000-0000000000d2';
const ARM = '00000000-0000-4000-8000-0000000000a1';
const TOKEN = '00000000-0000-4000-8000-0000000000f1';
const db = (result: {
  data?: unknown;
  error?: { code?: string; hint?: string | null; message: string } | null;
}) => {
  const rpc = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }));
  return { db: { rpc } as never, rpc };
};

afterEach(() => vi.restoreAllMocks());

describe('on-call mutations (D-048, §27)', () => {
  it.each([
    [
      'saveRotation',
      () => m.saveRotation({ userIds: [ARM] }, ok),
      'save_oncall_rotation',
      { p_user_ids: [ARM] },
    ],
    [
      'requestSwap',
      () => m.requestSwap({ shiftId: SHIFT, withShiftId: OTHER, reason: ' Family trip ' }, ok),
      'request_oncall_swap',
      { p_shift_id: SHIFT, p_with_shift_id: OTHER, p_reason: 'Family trip' },
    ],
    [
      'respondSwap',
      () => m.respondSwap({ swapId: SWAP, accept: true }, ok),
      'respond_oncall_swap',
      { p_swap_id: SWAP, p_accept: true },
    ],
    [
      'decideSwap decline',
      () => m.decideSwap({ swapId: SWAP, approve: false, note: 'Two weeks in a row' }, ok),
      'decide_oncall_swap',
      { p_swap_id: SWAP, p_approve: false, p_note: 'Two weeks in a row' },
    ],
    ['withdrawSwap', () => m.withdrawSwap({ swapId: SWAP }, ok), 'withdraw_oncall_swap', { p_swap_id: SWAP }],
    [
      'handOver',
      () => m.handOver({ shiftId: SHIFT, to: ARM, at: '2026-09-25T11:00:00.000Z', reason: 'ill' }, ok),
      'hand_over_oncall_shift',
      { p_shift_id: SHIFT, p_to: ARM, p_reason: 'ill' },
    ],
    [
      'setChecklist',
      () => m.setChecklist({ mentionsOnly: true, dndAllowed: false }, ok),
      'set_oncall_checklist',
      { p_mentions_only: true, p_dnd_allowed: false },
    ],
    ['sendTest', () => m.sendTest({}, ok), 'send_oncall_test', undefined],
    ['confirmTest', () => m.confirmTest({ token: TOKEN }, ok), 'confirm_oncall_test', { p_token: TOKEN }],
  ] as const)('%s goes through its one RPC', async (_name, run, rpc, args) => {
    const r = await run();
    expect(r.ok).toBe(true);
    if (args) expect(ok.rpc).toHaveBeenLastCalledWith(rpc, expect.objectContaining(args));
    else expect(ok.rpc).toHaveBeenLastCalledWith(rpc);
  });
  const ok = db({ data: '2026-09-25T03:08:00Z' });

  it('sends no empty optional note, and an approval with none', async () => {
    const a = db({});
    await m.respondSwap({ swapId: SWAP, accept: false, note: '   ' }, a);
    expect(a.rpc).toHaveBeenCalledWith('respond_oncall_swap', { p_swap_id: SWAP, p_accept: false });
    await m.decideSwap({ swapId: SWAP, approve: true }, a);
    expect(a.rpc).toHaveBeenLastCalledWith('decide_oncall_swap', { p_swap_id: SWAP, p_approve: true });
  });

  it('refuses bad input before the database (zod at the boundary)', async () => {
    const a = db({});
    expect(await m.saveRotation({ userIds: [] }, a)).toEqual({
      ok: false,
      message: 'Add at least one person to the rotation',
    });
    expect(await m.decideSwap({ swapId: SWAP, approve: false, note: ' ' }, a)).toEqual({
      ok: false,
      message: 'Say why — both of them see this',
    });
    expect(await m.handOver({ shiftId: SHIFT, to: ARM, at: 'tonight', reason: 'x' }, a)).toMatchObject({
      ok: false,
    });
    expect(await m.requestSwap({ shiftId: 'x', withShiftId: OTHER }, a)).toMatchObject({ ok: false });
    expect(await m.confirmTest({ token: 'not-a-token' }, a)).toMatchObject({
      ok: false,
      code: 'test_expired',
    });
    expect(a.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: '42501', message: 'x' }, 'Only an Admin can change the rotation.'],
    [{ code: 'P0002', message: 'x' }, 'It no longer exists — reload the page.'],
    [{ code: '22023', hint: 'rotation_duplicate', message: 'x' }, 'Each person can be in the rotation once.'],
  ])('words a refusal: %o', async (error, message) => {
    expect(await m.saveRotation({ userIds: [ARM] }, db({ error }))).toEqual({ ok: false, message });
  });

  it('points a live-shift refusal at Hand over… on this page, not Users (D-048 item 5)', async () => {
    const r = await m.decideSwap(
      { swapId: SWAP, approve: true },
      db({
        error: {
          code: '22023',
          hint: 'swap_live',
          message: 'The live shift can’t be swapped — hand it over in Users',
        },
      }),
    );
    expect(r).toEqual({ ok: false, message: 'The live shift can’t be swapped — use Hand over… on its row.' });
  });

  it('logs a refusal it has no words for, and says try again', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await m.saveRotation(
      { userIds: [ARM] },
      db({ error: { code: '21000', message: 'DELETE requires a WHERE clause' } }),
    );
    expect(r).toEqual({ ok: false, message: 'Couldn’t save. Check your connection and try again.' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"event":"oncall_refusal"'));
  });

  it('tells someone else’s test link apart from an expired one (§27.8)', async () => {
    const other = await m.confirmTest(
      { token: TOKEN },
      db({
        error: {
          code: '42501',
          hint: 'test_other_person',
          message: 'This test was for Ploy — open it on Ploy’s phone.',
        },
      }),
    );
    expect(other).toEqual({
      ok: false,
      message: 'This test was for Ploy — open it on Ploy’s phone.',
      code: 'test_other_person',
    });
    const expired = await m.confirmTest({ token: TOKEN }, db({ error: { code: 'P0002', message: 'x' } }));
    expect(expired).toMatchObject({ ok: false, code: 'test_expired' });
  });
});
