import { describe, expect, it } from 'vitest';
import { shortCause } from './cause';

describe('shortCause (spec §10 short form)', () => {
  it.each([
    ['Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)', 'Timeout ×2 · 504 ×1'],
    ['Connection refused (BKK, SIN, TYO)', 'Connection refused ×3'],
    ['HTTP 503 (BKK, SIN, TYO)', '503 ×3'],
    ['DNS error (BKK, SIN, TYO)', 'DNS error ×3'],
    ['Manual (hand check)', 'Manual (hand check)'],
    ['', ''],
  ])('%s → %s', (cause, expected) => {
    expect(shortCause(cause)).toBe(expected);
  });
});
