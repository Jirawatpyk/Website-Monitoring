// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORBIDDEN_GROUP_IDS, FORBIDDEN_GROUPS, FORBIDDEN_PHRASES } from '@dxt/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../test/fake-db';
import { loadForbiddenList } from './forbidden-list';

describe('loadForbiddenList (D-069)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is the table, as stored', async () => {
    const db = fakeDb({
      'forbidden_phrases.select': { data: [{ phrase: 'slot online' }, { phrase: 'ufabet' }] },
    });
    expect(await loadForbiddenList(db.db)).toEqual(['slot online', 'ufabet']);
  });

  it('an empty table is an empty list, not a failure', async () => {
    const db = fakeDb({ 'forbidden_phrases.select': { data: [] } });
    expect(await loadForbiddenList(db.db)).toEqual([]);
  });

  it('a failed read (a missing table on a deploy ahead of its migration) is the bundled list, logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = fakeDb({
      'forbidden_phrases.select': {
        error: { code: 'PGRST205', message: "Could not find the table 'public.forbidden_phrases'" },
      },
    });
    expect(await loadForbiddenList(db.db)).toBe(FORBIDDEN_PHRASES);
    expect(log.mock.calls[0]![0]).toContain('forbidden_phrases_read_failed');
    expect(log.mock.calls[0]![0]).toContain('PGRST205');
  });
});

// The table was seeded from the code list, which stays the fallback: the two must say the same, or a
// failed read would quietly change what every probe looks for.
describe('the forbidden_phrases seed', () => {
  const dir = join(__dirname, '../../../../supabase/migrations');
  const file = readdirSync(dir).find((f) => f.endsWith('_forbidden_phrases.sql'))!;
  const sql = readFileSync(join(dir, file), 'utf8');

  it('is the code list, group by group, in order', () => {
    const rows = [...sql.matchAll(/^\s*\((\d+), '(\w+)', '([^']+)'\),?$/gmu)];
    // numbered 1…n, so the stored order is the list's
    expect(rows.map((m) => Number(m[1]))).toEqual(rows.map((_, i) => i + 1));
    const seeded = rows.map((m) => [m[2], m[3]]);
    expect(seeded).toEqual(FORBIDDEN_GROUP_IDS.flatMap((g) => FORBIDDEN_GROUPS[g].map((p) => [g, p])));
  });

  it('allows exactly the code’s groups', () => {
    const allowed = /phrase_group in \(([^)]+)\)/u.exec(sql)![1]!.match(/'(\w+)'/gu)!;
    expect(allowed.map((s) => s.slice(1, -1))).toEqual([...FORBIDDEN_GROUP_IDS]);
  });
});
