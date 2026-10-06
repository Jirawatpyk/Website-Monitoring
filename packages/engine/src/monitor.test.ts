import { describe, expect, it } from 'vitest';
import type { CheckOutcome, ProbeLocation } from '@dxt/shared';
import { decideMonitor, type MonitorSnapshot, type OpenIncident, type StoredCheck } from './monitor';

// INC-0142 shape (spec §4, §6), with S02a's two Vercel locations: scheduled checks at 09:47:30
// Bangkok (02:47:30Z), rechecks ~30 s later, the engine runs at 02:48:41Z.
const t0 = Date.parse('2026-09-25T02:47:30Z');
const now = new Date('2026-09-25T02:48:41Z');
const at = (sec: number) => new Date(t0 + sec * 1000);

function check(location: ProbeLocation, outcome: CheckOutcome, sec: number, attempt: 1 | 2 = 1): StoredCheck {
  return {
    location,
    outcome,
    checkedAt: at(sec),
    attempt,
    statusCode: outcome === 'fail' ? 500 : 200,
    error: null,
  };
}

const snapshot = (checks: StoredCheck[], over: Partial<MonitorSnapshot> = {}): MonitorSnapshot => ({
  checks,
  now,
  windowSec: 90, // Tier 1
  lastRoundAt: null,
  okRounds: 0,
  open: null,
  ...over,
});

const incident = (state: OpenIncident['state'], hasRootCause = false): OpenIncident => ({
  id: 'inc-1',
  state,
  severity: 'down',
  hasRootCause,
});

describe('decideMonitor — DOWN on the check and its recheck (spec §6, S02a Done-when 3)', () => {
  it('both locations fail the scheduled check and the recheck → open, from the first failed check', () => {
    const d = decideMonitor(
      snapshot([
        check('SIN', 'fail', 0),
        check('TYO', 'fail', 1),
        check('SIN', 'fail', 31, 2),
        check('TYO', 'fail', 32, 2),
      ]),
    );
    expect(d).toMatchObject({ kind: 'open', startedAt: at(0), roundAt: at(1) });
    expect(d.kind === 'open' && d.failing.map((c) => [c.location, c.attempt])).toEqual([
      ['SIN', 2],
      ['TYO', 2],
    ]);
  });

  it('only one location fails → no incident', () => {
    const d = decideMonitor(
      snapshot([check('SIN', 'fail', 0), check('TYO', 'pass', 1), check('SIN', 'fail', 31, 2)]),
    );
    expect(d).toEqual({ kind: 'none', roundAt: at(1), okRounds: 1 });
  });

  it('a location that didn’t recheck doesn’t vote twice with its scheduled result', () => {
    // TYO's scheduled check (01 s) is later than SIN's first failure (00 s); it must not count as a recheck.
    const d = decideMonitor(
      snapshot([check('SIN', 'fail', 0), check('TYO', 'fail', 1), check('SIN', 'fail', 31, 2)]),
    );
    expect(d).toEqual({ kind: 'none', roundAt: at(1), okRounds: 0 });
  });

  it('the recheck passes → no incident', () => {
    const d = decideMonitor(
      snapshot([
        check('SIN', 'fail', 0),
        check('TYO', 'fail', 1),
        check('SIN', 'pass', 31, 2),
        check('TYO', 'pass', 32, 2),
      ]),
    );
    expect(d).toEqual({ kind: 'none', roundAt: at(1), okRounds: 0 });
  });

  it('waits while the recheck may still arrive', () => {
    const d = decideMonitor(snapshot([check('SIN', 'fail', 0), check('TYO', 'fail', 1)], { now: at(20) }));
    expect(d).toEqual({ kind: 'wait' });
  });

  it('judges a round once', () => {
    const checks = [
      check('SIN', 'fail', 0),
      check('TYO', 'fail', 1),
      check('SIN', 'fail', 31, 2),
      check('TYO', 'fail', 32, 2),
    ];
    expect(decideMonitor(snapshot(checks, { lastRoundAt: at(1) }))).toEqual({ kind: 'wait' });
  });

  it('does nothing without results in the window', () => {
    expect(decideMonitor(snapshot([check('SIN', 'fail', -200)]))).toEqual({ kind: 'wait' });
  });

  it('opens nothing new while an incident is open (relapse is D-004, S04)', () => {
    const checks = [
      check('SIN', 'fail', 0),
      check('TYO', 'fail', 1),
      check('SIN', 'fail', 31, 2),
      check('TYO', 'fail', 32, 2),
    ];
    expect(decideMonitor(snapshot(checks, { open: incident('monitoring'), okRounds: 1 }))).toEqual({
      kind: 'none',
      roundAt: at(1),
      okRounds: 0,
    });
  });

  it('keeps the status when fewer than 2 locations reported (PRD §5)', () => {
    expect(decideMonitor(snapshot([check('SIN', 'pass', 0)], { okRounds: 1 }))).toEqual({
      kind: 'none',
      roundAt: at(0),
      okRounds: 1,
    });
  });
});

describe('decideMonitor — recovery (spec §16.4)', () => {
  const ok = [check('SIN', 'pass', 0), check('TYO', 'pass', 1)];

  it.each(['unacked', 'escalated', 'acknowledged'] as const)(
    'first OK round from %s → RECOVERED, Monitoring',
    (state) => {
      expect(decideMonitor(snapshot(ok, { open: incident(state) }))).toEqual({
        kind: 'recover',
        roundAt: at(1),
        from: state,
        to: 'monitoring',
        okLocations: 2,
      });
    },
  );

  it('second OK round in a row → Needs root cause', () => {
    expect(decideMonitor(snapshot(ok, { open: incident('monitoring'), okRounds: 1 }))).toEqual({
      kind: 'settle',
      roundAt: at(1),
      from: 'monitoring',
      to: 'needs_root_cause',
    });
  });

  it('second OK round with a root cause already written → stays in Monitoring', () => {
    expect(decideMonitor(snapshot(ok, { open: incident('monitoring', true), okRounds: 1 }))).toMatchObject({
      kind: 'settle',
      to: 'monitoring',
    });
  });

  it('later OK rounds change nothing', () => {
    expect(decideMonitor(snapshot(ok, { open: incident('needs_root_cause'), okRounds: 2 }))).toEqual({
      kind: 'none',
      roundAt: at(1),
      okRounds: 2,
    });
  });

  it('a failed round resets the OK count', () => {
    const d = decideMonitor(
      snapshot([check('SIN', 'blocked', 0), check('TYO', 'blocked', 1)], { okRounds: 1 }),
    );
    expect(d).toEqual({ kind: 'none', roundAt: at(1), okRounds: 0 });
  });
});
