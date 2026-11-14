import { describe, expect, it, vi } from 'vitest';
import {
  changeUserRole,
  deactivateUser,
  inviteUser,
  PROBLEM_WORDS,
  revokeInvite,
  setChatId,
  type UsersDeps,
} from './mutations';

const U1 = '6f9c3c1e-6c8e-4a7f-9a55-1b2c3d4e5f60';
const S1 = '0b8a6c1e-2d3f-4a5b-8c7d-9e0f1a2b3c4d';

function db(result: { data?: unknown; error?: { code?: string; hint?: string; message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { deps: { db: { rpc } } as unknown as UsersDeps, rpc };
}

describe('users mutations (S16, D-062)', () => {
  it('invite: lower-cased, the role, and what the SQL did', async () => {
    const { deps, rpc } = db({ data: 'reactivated' });
    expect(await inviteUser({ email: ' New@DXT.test ', role: 'viewer' }, deps)).toEqual({
      ok: true,
      outcome: 'reactivated',
    });
    expect(rpc).toHaveBeenCalledWith('invite_user', { p_email: 'new@dxt.test', p_role: 'viewer' });
  });

  it('invite: a malformed address never reaches the database', async () => {
    const { deps, rpc } = db({});
    expect(await inviteUser({ email: 'not an address', role: 'viewer' }, deps)).toEqual({
      ok: false,
      message: 'Enter their primary Google address, e.g. name@company',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('revoke needs a reason', async () => {
    const { deps, rpc } = db({});
    expect(await revokeInvite({ email: 'a@b', reason: '  ' }, deps)).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a role change sends the picks as they are', async () => {
    const { deps, rpc } = db({});
    const reassign = { owners: { [S1]: U1 }, shifts: U1 };
    expect(await changeUserRole({ userId: U1, role: 'stakeholder', reassign }, deps)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('change_user_role', {
      p_user_id: U1,
      p_role: 'stakeholder',
      p_reassign: reassign,
    });
  });

  it('a pick that isn’t a person is refused here', async () => {
    const { deps, rpc } = db({});
    const r = await deactivateUser({ userId: U1, reassign: { am: 'Tao' } as never }, deps);
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('an empty Chat id clears it', async () => {
    const { deps, rpc } = db({});
    await setChatId({ userId: U1, chatId: '' }, deps);
    expect(rpc).toHaveBeenCalledWith('set_chat_user_id', { p_user_id: U1, p_chat_id: '' });
    expect(await setChatId({ userId: U1, chatId: '12a' }, deps)).toEqual({
      ok: false,
      message: 'A Chat user id is digits only',
    });
  });

  it.each(Object.entries(PROBLEM_WORDS))('hint %s → its words', async (hint, words) => {
    const { deps } = db({ error: { code: '22023', hint, message: 'raw' } });
    expect(await deactivateUser({ userId: U1, reassign: {} }, deps)).toMatchObject({
      ok: false,
      message: words,
    });
  });

  it('needs_reassign and a missing person ask for a reload', async () => {
    const stale = db({ error: { code: '55000', hint: 'needs_reassign', message: 'raw' } });
    expect(await deactivateUser({ userId: U1, reassign: {} }, stale.deps)).toMatchObject({ stale: true });
    const gone = db({ error: { code: 'P0002', message: 'raw' } });
    expect(await deactivateUser({ userId: U1, reassign: {} }, gone.deps)).toEqual({
      ok: false,
      message: 'They no longer have access — reload the page.',
      stale: true,
    });
  });

  it.each(['40P01', '55P03'])('%s: two changes at once → try again', async (code) => {
    const { deps } = db({ error: { code, message: 'deadlock detected' } });
    expect(await deactivateUser({ userId: U1, reassign: {} }, deps)).toEqual({
      ok: false,
      message: 'Someone else changed this at the same time — try again.',
    });
  });

  it('42501 → only an Admin; anything else → the generic line, logged', async () => {
    const denied = db({ error: { code: '42501', message: 'raw' } });
    expect(await revokeInvite({ email: 'a@b', reason: 'x' }, denied.deps)).toEqual({
      ok: false,
      message: 'Only an Admin can change people’s access.',
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const odd = db({ error: { code: 'XX000', message: 'boom' } });
    expect(await revokeInvite({ email: 'a@b', reason: 'x' }, odd.deps)).toEqual({
      ok: false,
      message: 'Couldn’t save. Check your connection and try again.',
    });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
