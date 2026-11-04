import { describe, expect, it, vi } from 'vitest';
import { createWatchdog, WATCH_GRACE_MS } from './watchdog';

// Spec §14.4's example: the last sweep at 02:17 (Bangkok), the fault line at 02:20.
const T0 = Date.parse('2026-09-24T19:17:00Z');
const min = (n: number) => T0 + n * 60_000;
const iso = (t: number) => new Date(t).toISOString();
const ploy = { name: 'Ploy', chatUserId: '1234' };

const setup = (ok = true) => {
  const post = vi.fn(async (_text: string, _thread: string) => ok);
  return { post, dog: createWatchdog({ post, startedAt: T0 }) };
};

describe('createWatchdog (S12a, D-053)', () => {
  it('a fresh sweep is no fault', async () => {
    const { post, dog } = setup();
    dog.contact({ at: min(1), engineSweepAt: iso(min(1)), onCall: ploy });
    expect(await dog.tick(min(2))).toBe('ok');
    expect(post).not.toHaveBeenCalled();
  });

  it('the sweep 3 min old (BKK still answering): one MONITOR FAULT @on-call, since the last sweep', async () => {
    const { post, dog } = setup();
    for (const m of [0, 1, 2, 3]) dog.contact({ at: min(m), engineSweepAt: iso(T0), onCall: ploy });
    expect(await dog.tick(min(2) + 59_000)).toBe('ok');
    expect(await dog.tick(min(3))).toBe('posted');
    expect(post).toHaveBeenCalledWith(
      '<users/1234> MONITOR FAULT · all sites · heartbeat missed since 02:17 · status unknown, hand-check Tier 1',
      `monitor-fault-${T0}`,
    );
    // Once per fault.
    expect(await dog.tick(min(4))).toBe('fault');
    expect(await dog.tick(min(10))).toBe('fault');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('back posts nothing; a second stop posts again', async () => {
    const { post, dog } = setup();
    dog.contact({ at: min(3), engineSweepAt: iso(T0), onCall: ploy });
    await dog.tick(min(3));
    dog.contact({ at: min(5), engineSweepAt: iso(min(5)), onCall: ploy });
    expect(await dog.tick(min(5))).toBe('ok');
    expect(post).toHaveBeenCalledTimes(1);
    dog.contact({ at: min(9), engineSweepAt: iso(min(5)), onCall: null });
    expect(await dog.tick(min(9))).toBe('posted');
    expect(post).toHaveBeenLastCalledWith(
      'MONITOR FAULT · all sites · heartbeat missed since 02:22 · status unknown, hand-check Tier 1',
      `monitor-fault-${min(5)}`,
    );
  });

  it('the app unreachable for 3 min is a fault too, since the last sweep it reported', async () => {
    const { post, dog } = setup();
    dog.contact({ at: min(1), engineSweepAt: iso(min(1)), onCall: ploy });
    expect(await dog.tick(min(3))).toBe('ok');
    expect(await dog.tick(min(4))).toBe('posted');
    expect(post.mock.calls[0]?.[0]).toContain('missed since 02:18');
  });

  it('unreachable from the start: counts from when the agent started', async () => {
    const { post, dog } = setup();
    expect(await dog.tick(T0 + WATCH_GRACE_MS - 1)).toBe('ok');
    expect(await dog.tick(T0 + WATCH_GRACE_MS)).toBe('posted');
    expect(post.mock.calls[0]?.[0]).toBe(
      'MONITOR FAULT · all sites · heartbeat missed since 02:17 · status unknown, hand-check Tier 1',
    );
  });

  it('a failed post is tried again on the next tick', async () => {
    const { post, dog } = setup(false);
    dog.contact({ at: min(3), engineSweepAt: iso(T0) });
    expect(await dog.tick(min(3))).toBe('post_failed');
    post.mockResolvedValue(true);
    expect(await dog.tick(min(4))).toBe('posted');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('no sweep sent (older server, failed read) is unknown, not missed; null (never ran) is no fault', async () => {
    const { post, dog } = setup();
    dog.contact({ at: min(0), engineSweepAt: iso(T0) });
    dog.contact({ at: min(3) });
    expect(await dog.tick(min(3))).toBe('ok');
    expect(post).not.toHaveBeenCalled();
    const fresh = setup();
    fresh.dog.contact({ at: min(5), engineSweepAt: null });
    expect(await fresh.dog.tick(min(6))).toBe('ok');
  });

  it('an answer without the sweep mid-fault keeps the latch: one post in all (engine review M2)', async () => {
    const { post, dog } = setup();
    dog.contact({ at: min(3), engineSweepAt: iso(T0) });
    expect(await dog.tick(min(3))).toBe('posted');
    dog.contact({ at: min(4) });
    expect(await dog.tick(min(4))).toBe('fault');
    dog.contact({ at: min(5), engineSweepAt: iso(T0) });
    expect(await dog.tick(min(5))).toBe('fault');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('posted while unreachable, then the API answers with a sweep still stale: no new post', async () => {
    const { post, dog } = setup();
    dog.contact({ at: min(0), engineSweepAt: iso(T0) });
    expect(await dog.tick(min(3))).toBe('posted');
    dog.contact({ at: min(6), engineSweepAt: iso(T0) });
    expect(await dog.tick(min(6))).toBe('fault');
    expect(post).toHaveBeenCalledTimes(1);
  });
});
