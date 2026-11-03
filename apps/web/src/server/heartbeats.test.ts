import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../test/fake-db';
import { loadWatchFacts, stampBeat } from './heartbeats';

const now = new Date('2026-11-03T08:00:00Z');

describe('stampBeat (S12a)', () => {
  it('upserts the job’s beat at now', async () => {
    const { db, calls } = fakeDb();
    await stampBeat(db, 'engine-sweep', now);
    expect(calls).toContainEqual(
      expect.objectContaining({
        table: 'agent_heartbeats',
        op: 'upsert',
        values: { name: 'engine-sweep', last_seen_at: now.toISOString() },
      }),
    );
  });

  it('never throws: a failed stamp is only logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = fakeDb({ 'agent_heartbeats.upsert': { error: { message: 'down' } } });
    await expect(stampBeat(db, 'notifier', now)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('beat_failed'));
    warn.mockRestore();
  });
});

describe('loadWatchFacts (S12a, D-053)', () => {
  it('the last sweep and the active person on call now', async () => {
    const { db, calls } = fakeDb({
      'agent_heartbeats.select': { data: { last_seen_at: '2026-11-03T07:59:05+00:00' } },
      'oncall_shifts.select': {
        data: { person: { display_name: 'Ploy', google_chat_user_id: '1234', is_active: true } },
      },
    });
    expect(await loadWatchFacts(db, now)).toEqual({
      engineSweepAt: '2026-11-03T07:59:05+00:00',
      onCall: { name: 'Ploy', chatUserId: '1234' },
    });
    const shift = calls.find((c) => c.table === 'oncall_shifts');
    expect(shift?.filters).toEqual([
      ['lte', 'starts_at', now.toISOString()],
      ['gt', 'ends_at', now.toISOString()],
    ]);
  });

  it('nobody on call, an inactive person, and no sweep yet', async () => {
    const empty = fakeDb({
      'agent_heartbeats.select': { data: null },
      'oncall_shifts.select': { data: null },
    });
    expect(await loadWatchFacts(empty.db, now)).toEqual({ engineSweepAt: null, onCall: null });
    const gone = fakeDb({
      'agent_heartbeats.select': { data: null },
      'oncall_shifts.select': {
        data: { person: { display_name: 'Ex', google_chat_user_id: null, is_active: false } },
      },
    });
    expect((await loadWatchFacts(gone.db, now)).onCall).toBeNull();
  });

  it('a failed sweep read throws (the route leaves the facts out); a failed on-call read keeps the sweep', async () => {
    const sweepGone = fakeDb({ 'agent_heartbeats.select': { error: { message: 'x' } } });
    await expect(loadWatchFacts(sweepGone.db, now)).rejects.toThrow('agent_heartbeats: x');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shiftGone = fakeDb({
      'agent_heartbeats.select': { data: { last_seen_at: '2026-11-03T07:59:05+00:00' } },
      'oncall_shifts.select': { error: { message: 'y' } },
    });
    expect(await loadWatchFacts(shiftGone.db, now)).toEqual({
      engineSweepAt: '2026-11-03T07:59:05+00:00',
      onCall: null,
    });
    warn.mockRestore();
  });
});
