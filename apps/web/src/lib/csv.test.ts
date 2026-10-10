import { describe, expect, it } from 'vitest';
import { csvField, fetchAllPages, fileSlug, toCsv } from './csv';

describe('csvField', () => {
  it.each([
    [null, ''],
    [412, '412'],
    ['BKK', 'BKK'],
    ['a, b', '"a, b"'],
    ['say "hi"', '"say ""hi"""'],
    ['=HYPERLINK("x")', `"'=HYPERLINK(""x"")"`],
    ['-1', "'-1"],
    ['@cmd', "'@cmd"],
  ] as const)('%j → %s', (v, out) => {
    expect(csvField(v)).toBe(out);
  });
  it('a negative number stays a number', () => {
    expect(csvField(-5)).toBe('-5');
  });
});

describe('toCsv', () => {
  it('header, rows, CRLF line ends', () => {
    expect(toCsv(['a', 'b'], [[1, null]])).toBe('a,b\r\n1,\r\n');
  });
});

describe('fileSlug', () => {
  it('lower-case words joined by hyphens', () => {
    expect(fileSlug('Bangkok Airways – Taiwan')).toBe('bangkok-airways-taiwan');
    expect(fileSlug('–')).toBe('site');
  });
});

describe('fetchAllPages (PostgREST returns at most 1,000 rows a request)', () => {
  it('asks for the next page while pages come back full', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => i);
    const asked: [number, number][] = [];
    const got = await fetchAllPages(
      async (from, to) => {
        asked.push([from, to]);
        return { data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null };
      },
      { max: 20_000 },
    );
    expect(got).toHaveLength(2500);
    expect(asked).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });
  it('a page of exactly 1,000 asks once more, then stops on the empty one', async () => {
    let calls = 0;
    const got = await fetchAllPages(
      async (from) => {
        calls++;
        return { data: from === 0 ? Array.from({ length: 1000 }, () => 1) : [], error: null };
      },
      { max: 20_000 },
    );
    expect(got).toHaveLength(1000);
    expect(calls).toBe(2);
  });
  it('stops at the cap and throws on an error', async () => {
    const full = async () => ({ data: Array.from({ length: 1000 }, () => 1), error: null });
    expect(await fetchAllPages(full, { max: 1500 })).toHaveLength(1500);
    await expect(
      fetchAllPages(async () => ({ data: null, error: { message: 'boom' } }), { max: 10 }),
    ).rejects.toThrow('boom');
  });
});
