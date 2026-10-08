import { describe, expect, it } from 'vitest';
import {
  ALWAYS,
  CHECKED,
  CHECKED_FROM,
  FROM_LG,
  LATE,
  LATE_FROM,
  NARROWEST_TABLE,
  needs,
} from './site-table-layout';

describe('Sites table layout — the shown columns always fit (S05c /verify)', () => {
  it('the narrowest table (md) holds the columns that are always shown', () => {
    expect(needs(ALWAYS)).toBeLessThanOrEqual(NARROWEST_TABLE);
  });

  it('Checked appears once it fits, just past the md edge', () => {
    expect(needs([...ALWAYS, ...CHECKED])).toBeLessThanOrEqual(CHECKED_FROM);
    expect(CHECKED_FROM).toBe(720);
  });

  it('a 1024 px table holds the lg columns too', () => {
    expect(needs([...ALWAYS, ...CHECKED, ...FROM_LG])).toBeLessThanOrEqual(1024);
  });

  it('Response 24h and Expiry appear only where every column fits', () => {
    expect(needs([...ALWAYS, ...CHECKED, ...FROM_LG, ...LATE])).toBeLessThanOrEqual(LATE_FROM);
    expect(LATE_FROM).toBe(1120);
  });

  it('at 1440 (a 1134 px table) every column shows', () => {
    expect(LATE_FROM).toBeLessThanOrEqual(1134);
  });
});
