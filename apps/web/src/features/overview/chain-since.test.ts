// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fake-db';
import { fillChainSince } from './queries';
import type { OverviewSite } from './types';

// The Overview's TLS chain "Since" (§21.4, D-029) from monitor_status.chain_since (cold-load follow-up).
const live = [{ id: 's1', monitors: [{ id: 'm1', is_primary: true }] }];
const row = (locations: OverviewSite['locations']) =>
  ({ id: 's1', locations, chainSince: null }) as unknown as OverviewSite;

describe('fillChainSince', () => {
  it('the earliest carried start over the warned locations, from one read', async () => {
    const { db, calls } = fakeDb({
      'monitor_status.select': {
        data: [
          {
            monitor_id: 'm1',
            chain_since: { BKK: '2026-11-13T02:15:46.000Z', SIN: '2026-11-13T02:15:01.000Z' },
          },
        ],
      },
    });
    const r = row({ BKK: 'chain', SIN: 'chain', TYO: 'pass' } as OverviewSite['locations']);
    await fillChainSince(db, [r], live);
    expect(r.chainSince).toBe('2026-11-13T02:15:01.000Z');
    expect(calls.filter((c) => c.table === 'check_results')).toHaveLength(0);
  });

  it('no warned site: nothing read', async () => {
    const { db, calls } = fakeDb({});
    await fillChainSince(
      db,
      [row({ BKK: 'pass', SIN: 'pass', TYO: 'pass' } as OverviewSite['locations'])],
      live,
    );
    expect(calls).toHaveLength(0);
  });

  it.each(['42703', 'PGRST204'])(
    'a database a deploy behind (%s, no chain_since yet): no Since, the page still loads',
    async (code) => {
      const { db } = fakeDb({
        'monitor_status.select': { error: { message: 'column does not exist', code } },
      });
      const r = row({ BKK: 'chain', SIN: 'pass', TYO: 'pass' } as OverviewSite['locations']);
      await expect(fillChainSince(db, [r], live)).resolves.toBeUndefined();
      expect(r.chainSince).toBeNull();
    },
  );

  it('any other error still fails the load', async () => {
    const { db } = fakeDb({ 'monitor_status.select': { error: { message: 'boom', code: '57014' } } });
    const r = row({ BKK: 'chain', SIN: 'pass', TYO: 'pass' } as OverviewSite['locations']);
    await expect(fillChainSince(db, [r], live)).rejects.toThrow('monitor_status: boom');
  });
});
