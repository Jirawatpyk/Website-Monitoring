import { describe, expect, it, vi } from 'vitest';
import * as m from './mutations';

const SITE = '00000000-0000-4000-8000-0000000000a1';
const WIN = '00000000-0000-4000-8000-0000000000e1';
const db = (result: {
  data?: unknown;
  error?: { code?: string; hint?: string | null; message: string } | null;
}) => {
  const rpc = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }));
  // create_maintenance reads back whether the window waits for an Admin (and names the Admins); a
  // held action reads when its messages go.
  const chain = {
    eq: () => chain,
    order: async () => ({ data: [{ display_name: 'Tao' }], error: null }),
    maybeSingle: async () => ({
      data: { approved_at: null, undo_until: '2026-09-25T07:07:10.000Z' },
      error: null,
    }),
  };
  const from = () => ({ select: () => chain });
  return { db: { rpc, from } as never, rpc };
};
const at = '2026-09-25T07:07:00.000Z';

describe('maintenance mutations (D-036)', () => {
  it('each change goes through its one RPC', async () => {
    const cases: [() => Promise<m.WindowResult>, string, Record<string, unknown>][] = [];
    const a = db({ data: WIN });
    cases.push([
      () => m.createMaintenance({ siteId: SITE, startsAt: at, endsAt: at, reason: 'x' }, a),
      'create_maintenance',
      { p_site_id: SITE, p_reason: 'x' },
    ]);
    for (const [run, name, args] of cases) {
      expect(await run()).toEqual({ ok: true, id: WIN, waiting: true, admins: ['Tao'] });
      expect(a.rpc).toHaveBeenCalledWith(name, expect.objectContaining(args));
    }
    const b = db({});
    await m.muteSite({ siteId: SITE, endsAt: at, reason: 'deploy' }, b);
    await m.endWindowEarly({ windowId: WIN, reason: 'done' }, b);
    await m.editWindowEnd({ windowId: WIN, endsAt: at, reason: 'later' }, b);
    await m.cancelWindow({ windowId: WIN, reason: 'off' }, b);
    // A held action says when its messages go (the toast's countdown, §24.8).
    expect(await m.approveMaintenance({ windowId: WIN, endsAt: at }, b)).toEqual({
      ok: true,
      postsAt: '2026-09-25T07:07:10.000Z',
    });
    expect(await m.undoWindowAction({ windowId: WIN }, b)).toEqual({ ok: true });
    expect(b.rpc.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
      'mute_site',
      'end_window_early',
      'edit_window_end',
      'cancel_window',
      'approve_maintenance',
      'undo_window_action',
    ]);
  });

  it('refusals come back in words', async () => {
    expect(
      await m.muteSite(
        { siteId: SITE, endsAt: at, reason: 'x' },
        db({ error: { code: '22023', hint: 'mute_too_long', message: '' } }),
      ),
    ).toEqual({ ok: false, message: 'A mute lasts at most 24 h — schedule maintenance for longer.' });
    expect(
      await m.createMaintenance(
        { siteId: SITE, startsAt: at, endsAt: at, reason: 'x' },
        db({ error: { code: '22023', hint: 'maintenance_open_incident', message: '' } }),
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining('won’t hide this incident') });
    expect(
      await m.cancelWindow({ windowId: WIN, reason: 'x' }, db({ error: { code: '42501', message: '' } })),
    ).toEqual({ ok: false, message: 'Only an Admin, or the site’s owner or backup, can do that.' });
    expect(
      await m.approveMaintenance(
        { windowId: WIN, endsAt: at },
        db({ error: { code: '42501', message: '' } }),
      ),
    ).toEqual({
      ok: false,
      message: 'Only an Admin can approve maintenance.',
    });
    expect(
      await m.endWindowEarly({ windowId: WIN, reason: 'x' }, db({ error: { code: 'P0002', message: '' } })),
    ).toEqual({ ok: false, message: 'It no longer exists — reload the page.' });
    expect(
      await m.editWindowEnd({ windowId: WIN, endsAt: at, reason: 'x' }, db({ error: { message: 'boom' } })),
    ).toEqual({ ok: false, message: 'Couldn’t save. Check your connection and try again.' });
  });

  it('bad input never reaches the database', async () => {
    const d = db({});
    expect(await m.muteSite({ siteId: SITE, endsAt: at, reason: '  ' }, d)).toMatchObject({ ok: false });
    expect(await m.endWindowEarly({ windowId: 'nope', reason: 'x' }, d)).toMatchObject({ ok: false });
    expect(d.rpc).not.toHaveBeenCalled();
  });
});
