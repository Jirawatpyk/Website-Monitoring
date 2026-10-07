import { describe, expect, it } from 'vitest';
import type { CheckOutcome, ProbeLocation } from '@dxt/shared';
import {
  confirmsDown,
  evaluateRound,
  faultyLocations,
  isRegionalProblem,
  type LocationResult,
} from './round';

const now = new Date('2026-09-25T02:48:41Z'); // 09:48:41 Bangkok — INC-0142 confirmed down

function results(outcomes: Partial<Record<ProbeLocation, CheckOutcome>>, ageSec = 10): LocationResult[] {
  return Object.entries(outcomes).map(([location, outcome]) => ({
    location: location as ProbeLocation,
    outcome: outcome as CheckOutcome,
    checkedAt: new Date(now.getTime() - ageSec * 1000),
  }));
}

describe('evaluateRound — DOWN rule (spec §6)', () => {
  it.each<[string, Partial<Record<ProbeLocation, CheckOutcome>>, string]>([
    ['3 of 3 hard fail', { BKK: 'fail', SIN: 'fail', TYO: 'fail' }, 'hard_fail'],
    [
      '2 of 3 hard fail (INC-0142: timeout BKK+TYO, 504 SIN)',
      { BKK: 'fail', SIN: 'pass', TYO: 'fail' },
      'hard_fail',
    ],
    ['1 of 3 hard fail → no DOWN majority', { BKK: 'fail', SIN: 'pass', TYO: 'pass' }, 'pass'],
    ['all pass', { BKK: 'pass', SIN: 'pass', TYO: 'pass' }, 'pass'],
    [
      'blocked everywhere → verifier decides',
      { BKK: 'blocked', SIN: 'blocked', TYO: 'blocked' },
      'needs_verification',
    ],
    ['2 pass + 1 blocked → OK', { BKK: 'pass', SIN: 'pass', TYO: 'blocked' }, 'pass'],
    [
      '1 pass + 1 fail + 1 blocked → verifier decides',
      { BKK: 'pass', SIN: 'fail', TYO: 'blocked' },
      'needs_verification',
    ],
    ['only 1 location reported', { BKK: 'fail' }, 'insufficient_data'],
  ])('%s', (_name, outcomes, kind) => {
    expect(evaluateRound({ results: results(outcomes), now, windowSec: 90 }).kind).toBe(kind);
  });

  it('drops results outside the round window', () => {
    const stale = results({ BKK: 'fail', SIN: 'fail' }, 120);
    const fresh = results({ TYO: 'pass' });
    expect(evaluateRound({ results: [...stale, ...fresh], now, windowSec: 90 }).kind).toBe(
      'insufficient_data',
    );
  });

  it('ignores an excluded (faulty) location', () => {
    const verdict = evaluateRound({
      results: results({ BKK: 'fail', SIN: 'fail', TYO: 'pass' }),
      now,
      windowSec: 90,
      excluded: new Set<ProbeLocation>(['SIN']),
    });
    expect(verdict.kind).toBe('pass');
  });

  it('keeps only the latest result per location', () => {
    const older = results({ BKK: 'pass' }, 60);
    const newer = results({ BKK: 'fail', SIN: 'fail' }, 5);
    expect(evaluateRound({ results: [...older, ...newer], now, windowSec: 90 }).kind).toBe('hard_fail');
  });

  it('still counts a result stamped a few seconds in the future (probe clock skew)', () => {
    const ahead = {
      location: 'BKK' as const,
      outcome: 'fail' as const,
      checkedAt: new Date(now.getTime() + 2_000),
    };
    const verdict = evaluateRound({ results: [ahead, ...results({ SIN: 'fail' })], now, windowSec: 90 });
    expect(verdict.kind).toBe('hard_fail');
  });

  it('recheck: a location that did not recheck cannot vote again with its first result', () => {
    // 09:48:12 first check: BKK + SIN fail, TYO passes. At 09:48:41 only BKK has rechecked.
    const firstCheck = new Date(now.getTime() - 29_000);
    const round1 = [
      { location: 'BKK' as const, outcome: 'fail' as const, checkedAt: firstCheck },
      { location: 'SIN' as const, outcome: 'fail' as const, checkedAt: firstCheck },
      { location: 'TYO' as const, outcome: 'pass' as const, checkedAt: firstCheck },
    ];
    const recheck = [{ location: 'BKK' as const, outcome: 'fail' as const, checkedAt: now }];
    const verdict = evaluateRound({
      results: [...round1, ...recheck],
      now,
      windowSec: 90,
      after: firstCheck,
    });
    expect(verdict.kind).toBe('insufficient_data');
  });

  it('recheck: INC-0142 — BKK and TYO fail again after the first check → hard fail', () => {
    const firstCheck = new Date(now.getTime() - 29_000);
    const recheck = results({ BKK: 'fail', SIN: 'fail', TYO: 'fail' }, 1);
    const verdict = evaluateRound({ results: recheck, now, windowSec: 90, after: firstCheck });
    expect(verdict.kind).toBe('hard_fail');
  });
});

describe('confirmsDown — two hard-fail checks in a row', () => {
  const hard = { kind: 'hard_fail', failing: ['BKK', 'TYO'] } as const;
  const pass = { kind: 'pass', failing: [] } as const;

  it('needs the immediate recheck to fail too', () => {
    expect(confirmsDown(null, hard)).toBe(false);
    expect(confirmsDown(pass, hard)).toBe(false);
    expect(confirmsDown(hard, hard)).toBe(true);
  });
});

describe('isRegionalProblem', () => {
  it('fires once one location has failed for 5 min', () => {
    expect(isRegionalProblem(new Date(now.getTime() - 4 * 60_000), now)).toBe(false);
    expect(isRegionalProblem(new Date(now.getTime() - 5 * 60_000), now)).toBe(true);
  });
});

describe('faultyLocations', () => {
  it('flags a location that fails more than half of all sites in a round', () => {
    const round = [
      ...Array.from({ length: 10 }, () => ({ location: 'SIN' as const, outcome: 'fail' as const })),
      ...Array.from({ length: 7 }, () => ({ location: 'SIN' as const, outcome: 'pass' as const })),
      ...Array.from({ length: 17 }, () => ({ location: 'BKK' as const, outcome: 'pass' as const })),
    ];
    expect([...faultyLocations(round)]).toEqual(['SIN']);
  });

  it('excludes nothing when every location sees a mass outage (shared host down)', () => {
    const round = (['BKK', 'SIN', 'TYO'] as const).flatMap((location) => [
      ...Array.from({ length: 10 }, () => ({ location, outcome: 'fail' as const })),
      ...Array.from({ length: 7 }, () => ({ location, outcome: 'pass' as const })),
    ]);
    expect(faultyLocations(round).size).toBe(0);
  });
});
