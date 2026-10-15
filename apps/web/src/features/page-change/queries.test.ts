// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fake-db';
import { loadPageChange } from './queries';

// The cards' loader (S09d): reads as the viewer, the baseline of the current URL only, names the
// Admin who accepted it, and finds the site's open Page change incident.
const NOW = new Date('2026-10-15T03:07:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const URL = 'https://a.example/';
const FP = { title: 'Site A', scripts: ['static-cdn.example'], links: ['a.example'] };
const monitor = { monitorId: 'm1', siteId: 's1', url: URL, allowedRedirectDomains: [] };
const baseline = {
  monitor_id: 'm1',
  url: URL,
  fingerprint: FP,
  first_set_at: ago(30 * 24 * 60),
  accepted_at: ago(9000),
  accepted_by: 'u-tao',
  reason: 'Redesign',
  undo_before: null,
  undo_until: null,
  undo_by: null,
};

describe('loadPageChange', () => {
  it('builds the view from the baseline, the plain fetches and the open incident', async () => {
    const { db, calls } = fakeDb({
      'page_baselines.select': { data: baseline },
      'crawler_checks.select': {
        data: [
          {
            id: 'c1',
            checked_at: ago(7),
            usable: true,
            fingerprint: { ...FP, title: 'Site A | Lucky Deals' },
          },
        ],
      },
      'incidents.select': { data: { id: 'i1', number: 157, started_at: ago(37) } },
      'profiles.select': { data: [{ id: 'u-tao', display_name: 'Tao' }] },
    });
    const v = await loadPageChange(db, monitor, { id: 'u-tao' }, NOW);
    expect(v).toMatchObject({
      status: 'problem',
      checkId: 'c1',
      baseline: { acceptedBy: 'Tao', reason: 'Redesign' },
      incident: { id: 'i1', number: 157 },
    });
    const plain = calls.find((c) => c.table === 'crawler_checks');
    expect(plain?.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'view', 'plain'],
        ['eq', 'monitor_id', 'm1'],
      ]),
    );
  });

  it('a baseline of an older URL is no baseline (the crawler resets it)', async () => {
    const { db } = fakeDb({
      'page_baselines.select': { data: { ...baseline, url: 'https://old.example/' } },
      'crawler_checks.select': { data: [] },
      'incidents.select': { data: null },
    });
    expect((await loadPageChange(db, monitor, { id: 'u' }, NOW)).status).toBe('no_fingerprint');
  });

  it('fails loudly on a read error', async () => {
    const { db } = fakeDb({ 'page_baselines.select': { error: { message: 'nope' } } });
    await expect(loadPageChange(db, monitor, { id: 'u' }, NOW)).rejects.toThrow('page_baselines: nope');
  });
});
