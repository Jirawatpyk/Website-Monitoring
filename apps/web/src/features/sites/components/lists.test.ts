import { describe, expect, it } from 'vitest';
import { splitList } from './lists';

describe('splitList', () => {
  it('splits on commas, trims, drops empties and repeats', () => {
    expect(splitList(' Index of /, Database error ,, Index of /')).toEqual(['Index of /', 'Database error']);
    expect(splitList('')).toEqual([]);
  });
});
