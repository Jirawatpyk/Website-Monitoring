import { describe, expect, it } from 'vitest';
import type { DbClient } from '@dxt/db';
import { fakeDb } from '../../../test/fake-db';
import { auditCsv, bangkokStamp } from './csv';
import { parseFilters } from './model';
import { loadAuditExport, loadAuditPage } from './queries';

const TAO = '9616f00a-8540-4cf8-8aef-e25bc4dd9a75';
const INC = '11111111-1111-4111-8111-111111111111';
const SITE = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-09-25T03:07:00Z');

const rows = [
  {
    id: 'a',
    at: '2026-09-25T02:58:02Z',
    actor_id: TAO,
    action: 'incident.ack',
    entity: 'incident',
    entity_id: INC,
    before: { state: 'unacked' },
    after: { state: 'acknowledged' },
  },
  {
    id: 'b',
    at: '2026-09-25T01:40:10Z',
    actor_id: null,
    action: 'site.mute',
    entity: 'site',
    entity_id: SITE,
    before: { muted_until: null },
    after: { reason: '=HYPERLINK("x")', muted_until: '2026-09-25T11:00:00Z' },
  },
  {
    id: 'c',
    at: '2026-09-24T09:00:00Z',
    actor_id: TAO,
    action: 'site.delete',
    entity: 'site',
    entity_id: '33333333-3333-4333-8333-333333333333',
    before: { id: '33333333-3333-4333-8333-333333333333', name: 'Old site' },
    after: null,
  },
];

function db(auditRows = rows) {
  return fakeDb({
    'audit_log.select': { data: auditRows, count: auditRows.length },
    'profiles.select': { data: [{ id: TAO, display_name: 'Tao' }] },
    'sites.select': { data: [{ id: SITE, name: 'DxT Games' }] },
    'incidents.select': { data: [{ id: INC, number: 142, site: { name: 'MuvMi' } }] },
  });
}

describe('loadAuditPage', () => {
  it('filters in the database: range, category and actor', async () => {
    const fake = db();
    await loadAuditPage(
      fake.db as unknown as DbClient,
      parseFilters({ cat: 'maintenance', actor: 'system', when: '30d' }),
      NOW,
    );
    const main = fake.calls.find((c) => c.table === 'audit_log' && c.filters.some(([m]) => m === 'or'))!;
    expect(main.filters).toContainEqual(['gte', 'at', '2026-08-25T17:00:00.000Z']);
    expect(main.filters).toContainEqual([
      'or',
      'action.like.maintenance.*,action.in.(site.mute,site.mute_end)',
    ]);
    expect(main.filters).toContainEqual(['is', 'actor_id', null]);
  });

  it('"filtered from" counts the wider of the chosen range and the week (review)', async () => {
    const heads = async (when: string) => {
      const fake = db();
      await loadAuditPage(fake.db as unknown as DbClient, parseFilters({ when, cat: 'config' }), NOW);
      // The count query is the one without the category filter.
      return fake.calls.filter((c) => c.table === 'audit_log' && !c.filters.some(([m]) => m === 'or'))[0]!
        .filters;
    };
    const LTE = ['lte', 'at', NOW.toISOString()];
    expect(await heads('today')).toEqual([LTE, ['gte', 'at', '2026-09-17T17:00:00.000Z']]);
    expect(await heads('30d')).toEqual([LTE, ['gte', 'at', '2026-08-25T17:00:00.000Z']]);
    expect(await heads('all')).toEqual([LTE]);
  });

  it('no extra count when nothing narrows the rows; the page carries no stored JSON (M5)', async () => {
    const fake = db();
    const page = await loadAuditPage(fake.db as unknown as DbClient, parseFilters({ when: '30d' }), NOW);
    expect(fake.calls.filter((c) => c.table === 'audit_log')).toHaveLength(1);
    expect(page.entries.every((e) => e.beforeJson === null && e.afterJson === null)).toBe(true);
  });

  it('every read stops at now, so an export never repeats a row at a page seam (H2)', async () => {
    const fake = db();
    await loadAuditExport(fake.db as unknown as DbClient, parseFilters({ entity: 'escalation' }), NOW);
    const main = fake.calls.find((c) => c.table === 'audit_log')!;
    expect(main.filters).toContainEqual(['lte', 'at', NOW.toISOString()]);
    expect(main.filters).toContainEqual(['eq', 'entity', 'escalation']);
  });

  it('All time has no lower bound; one person filters by id', async () => {
    const fake = db();
    await loadAuditPage(fake.db as unknown as DbClient, parseFilters({ when: 'all', actor: TAO }), NOW);
    const main = fake.calls.find((c) => c.table === 'audit_log' && c.filters.some(([m]) => m === 'eq'))!;
    expect(main.filters.some(([m]) => m === 'gte')).toBe(false);
    expect(main.filters).toContainEqual(['eq', 'actor_id', TAO]);
  });

  it('names the actor, the entity, and keeps a deleted row’s own name', async () => {
    const page = await loadAuditPage(db().db as unknown as DbClient, parseFilters({}), NOW);
    expect(page.entries.map((e) => [e.actor, e.words, e.entity, e.before, e.after])).toEqual([
      ['Tao', 'Acknowledged', 'INC-0142 · MuvMi', 'Unacked', 'Acknowledged'],
      [
        'System',
        'Muted site',
        'DxT Games',
        'muted until none',
        'muted until Fri 25 Sep 18:00 · “=HYPERLINK("x")”',
      ],
      ['Tao', 'Deleted site', 'Old site', 'Old site', 'deleted'],
    ]);
    expect(page.entries[0]!.atLabel).toBe('09:58:02');
    expect(page.actors.map((a) => a.label)).toEqual(['Everyone', 'System', 'Tao']);
  });

  it('a bad filter in the URL falls back to the default', () => {
    expect(parseFilters({ cat: 'nope', actor: "x' or 1=1", when: '99d' })).toEqual({
      cat: 'All',
      actor: 'everyone',
      range: 'Last 7 days',
    });
  });

  it('throws on a database error instead of showing an empty log', async () => {
    const fake = fakeDb({ 'audit_log.select': { error: { message: 'permission denied' } } });
    await expect(loadAuditPage(fake.db as unknown as DbClient, parseFilters({}), NOW)).rejects.toThrow(
      'permission denied',
    );
  });
});

