import { describe, expect, it } from 'vitest';
import type { LocationEvidence } from '../detail-queries';
import { evidenceSummary, roundVerdict } from './incident-sections';

const cell = (glyph: 'pass' | 'fail' | 'blocked') => ({ text: glyph, glyph });

describe('roundVerdict (MIncident Latest round)', () => {
  it.each([
    [['pass', 'pass', 'pass'], '3/3 pass → OK'],
    [['fail', 'fail', 'fail'], '3/3 hard fail → DOWN'],
    [['fail', 'fail', 'pass'], '2/3 hard fail → DOWN'],
    [['fail', 'pass', 'pass'], '1/3 failing'],
    [['blocked', 'pass', 'pass'], '1/3 failing'],
  ])('%j → %s', (glyphs, words) => {
    expect(roundVerdict(glyphs)).toBe(words);
  });
});

describe('evidenceSummary (Incident board, Evidence card)', () => {
  const loc = (first: 'pass' | 'fail', recheck: 'pass' | 'fail' | null): LocationEvidence => ({
    location: 'BKK',
    first: cell(first),
    recheck: recheck ? cell(recheck) : null,
    latest: cell('pass'),
  });
  it('counts the locations that hard-failed on the check and its recheck (INC-0142: 3 of 3)', () => {
    expect(
      evidenceSummary({
        severity: 'down',
        trigger: 'hard_fail',
        locations: [loc('fail', 'fail'), loc('fail', 'fail'), loc('fail', 'fail')],
      }),
    ).toBe('3 of 3 locations hard fail on 2 checks in a row → DOWN (2 of 3 needed)');
  });
  it('a location whose recheck passed doesn’t count', () => {
    expect(
      evidenceSummary({
        severity: 'down',
        trigger: 'hard_fail',
        locations: [loc('fail', 'fail'), loc('fail', 'pass'), loc('fail', 'fail')],
      }),
    ).toBe('2 of 3 locations hard fail on 2 checks in a row → DOWN (2 of 3 needed)');
  });
  it('no line for a PROBLEM or another trigger', () => {
    expect(
      evidenceSummary({ severity: 'problem', trigger: 'slow', locations: [loc('fail', 'fail')] }),
    ).toBeNull();
  });
});
