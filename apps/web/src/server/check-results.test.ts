// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '@dxt/db';
import { insertCheckResults, LAG_TOLERANT_COLUMNS, missingColumn } from './check-results';

const row = {
  monitor_id: 'm1',
  location: 'SIN' as const,
  checked_at: '2026-10-08T08:48:44Z',
  attempt: 1,
  outcome: 'blocked' as const,
  waf: 'akamai',
  akamai_ok: null,
};

/** A db whose insert answers each call with the next response. */
function dbAnswering(...answers: ({ code: string; message: string } | null)[]) {
  const inserts: unknown[] = [];
  const db = {
    from: () => ({
      insert: async (rows: unknown) => {
        inserts.push(rows);
        return { error: answers.shift() ?? null };
      },
    }),
  } as unknown as DbClient;
  return { db, inserts };
}

describe('insertCheckResults — the database a migration behind the code (8 Oct 2026)', () => {
  it('stores the rows without a fact column the database doesn\u2019t have yet, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, inserts } = dbAnswering(
      { code: 'PGRST204', message: "Could not find the 'waf' column of 'check_results' in the schema cache" },
      null,
    );
    await insertCheckResults(db, [row]);
    expect(inserts).toHaveLength(2);
    expect(inserts[1]).toEqual([{ ...row, waf: undefined }].map(({ waf: _w, ...r }) => r));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"schema_lag"'));
    warn.mockRestore();
  });

  it('drops several lagging columns one by one (Postgres 42703 too)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, inserts } = dbAnswering(
      { code: '42703', message: 'column "akamai_ok" of relation "check_results" does not exist' },
      { code: 'PGRST204', message: "Could not find the 'waf' column of 'check_results' in the schema cache" },
      null,
    );
    await insertCheckResults(db, [row]);
    expect(inserts.at(-1)).toEqual([
      { monitor_id: 'm1', location: 'SIN', checked_at: row.checked_at, attempt: 1, outcome: 'blocked' },
    ]);
  });

  it('never drops a core column, and other errors still fail the run', async () => {
    const missingCore = dbAnswering({
      code: 'PGRST204',
      message: "Could not find the 'outcome' column of 'check_results' in the schema cache",
    });
    await expect(insertCheckResults(missingCore.db, [row])).rejects.toThrow('check_results:');
    const fk = dbAnswering({ code: '23503', message: 'insert or update violates foreign key constraint' });
    await expect(insertCheckResults(fk.db, [row])).rejects.toThrow('foreign key');
    expect(fk.inserts).toHaveLength(1);
  });

  it.each([
    [
      { code: 'PGRST204', message: "Could not find the 'waf' column of 'check_results' in the schema cache" },
      'waf',
    ],
    [
      { code: '42703', message: 'column "control_ok" of relation "check_results" does not exist' },
      'control_ok',
    ],
    [{ code: '23505', message: 'duplicate key' }, null],
  ])('missingColumn(%o) → %s', (error, expected) => {
    expect(missingColumn(error)).toBe(expected);
  });
});

/** Columns every check row needs: never dropped, the insert fails instead. */
const CORE_COLUMNS = [
  'id',
  'created_at',
  'monitor_id',
  'location',
  'checked_at',
  'attempt',
  'outcome',
  'status_code',
  'response_ms',
  'error',
];

describe('every check_results column is classified (retro fix/tls-chain-problem)', () => {
  it('a new column must be added to LAG_TOLERANT_COLUMNS (nullable facts) or CORE_COLUMNS here', () => {
    const types = readFileSync(
      new URL('../../../../packages/db/src/database.types.ts', import.meta.url),
      'utf8',
    );
    const block = types.slice(types.indexOf('"check_results": {'));
    const row = /Row: \{\s*([^}]*)\}/.exec(block)![1]!;
    const columns = [...row.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]!);
    expect(columns.length).toBeGreaterThan(10);
    const known = new Set<string>([...CORE_COLUMNS, ...LAG_TOLERANT_COLUMNS]);
    expect(columns.filter((c) => !known.has(c))).toEqual([]);
  });
});
