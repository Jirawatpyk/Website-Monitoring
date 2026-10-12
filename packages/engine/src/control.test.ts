import { describe, expect, it } from 'vitest';
import { bkkControlDown, bkkControlFailing, CONTROL_FAILING_ROUNDS } from './control';

// D-028: the BKK probe's control check (D-027) failing 3 rounds in a row → Admin alert.
const T = Date.parse('2026-10-08T06:15:01Z');
const fact = (minute: number, controlOk: boolean | null, sec = 1) => ({
  checkedAt: new Date(T + minute * 60_000 + (sec - 1) * 1000),
  controlOk,
});

describe('bkkControlFailing (D-028)', () => {
  it.each([
    ['no control reported (old agent, or SIN / TYO only)', [fact(0, null), fact(1, null)], null],
    ['nothing at all', [], null],
    ['the latest minute passed', [fact(0, false), fact(1, false), fact(2, true)], false],
    ['3 failing minutes in a row', [fact(0, false), fact(1, false), fact(2, false)], true],
    ['only 2 failing minutes so far: wait', [fact(1, false), fact(2, false)], null],
    ['a pass among the last 3 minutes: not yet', [fact(0, false), fact(1, true), fact(2, false)], null],
    [
      'the recheck passed in a failing minute: that minute passed',
      [fact(0, false), fact(1, false), fact(2, false), fact(2, true, 31)],
      false,
    ],
    [
      'nulls between failures are ignored',
      [fact(0, false), fact(1, null), fact(2, false), fact(3, false)],
      true,
    ],
  ] as const)('%s → %s', (_name, facts, expected) => {
    expect(bkkControlFailing(facts)).toBe(expected);
  });

  it('waits for 3 rounds by default', () => {
    expect(CONTROL_FAILING_ROUNDS).toBe(3);
    expect(bkkControlFailing([fact(0, false)], 1)).toBe(true);
  });
});

// D-038: the gate for PROBLEM (unverified) on a WAF site — scheduled checks only, alert as fallback.
describe('bkkControlDown (D-038)', () => {
  it.each([
    ['3 failing minutes', [fact(0, false), fact(1, false), fact(2, false)], false, true],
    ['one failing minute, alert still open after a pass', [fact(0, true), fact(1, false)], true, false],
    ['no control reported: the open alert decides', [fact(0, null)], true, true],
    ['nothing at all, no alert', [], false, false],
    [
      'scheduled fails, recheck passes, 3 minutes',
      [
        fact(0, false),
        fact(0, true, 31),
        fact(1, false),
        fact(1, true, 31),
        fact(2, false),
        fact(2, true, 31),
      ],
      false,
      true,
    ],
    [
      'scheduled passes, recheck fails, 3 minutes',
      [
        fact(0, true),
        fact(0, false, 31),
        fact(1, true),
        fact(1, false, 31),
        fact(2, true),
        fact(2, false, 31),
      ],
      false,
      true,
    ],
    [
      'a minute where every batch passed ends it',
      [fact(0, false), fact(1, false), fact(2, true), fact(2, true, 31)],
      true,
      false,
    ],
    ['alert open, sparse batches, every known minute failed', [fact(0, false), fact(2, false)], true, true],
    ['two failing minutes, no alert: not yet', [fact(0, false), fact(1, false)], false, false],
  ] as const)('%s → %s', (_name, facts, alertOpen, expected) => {
    expect(bkkControlDown(facts, alertOpen)).toBe(expected);
  });
});
