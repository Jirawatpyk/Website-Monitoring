import { describe, expect, it } from 'vitest';
import { csvField, fileSlug, toCsv } from './csv';

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
