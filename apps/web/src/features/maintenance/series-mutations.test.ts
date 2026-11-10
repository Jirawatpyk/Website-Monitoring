import { describe, expect, it, vi } from 'vitest';
import * as m from './mutations';

// Repeating series (D-057, §32): each action goes through its one RPC; the held ones return when their
// messages go (the series' undo_until); refusals come back in words.
const SITE = '00000000-0000-4000-8000-0000000000a1';
const SER = '00000000-0000-4000-8000-0000000000f1';
const db = (
  result: { data?: unknown; error?: { code?: string; hint?: string | null; message: string } | null },
  approved: string | null = null,
) => {
  const rpc = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }));
  const chain = {
    eq: () => chain,
    order: async () => ({ data: [{ starts_at: '2026-09-28T18:00:00Z', display_name: 'Tao' }], error: null }),
    maybeSingle: async () => ({
      data: { approved_at: approved, undo_until: '2026-09-25T07:07:10.000Z' },
      error: null,
    }),
  };
  return { db: { rpc, from: () => ({ select: () => chain }) } as never, rpc };
};
const weekly = {
  siteId: SITE,
  rule: { freq: 'weekly' as const, days: [2] },
  startTime: '01:00',
  durationMin: 120,
  startsOn: '2026-09-28',
  untilOn: null,
  reason: 'WordPress plugin updates',
};

describe('series mutations (D-057)', () => {
  it('schedules through create_maintenance_series; an Admin’s returns the windows made now', async () => {
    const a = db({ data: SER }, '2026-09-25T03:07:00Z');
    expect(await m.createSeries(weekly, a)).toEqual({
      ok: true,
      id: SER,
      waiting: false,
      windows: ['2026-09-28T18:00:00Z'],
    });
    expect(a.rpc).toHaveBeenCalledWith('create_maintenance_series', {
      p_site_id: SITE,
      p_rule: { freq: 'weekly', days: [2] },
      p_start_time: '01:00',
      p_duration_min: 120,
      p_starts_on: '2026-09-28',
      p_until_on: null,
      p_reason: 'WordPress plugin updates',
    });
    const r = db({ data: SER }, null);
    expect(await m.createSeries(weekly, r)).toMatchObject({ ok: true, waiting: true, admins: ['Tao'] });
  });

  it('refuses a bad rule before the RPC', async () => {
    const a = db({ data: SER });
    expect((await m.createSeries({ ...weekly, rule: { freq: 'weekly', days: [] } } as never, a)).ok).toBe(
      false,
    );
    expect(a.rpc).not.toHaveBeenCalled();
  });

  it('approve, decline, cancel are held: they return when the messages go', async () => {
    const a = db({});
    expect(await m.decideSeries({ seriesId: SER, approve: true, reason: '' }, a)).toEqual({
      ok: true,
      id: SER,
      postsAt: '2026-09-25T07:07:10.000Z',
    });
    expect(a.rpc).toHaveBeenCalledWith('decide_maintenance_series', {
      p_series_id: SER,
      p_approve: true,
      p_reason: '',
    });
    await m.cancelSeries({ seriesId: SER, reason: 'Done' }, a);
    expect(a.rpc).toHaveBeenCalledWith('cancel_maintenance_series', { p_series_id: SER, p_reason: 'Done' });
    expect(await m.decideSeries({ seriesId: SER, approve: false, reason: '' }, a)).toEqual({
      ok: false,
      message: 'Type a reason — the asker gets it.',
    });
  });

  it('undo and post-now go through their RPCs', async () => {
    const a = db({});
    expect(await m.undoSeriesAction({ seriesId: SER }, a)).toEqual({ ok: true });
    expect(a.rpc).toHaveBeenCalledWith('undo_series_action', { p_series_id: SER });
    expect(await m.postSeriesActionNow({ seriesId: SER }, a)).toEqual({ ok: true });
    expect(a.rpc).toHaveBeenCalledWith('post_series_action_now', { p_series_id: SER });
  });

  it.each([
    [
      { code: '42501', message: 'x', hint: 'use_decline' },
      'Only an Admin, or the site’s owner or backup, can do that.',
    ],
    [
      { code: '22023', message: 'x', hint: 'not_approved' },
      'Nobody approved it before its first window — ask again.',
    ],
    [
      { code: '22023', message: 'x', hint: 'undo_window_changed' },
      'One of its windows was changed since — it can’t be undone; cancel the series instead.',
    ],
    [
      { code: '22023', message: 'x', hint: 'no_occurrence' },
      'No window falls between those days — at least 5 min from now.',
    ],
  ])('a refusal in words', async (error, message) => {
    expect(await m.cancelSeries({ seriesId: SER, reason: 'x' }, db({ error }))).toEqual({
      ok: false,
      message,
    });
  });
});
