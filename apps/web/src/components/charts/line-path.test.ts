import { describe, expect, it } from 'vitest';
import { linePath, niceMax } from './line-path';

const box = { from: 0, to: 100, max: 1000, width: 200, height: 100 };

describe('linePath', () => {
  it('maps time to x and value to y (0 at the bottom)', () => {
    expect(
      linePath(
        [
          { t: 0, v: 0 },
          { t: 50, v: 500 },
          { t: 100, v: 1000 },
        ],
        box,
      ),
    ).toBe('M0.0 100.0 L100.0 50.0 L200.0 0.0');
  });

  it('a null value breaks the line into segments (a failed bucket is a gap)', () => {
    expect(
      linePath(
        [
          { t: 0, v: 100 },
          { t: 25, v: null },
          { t: 50, v: 100 },
          { t: 75, v: 100 },
        ],
        box,
      ),
    ).toBe('M0.0 90.0 M100.0 90.0 L150.0 90.0');
  });

  it('caps values at the top and drops points outside the range', () => {
    expect(
      linePath(
        [
          { t: -10, v: 100 },
          { t: 10, v: 5000 },
        ],
        box,
      ),
    ).toBe('M20.0 0.0');
  });
});

describe('niceMax', () => {
  it.each([
    [[], 250],
    [[120, null], 250],
    [[412, 690], 1000],
    [[1100], 2000],
    [[2300], 2500],
    [[5800], 10000],
  ] as const)('%j → %d', (values, max) => {
    expect(niceMax(values)).toBe(max);
  });
});
