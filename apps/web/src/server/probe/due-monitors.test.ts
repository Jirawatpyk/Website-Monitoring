// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fake-db';
import { loadDueMonitors } from './due-monitors';

// D-051: a Tier 2–3 home page whose round timed out at 2+ locations owes a confirm check from each
// location at its next minute tick. INC-0036 EQHO (Tier 2): the round at 06:42, confirms at 06:43.
const monitor = (id: string, tier: number, is_primary = true) => ({
  id,
  url: `https://${id}.example.test/`,
  method: 'GET',
  timeout_ms: 30_000,
  must_contain: [],
  must_not_contain: [],
  headers: [],
  is_primary,
  sites: { tier, is_active: true },
});
const row = (
  monitor_id: string,
  location: string,
  checked_at: string,
  over: Record<string, unknown> = {},
) => ({
  monitor_id,
  location,
  checked_at,
  error: 'Timeout',
  confirm: null,
  ...over,
});
const timedOut = (id: string) => [
  row(id, 'BKK', '2026-10-16T06:42:01Z'),
  row(id, 'TYO', '2026-10-16T06:42:02Z'),
];
const at = new Date('2026-10-16T06:43:02Z');

async function due(monitors: unknown[], checks: unknown[], location: 'SIN' | 'TYO' | 'BKK' | null = 'TYO') {
  const fake = fakeDb({ 'monitors.select': { data: monitors }, 'check_results.select': { data: checks } });
  const list = await loadDueMonitors(fake.db, at, location ? { location } : undefined);
  return { list: list.map((m) => ({ id: m.id, confirm: m.confirm ?? false })), calls: fake.calls };
}

describe('D-051 confirm checks (loadDueMonitors)', () => {
  it('timeouts at 2 locations: every location owes a confirm at the next tick', async () => {
    expect((await due([monitor('eqho', 2)], timedOut('eqho'))).list).toEqual([{ id: 'eqho', confirm: true }]);
  });

  it('one location timing out is no reason to confirm', async () => {
    expect((await due([monitor('eqho', 2)], timedOut('eqho').slice(0, 1))).list).toEqual([]);
  });

  it('once this location confirmed, not again; another location’s confirm doesn’t count here', async () => {
    const mine = row('eqho', 'TYO', '2026-10-16T06:43:02Z', { confirm: true, error: null });
    expect((await due([monitor('eqho', 2)], [...timedOut('eqho'), mine])).list).toEqual([]);
    const theirs = { ...mine, location: 'BKK' };
    expect((await due([monitor('eqho', 2)], [...timedOut('eqho'), theirs])).list).toEqual([
      { id: 'eqho', confirm: true },
    ]);
  });

  it('a confirm’s own timeout is not one of the round’s timeouts', async () => {
    const confirms = [row('eqho', 'BKK', '2026-10-16T06:43:01Z', { confirm: true })];
    expect((await due([monitor('eqho', 2)], [...timedOut('eqho').slice(0, 1), ...confirms])).list).toEqual(
      [],
    );
  });

  it('only the current round counts: a timeout in the round before doesn’t', async () => {
    const before = [row('eqho', 'BKK', '2026-10-16T06:39:01Z'), row('eqho', 'TYO', '2026-10-16T06:39:02Z')];
    expect((await due([monitor('eqho', 2)], before)).list).toEqual([]);
  });

  it('Tier 1 and key pages never get one; on its own tick a monitor is just due', async () => {
    const key = monitor('booking', 2, false);
    const tier1 = monitor('muvmi', 1);
    const { list, calls } = await due([key, tier1], [...timedOut('booking'), ...timedOut('muvmi')]);
    expect(list).toEqual([{ id: 'muvmi', confirm: false }]);
    // Nothing between ticks to look for: no read of check_results.
    expect(calls.some((c) => c.table === 'check_results')).toBe(false);
  });

  it('without a location asking (an agent that didn’t opt in) nobody gets a confirm', async () => {
    expect((await due([monitor('eqho', 2)], timedOut('eqho'), null)).list).toEqual([]);
  });

  it('no confirm while the site is already down: the round before timed out at 2+ too (D-049 decides)', async () => {
    const before = [row('eqho', 'BKK', '2026-10-16T06:39:01Z'), row('eqho', 'TYO', '2026-10-16T06:39:02Z')];
    expect((await due([monitor('eqho', 2)], [...before, ...timedOut('eqho')])).list).toEqual([]);
  });

  it('only the round just before counts: timeouts two Tier 2 rounds back don’t stop a confirm', async () => {
    // A Tier 3 monitor stretches the read back to 06:35; the Tier 2 round before 06:42 is 06:39 (OK).
    const twoBack = [row('eqho', 'BKK', '2026-10-16T06:36:01Z'), row('eqho', 'TYO', '2026-10-16T06:36:02Z')];
    expect(
      (await due([monitor('eqho', 2), monitor('dxt', 3)], [...twoBack, ...timedOut('eqho')])).list,
    ).toEqual([{ id: 'eqho', confirm: true }]);
  });

  it('reads monitor-first, this round and the one before, in batches of 50 ids', async () => {
    const many = Array.from({ length: 51 }, (_, i) => monitor(`m${i}`, i % 2 ? 2 : 3));
    const { calls } = await due(many, []);
    const reads = calls.filter((c) => c.table === 'check_results');
    expect(reads).toHaveLength(2);
    // Tier 3's round started at 06:40, and the one before it at 06:35: the oldest that counts.
    expect(reads[0]!.filters).toEqual([
      ['in', 'monitor_id', many.slice(0, 50).map((m) => m.id)],
      ['gte', 'checked_at', '2026-10-16T06:35:00.000Z'],
      ['eq', 'attempt', 1],
      ['or', 'error.eq.Timeout,confirm.is.true'],
    ]);
  });
});
