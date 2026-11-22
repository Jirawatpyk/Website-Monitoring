import { describe, expect, it } from 'vitest';
import { weightedMedian } from './stats';

describe('weightedMedian (D-073 item 10)', () => {
  it.each([
    [
      'the middle of the weights',
      [
        [100, 1],
        [200, 5],
        [900, 1],
      ] as const,
      200,
    ],
    [
      'an even split takes the lower',
      [
        [100, 1],
        [200, 1],
      ] as const,
      100,
    ],
    [
      'nulls and empty weights skipped',
      [
        [null, 9],
        [300, 0],
        [400, 2],
      ] as const,
      400,
    ],
    ['nothing usable', [[null, 5]] as const, null],
    ['nothing at all', [] as const, null],
  ])('%s', (_c, pairs, want) => {
    expect(weightedMedian(pairs)).toBe(want);
  });
});