describe('loadAuditExport + CSV (Done-when 2)', () => {
  it('pages through every matching row, 1,000 a request', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ ...rows[0]!, id: `r${i}` }));
    let call = 0;
    const fake = fakeDb({
      'audit_log.select': () => ({ data: call++ === 0 ? many : rows.slice(0, 1) }),
      'profiles.select': { data: [] },
    });
    const out = await loadAuditExport(
      fake.db as unknown as DbClient,
      parseFilters({ cat: 'incidents' }),
      NOW,
    );
    expect(out).toHaveLength(1001);
    const ranges = fake.calls
      .filter((c) => c.table === 'audit_log')
      .map((c) => c.filters.find(([m]) => m === 'range'));
    expect(ranges).toEqual([
      ['range', 0, 999],
      ['range', 1000, 1999],
    ]);
    // The same category filter as the page: only the filtered rows are exported.
    expect(
      fake.calls
        .filter((c) => c.table === 'audit_log')
        .every((c) => c.filters.some(([m, v]) => m === 'or' && v === 'action.like.incident.*')),
    ).toBe(true);
  });

  it('writes the header, Bangkok time, the words and the stored JSON; neutralises a formula', async () => {
    const entries = await loadAuditExport(
      db(rows.slice(0, 2)).db as unknown as DbClient,
      parseFilters({}),
      NOW,
    );
    const csv = auditCsv(entries);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('Time (Bangkok),Actor,Action,What,Entity,Before,After,Before (JSON),After (JSON)');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^2026-09-25 09:58:02 \+07:00,Tao,incident\.ack,Acknowledged,INC-0142 · MuvMi,/);
    // The reason starts with "=": the After cell keeps it quoted inside the words, and the JSON cell
    // starts with "{", so no cell begins with a formula character.
    for (const line of lines.slice(1)) expect(line.split(',').some((c) => /^[=+\-@]/.test(c))).toBe(false);
  });

  it('bangkokStamp', () => expect(bangkokStamp('2026-09-24T17:00:05Z')).toBe('2026-09-25 00:00:05 +07:00'));
});
