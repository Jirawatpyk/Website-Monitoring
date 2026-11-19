import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerClient } from '@/lib/supabase/server';
import { loadHolidays } from './queries';

type Result = { data: unknown; error: { code: string; message: string } | null };

/** A `from(…).select(cols).gte(…).order(…)` chain answering per selected column list. */
function fakeDb(answer: (cols: string) => Result) {
  const selects: string[] = [];
  const from = vi.fn(() => ({
    select: (cols: string) => {
      selects.push(cols);
      const chain = { gte: () => chain, order: () => Promise.resolve(answer(cols)) };
      return chain;
    },
  }));
  return { db: { from } as unknown as Pick<ServerClient, 'from'>, selects };
}

const NOW = new Date('2026-09-25T03:08:00Z');
const ROW = { id: 'a', day: '2026-12-30', name: 'Year-end' };

afterEach(() => vi.restoreAllMocks());

describe('loadHolidays (S17 PR 3a)', () => {
  it('reads the kind', async () => {
    const { db } = fakeDb(() => ({ data: [{ ...ROW, kind: 'company' }], error: null }));
    expect(await loadHolidays(db, NOW)).toEqual([{ ...ROW, kind: 'company' }]);
  });

  it('before migrate-production adds the column (42703), lists them as public holidays and logs it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, selects } = fakeDb((cols) =>
      cols.includes('kind')
        ? { data: null, error: { code: '42703', message: 'column company_holidays.kind does not exist' } }
        : { data: [ROW], error: null },
    );
    expect(await loadHolidays(db, NOW)).toEqual([{ ...ROW, kind: 'public' }]);
    expect(selects).toEqual(['id, day, name, kind', 'id, day, name']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('company_holidays_kind_missing'));
  });

  it('any other failure is a real one: no fallback', async () => {
    const { db, selects } = fakeDb(() => ({ data: null, error: { code: '57014', message: 'timeout' } }));
    await expect(loadHolidays(db, NOW)).rejects.toThrow('company_holidays: timeout');
    expect(selects).toHaveLength(1);
  });
});
