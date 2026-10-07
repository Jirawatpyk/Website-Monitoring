import { describe, expect, it } from 'vitest';
import type { CheckOutcome, ProbeLocation } from '@dxt/shared';
import { UNVERIFIED_NOTE, type OpenIncident, type StoredCheck, type Verification } from './monitor';
import { decideMonitor, type MonitorSnapshot } from './site';
import { BLOCKED_NOTE } from './round';

// INC-0142 timeline (spec §4, §6) with S02a's two Vercel locations. M = 09:47:00 Bangkok
// (02:47:00Z), a probe tick: scheduled checks at M+1 / M+2 s, rechecks ~30 s later.
const M = Date.parse('2026-09-25T02:47:00Z');
const at = (sec: number) => new Date(M + sec * 1000);

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
  now: at(65),
  intervalSec: 60, // Tier 1
  locations: ['SIN', 'TYO'],
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

const downRound = (base = 0) => [
  check('SIN', 'fail', base + 1),
  check('TYO', 'fail', base + 2),
  check('SIN', 'fail', base + 31, 2),
  check('TYO', 'fail', base + 32, 2),
];
const okRound = (base = 0) => [check('SIN', 'pass', base + 1), check('TYO', 'pass', base + 2)];

describe('decideMonitor — DOWN on the check and its recheck (spec §6, S02a Done-when 3)', () => {
  it('both locations fail the scheduled check and the recheck → open, from the first failed check', () => {
    const d = decideMonitor(snapshot(downRound()));
    // Confirmed when the last recheck that agreed came in (board: "Confirmed down 09:48:41") — the
    // clock for "alert within 30 s of the confirm" (PRD §9) and the ack wait.
    expect(d).toMatchObject({ kind: 'open', startedAt: at(1), roundAt: at(0), confirmedAt: at(32) });
    expect(d.kind === 'open' && d.failing.map((c) => [c.location, c.attempt])).toEqual([
      ['SIN', 2],
      ['TYO', 2],
    ]);
  });

  it('only one location fails → no incident, and not an OK round either', () => {
    const d = decideMonitor(
      snapshot([check('SIN', 'fail', 1), check('TYO', 'pass', 2), check('SIN', 'fail', 31, 2)]),
    );
    expect(d).toEqual({ kind: 'none', roundAt: at(0), okRounds: 0 });
  });

  it('a location that didn’t recheck doesn’t vote twice with its scheduled result', () => {
    // Past the round deadline; TYO's scheduled failure (M+2) is later than SIN's (M+1) but isn't a recheck.
    const d = decideMonitor(
      snapshot([check('SIN', 'fail', 1), check('TYO', 'fail', 2), check('SIN', 'fail', 31, 2)], {
        now: at(140),
      }),
    );
    expect(d).toEqual({ kind: 'none', roundAt: at(0), okRounds: 0 });
  });

  it('the recheck passes → no incident', () => {
    const d = decideMonitor(
      snapshot([
        check('SIN', 'fail', 1),
        check('TYO', 'fail', 2),
        check('SIN', 'pass', 31, 2),
        check('TYO', 'pass', 32, 2),
      ]),
    );
    expect(d).toEqual({ kind: 'none', roundAt: at(0), okRounds: 0 });
  });

  it('judges the complete round, not the newer one whose rechecks haven’t landed (engine-reviewer H1)', () => {
    const d = decideMonitor(snapshot([...downRound(), check('SIN', 'fail', 61), check('TYO', 'fail', 62)]));
    expect(d).toMatchObject({ kind: 'open', roundAt: at(0), startedAt: at(1) });
  });

  it('waits for the newer round once the complete one is judged', () => {
    const checks = [...downRound(), check('SIN', 'fail', 61), check('TYO', 'fail', 62)];
    expect(decideMonitor(snapshot(checks, { lastRoundAt: at(0) }))).toEqual({ kind: 'wait' });
  });

  it('real staging cron offsets: SIN checks at :46 and rechecks in the next minute', () => {
    const checks = [
      check('TYO', 'fail', 2),
      check('TYO', 'fail', 32, 2),
      check('SIN', 'fail', 46),
      check('SIN', 'fail', 76, 2),
    ];
    // Before SIN's recheck lands the round isn't complete — even past 75 s from its start.
    expect(decideMonitor(snapshot(checks.slice(0, 3), { now: at(75) }))).toEqual({ kind: 'wait' });
    expect(decideMonitor(snapshot(checks, { now: at(99) }))).toMatchObject({
      kind: 'open',
      startedAt: at(2),
    });
  });

  it('waits for a late recheck until the round deadline', () => {
    const checks = [check('SIN', 'fail', 1), check('TYO', 'fail', 2), check('SIN', 'fail', 31, 2)];
    expect(decideMonitor(snapshot(checks, { now: at(61) }))).toEqual({ kind: 'wait' });
    expect(decideMonitor(snapshot([...checks, check('TYO', 'fail', 62, 2)], { now: at(63) }))).toMatchObject({
      kind: 'open',
    });
  });

  it('waits while a location hasn’t reported, then judges with what arrived', () => {
    expect(decideMonitor(snapshot([check('SIN', 'pass', 1)], { now: at(30) }))).toEqual({ kind: 'wait' });
    // Fewer than 2 locations: keep the status (PRD §5).
    expect(decideMonitor(snapshot([check('SIN', 'pass', 1)], { now: at(140), okRounds: 1 }))).toEqual({
      kind: 'none',
      roundAt: at(0),
      okRounds: 1,
    });
  });

  it('a timeout check and a timeout recheck confirm DOWN from the first check’s start', () => {
    const timeout = (location: ProbeLocation, sec: number, attempt: 1 | 2 = 1) => ({
      ...check(location, 'fail', sec, attempt),
      statusCode: null,
      error: 'Timeout',
    });
    const d = decideMonitor(
      snapshot([timeout('SIN', 0), timeout('TYO', 1), timeout('SIN', 30, 2), timeout('TYO', 31, 2)]),
    );
    expect(d).toMatchObject({ kind: 'open', startedAt: at(0) });
  });

  it('judges Tier 2 rounds on their 3-minute ticks', () => {
    const d = decideMonitor(snapshot(downRound(), { intervalSec: 180 }));
    expect(d).toMatchObject({ kind: 'open', roundAt: at(-120) }); // 02:45:00Z, a 3-minute tick;
    expect(
      decideMonitor(
        snapshot(downRound(), { intervalSec: 180, lastRoundAt: (d as { roundAt: Date }).roundAt }),
      ),
    ).toEqual({
      kind: 'wait',
    });
  });

  it('a DOWN on a recovered incident joins it: DOWN AGAIN, nothing new opens (D-004, S04b)', () => {
    expect(decideMonitor(snapshot(downRound(), { open: incident('needs_root_cause') }))).toMatchObject({
      kind: 'relapse',
      roundAt: at(0),
      severity: 'down',
      trigger: 'hard_fail',
      flapping: false,
    });
  });

  it('does nothing without results', () => {
    expect(decideMonitor(snapshot([]))).toEqual({ kind: 'wait' });
  });
});

describe('decideMonitor — recovery (spec §16.4)', () => {
  it.each(['unacked', 'escalated', 'acknowledged'] as const)(
    'first OK round from %s → RECOVERED at the first OK check, Monitoring',
    (state) => {
      expect(decideMonitor(snapshot(okRound(), { open: incident(state) }))).toEqual({
        kind: 'recover',
        roundAt: at(0),
        recoveredAt: at(1),
        from: state,
        to: 'monitoring',
        okLocations: 2,
        allOk: true,
        autoResolve: false,
        holdSummary: false,
      });
    },
  );

  it('one pass and one fail is not an OK round: no RECOVERED (engine-reviewer H2)', () => {
    const d = decideMonitor(
      snapshot([check('SIN', 'pass', 1), check('TYO', 'fail', 2), check('TYO', 'fail', 32, 2)], {
        open: incident('unacked'),
      }),
    );
    expect(d).toEqual({ kind: 'none', roundAt: at(0), okRounds: 0 });
  });

  it('never mixes an old failure with a new pass', () => {
    // TYO failed in the previous round; only SIN has reported in the new one so far.
    const checks = [check('TYO', 'fail', -58), check('TYO', 'fail', -28, 2), check('SIN', 'pass', 1)];
    expect(
      decideMonitor(snapshot(checks, { now: at(2), open: incident('unacked'), lastRoundAt: at(-60) })),
    ).toEqual({
      kind: 'wait',
    });
  });

  it('second OK round in a row → Needs root cause', () => {
    expect(decideMonitor(snapshot(okRound(), { open: incident('monitoring'), okRounds: 1 }))).toEqual({
      kind: 'settle',
      roundAt: at(0),
      from: 'monitoring',
      to: 'needs_root_cause',
    });
  });

  it('second OK round with a root cause already written → stays in Monitoring', () => {
    expect(
      decideMonitor(snapshot(okRound(), { open: incident('monitoring', true), okRounds: 1 })),
    ).toMatchObject({
      kind: 'settle',
      to: 'monitoring',
    });
  });

  it('later OK rounds change nothing', () => {
    expect(decideMonitor(snapshot(okRound(), { open: incident('needs_root_cause'), okRounds: 2 }))).toEqual({
      kind: 'none',
      roundAt: at(0),
      okRounds: 2,
    });
  });
});

describe('decideMonitor — engine-reviewer round 2 (spec §6, PRD §5)', () => {
  it('staging 6 Oct: the incident starts at SIN 19:07:46 in the split round before (M3)', () => {
    // 12:07 Bangkok-minute M: TYO passed at :02 (before the switch), SIN failed at :46 and its recheck.
    const checks = [
      check('TYO', 'pass', 2),
      check('SIN', 'fail', 46),
      check('SIN', 'fail', 76, 2),
      check('TYO', 'fail', 62),
      check('TYO', 'fail', 92, 2),
      check('SIN', 'fail', 106),
      check('SIN', 'fail', 136, 2),
    ];
    // Round M is split (judged first, nothing opens); round M+60 confirms DOWN from SIN's first failure.
    expect(decideMonitor(snapshot(checks, { now: at(159) }))).toEqual({
      kind: 'none',
      roundAt: at(0),
      okRounds: 0,
    });
    expect(decideMonitor(snapshot(checks, { now: at(159), lastRoundAt: at(0) }))).toMatchObject({
      kind: 'open',
      roundAt: at(60),
      startedAt: at(46),
    });
  });

  it('a confirmed DOWN round is judged even when a later round is already OK (M1a)', () => {
    const checks = [...downRound(), ...okRound(60)];
    expect(decideMonitor(snapshot(checks, { now: at(160) }))).toMatchObject({ kind: 'open', roundAt: at(0) });
  });

  it('two unjudged DOWN rounds open from the first one (M1b)', () => {
    const checks = [...downRound(), ...downRound(60)];
    expect(decideMonitor(snapshot(checks, { now: at(160) }))).toMatchObject({
      kind: 'open',
      roundAt: at(0),
      startedAt: at(1),
    });
  });

  it('skips rounds older than the lookback', () => {
    expect(decideMonitor(snapshot(downRound(), { now: at(600) }))).toEqual({ kind: 'wait' });
  });

  it('Tier 2: a check late in its 3-minute round rechecks across the boundary', () => {
    const checks = [
      check('TYO', 'fail', -118),
      check('TYO', 'fail', -88, 2),
      check('SIN', 'fail', 50),
      check('SIN', 'fail', 80, 2),
    ];
    expect(decideMonitor(snapshot(checks, { intervalSec: 180, now: at(81) }))).toMatchObject({
      kind: 'open',
      roundAt: at(-120),
      startedAt: at(-118),
    });
  });

  it('Tier 3: an incomplete round waits until 75 s after its 5-minute end', () => {
    const checks = [check('SIN', 'pass', -100)]; // round 02:45:00–02:50:00, TYO never reported
    expect(decideMonitor(snapshot(checks, { intervalSec: 300, now: at(254) }))).toEqual({ kind: 'wait' });
    expect(decideMonitor(snapshot(checks, { intervalSec: 300, now: at(256) }))).toMatchObject({
      kind: 'none',
    });
  });

  it('three locations all fail: confirmed by the second agreeing recheck, not a later third (spec §6)', () => {
    const checks = [
      check('BKK', 'fail', 1),
      check('SIN', 'fail', 2),
      check('TYO', 'fail', 3),
      check('SIN', 'fail', 31, 2),
      check('TYO', 'fail', 33, 2),
      check('BKK', 'fail', 50, 2),
    ];
    const d = decideMonitor(snapshot(checks, { locations: ['BKK', 'SIN', 'TYO'] }));
    expect(d).toMatchObject({ kind: 'open', startedAt: at(1), confirmedAt: at(33) });
  });

  it('three locations: 2 pass + 1 regional failure recovers; 1 pass + 1 fail + 1 missing does not (M2)', () => {
    const three = ['BKK', 'SIN', 'TYO'] as const;
    const regional = [check('BKK', 'fail', 1), check('BKK', 'fail', 31, 2), ...okRound()];
    expect(decideMonitor(snapshot(regional, { locations: three, open: incident('unacked') }))).toMatchObject({
      kind: 'recover',
      okLocations: 2,
    });
    const split = [check('SIN', 'pass', 1), check('TYO', 'fail', 2), check('TYO', 'fail', 32, 2)];
    expect(
      decideMonitor(snapshot(split, { locations: three, open: incident('unacked'), now: at(140) })),
    ).toEqual({
      kind: 'none',
      roundAt: at(0),
      okRounds: 0,
    });
  });

  it('with no active locations known, rounds wait for the deadline (L3)', () => {
    expect(
      decideMonitor(snapshot([check('SIN', 'fail', 1), check('TYO', 'fail', 2)], { locations: [] })),
    ).toEqual({
      kind: 'wait',
    });
  });

  it('a failure the recheck clears is not a relapse (L1)', () => {
    const checks = [
      check('SIN', 'fail', 1),
      check('TYO', 'fail', 2),
      check('SIN', 'pass', 31, 2),
      check('TYO', 'pass', 32, 2),
    ];
    expect(decideMonitor(snapshot(checks, { open: incident('needs_root_cause') }))).toEqual({
      kind: 'none',
      roundAt: at(0),
      okRounds: 0,
    });
  });
});

// StatusModel rows "Blocked · …" (spec §6, D-001, D-019) with all three locations: B = blocked,
// F = hard fail, P = pass. The browser verifier's job for the round comes from the runner.
describe('decideMonitor — blocked rounds and the browser verifier (S03, StatusModel)', () => {
  const three = { locations: ['BKK', 'SIN', 'TYO'] as const };
  const blocked = (rest: [ProbeLocation, CheckOutcome][] = [['TYO', 'pass']]) => [
    check('BKK', 'blocked', 1),
    check('SIN', 'blocked', 2),
    ...rest.map(([l, o], i) => check(l, o, 3 + i)),
    // A hard fail is rechecked like any other.
    ...rest.filter(([, o]) => o === 'fail').map(([l], i) => check(l, 'fail', 33 + i, 2)),
  ];
  const withJob = (v: Verification, over: Partial<MonitorSnapshot> = {}) => ({
    ...three,
    verifierAvailable: true,
    verifications: new Map([[at(0).getTime(), v]]),
    ...over,
  });

  it.each<[string, [ProbeLocation, CheckOutcome][]]>([
    ['[B, B, P] 2 blocked, 1 pass', [['TYO', 'pass']]],
    ['[B, B, B] all blocked', [['TYO', 'blocked']]],
    ['[B, B, F] blocked + hard fail make 2', [['TYO', 'fail']]],
  ])('%s, no job yet, verifier up → queue a verify job; the round waits for it', (_name, rest) => {
    expect(decideMonitor(snapshot(blocked(rest), { ...three, verifierAvailable: true }))).toEqual({
      kind: 'verify',
      roundAt: at(0),
    });
  });

  it('[B, P, P] a single block with a pass majority is just OK — no verifier', () => {
    const d = decideMonitor(
      snapshot([check('BKK', 'blocked', 1), check('SIN', 'pass', 2), check('TYO', 'pass', 3)], {
        ...three,
        verifierAvailable: true,
      }),
    );
    expect(d).toEqual({ kind: 'none', roundAt: at(0), okRounds: 1 });
  });

  it('the job is still running → wait', () => {
    expect(decideMonitor(snapshot(blocked(), withJob({ state: 'pending' })))).toEqual({ kind: 'wait' });
  });

  it('page loads and keyword found → OK with the note (Done-when 2)', () => {
    expect(decideMonitor(snapshot(blocked(), withJob({ state: 'loaded', jobId: 'j1' })))).toEqual({
      kind: 'none',
      roundAt: at(0),
      okRounds: 1,
      note: BLOCKED_NOTE,
    });
  });

  it('a verified round recovers an open incident like a pass, with the note', () => {
    const d = decideMonitor(
      snapshot(blocked(), withJob({ state: 'loaded', jobId: 'j1' }, { open: incident('acknowledged') })),
    );
    expect(d).toMatchObject({
      kind: 'recover',
      from: 'acknowledged',
      to: 'monitoring',
      recoveredAt: at(1),
      okLocations: 3,
      note: BLOCKED_NOTE,
    });
  });

  it('page fails in the browser → DOWN from the first blocked check, confirmed when the browser failed', () => {
    const failedAt = at(41);
    const d = decideMonitor(
      snapshot(
        blocked(),
        withJob({ state: 'failed', jobId: 'j1', completedAt: failedAt, detail: 'HTTP 503' }),
      ),
    );
    expect(d).toMatchObject({
      kind: 'open',
      roundAt: at(0),
      startedAt: at(1),
      confirmedAt: failedAt,
      verifyJobId: 'j1',
      browserDetail: 'HTTP 503',
    });
  });

  it('page fails while an incident is in Monitoring → DOWN AGAIN, nothing new (D-004, S04b)', () => {
    const d = decideMonitor(
      snapshot(
        blocked(),
        withJob(
          { state: 'failed', jobId: 'j1', completedAt: at(41), detail: null },
          { open: incident('monitoring') },
        ),
      ),
    );
    expect(d).toMatchObject({ kind: 'relapse', roundAt: at(0), severity: 'down', detectedAt: at(41) });
  });

  it.each<[string, Partial<MonitorSnapshot>, string]>([
    ['the verifier hasn’t polled in 2 min', { ...three, verifierAvailable: false }, 'no_poll'],
    [
      'its job wasn’t picked up in 30 s',
      withJob({ state: 'unavailable', reason: 'not_picked_up' }),
      'not_picked_up',
    ],
    ['its lease ran out', withJob({ state: 'unavailable', reason: 'lease_expired' }), 'lease_expired'],
  ])('[B, B, N] %s → PROBLEM (unverified) at once (D-001)', (_name, over, reason) => {
    // S04a: a PROBLEM like any other trigger, opened with its reason (D-022).
    expect(decideMonitor(snapshot(blocked(), over))).toEqual({
      kind: 'problem',
      roundAt: at(0),
      trigger: 'blocked_unverified',
      detail: expect.objectContaining({ kind: 'blocked', reason }),
      startedAt: at(1),
      note: UNVERIFIED_NOTE,
    });
  });

  it('the browser got a WAF page too → PROBLEM (unverified), not DOWN (D-020)', () => {
    expect(decideMonitor(snapshot(blocked(), withJob({ state: 'blocked', jobId: 'j1' })))).toEqual({
      kind: 'problem',
      roundAt: at(0),
      trigger: 'blocked_unverified',
      detail: expect.objectContaining({ kind: 'blocked', reason: 'browser_blocked' }),
      startedAt: at(1),
      note: UNVERIFIED_NOTE,
    });
  });

  it('an unverified round while an incident is open records the round and the note, nothing new', () => {
    const d = decideMonitor(snapshot(blocked(), { ...three, open: incident('unacked') }));
    expect(d).toEqual({ kind: 'none', roundAt: at(0), okRounds: 0, note: UNVERIFIED_NOTE });
  });

  it('a blocked round resets the OK count, verified or not', () => {
    const d = decideMonitor(
      snapshot([check('SIN', 'blocked', 1), check('TYO', 'blocked', 2)], { okRounds: 1 }),
    );
    expect(d).toMatchObject({ kind: 'problem', trigger: 'blocked_unverified' });
  });

  it('a plain pass round clears the note (note undefined)', () => {
    expect(decideMonitor(snapshot(okRound()))).toEqual({ kind: 'none', roundAt: at(0), okRounds: 1 });
  });

  it('hard fails never wait for the verifier: 2 fails + 1 blocked go DOWN on the recheck', () => {
    const d = decideMonitor(
      snapshot(
        [
          check('BKK', 'blocked', 1),
          check('SIN', 'fail', 2),
          check('TYO', 'fail', 3),
          check('SIN', 'fail', 32, 2),
          check('TYO', 'fail', 33, 2),
        ],
        { ...three, verifierAvailable: false },
      ),
    );
    expect(d).toMatchObject({ kind: 'open', startedAt: at(2), confirmedAt: at(33) });
    expect(d.kind === 'open' && d.verifyJobId).toBeUndefined();
  });

  it('a stopped Bangkok agent leaves two voting: SIN + TYO pass → OK, no false DOWN (Done-when 1)', () => {
    const d = decideMonitor(snapshot(okRound(), { locations: ['SIN', 'TYO'] }));
    expect(d).toEqual({ kind: 'none', roundAt: at(0), okRounds: 1 });
  });
});

// engine-reviewer S03: hard fails never wait for the verifier; a PROBLEM never swallows a DOWN.
describe('decideMonitor — engine review S03 (spec §6, PRD §9, D-021)', () => {
  const three = { locations: ['BKK', 'SIN', 'TYO'] as const };
  const blockedR1 = [check('BKK', 'blocked', 1), check('SIN', 'blocked', 2), check('TYO', 'pass', 3)];
  const downR2 = [
    check('BKK', 'pass', 61),
    check('SIN', 'fail', 62),
    check('TYO', 'fail', 63),
    check('SIN', 'fail', 92, 2),
    check('TYO', 'fail', 93, 2),
  ];
  const pendingR1 = {
    verifierAvailable: true,
    verifications: new Map([[at(0).getTime(), { state: 'pending' as const }]]),
  };

  it('H1: a blocked round waiting for its verifier doesn’t hold back a confirmed DOWN in the next round', () => {
    expect(
      decideMonitor(snapshot([...blockedR1, ...downR2], { ...three, ...pendingR1, now: at(100) })),
    ).toMatchObject({
      kind: 'open',
      roundAt: at(60),
      startedAt: at(62),
      confirmedAt: at(93),
    });
  });

  it('H1: a later OK round still waits behind the pending one', () => {
    const okR2 = [check('BKK', 'pass', 61), check('SIN', 'pass', 62), check('TYO', 'pass', 63)];
    expect(
      decideMonitor(snapshot([...blockedR1, ...okR2], { ...three, ...pendingR1, now: at(100) })),
    ).toEqual({ kind: 'wait' });
  });

  it('N3: a decided DOWN isn’t held back by an older round still missing a location', () => {
    // R1: SIN + TYO pass, Bangkok (beating) never reported — ready only at its deadline (+135).
    const okR1 = [check('SIN', 'pass', 1), check('TYO', 'pass', 2)];
    expect(decideMonitor(snapshot([...okR1, ...downR2], { ...three, now: at(100) }))).toMatchObject({
      kind: 'open',
      roundAt: at(60),
    });
  });

  it('N1: the lookback keeps a blocked round in view for its verify job’s longest wait', () => {
    // Ready at its deadline (+135), job queued busy for 2 min, then leased 60 s: judged at +330.
    const d = decideMonitor(
      snapshot([check('BKK', 'blocked', 1), check('SIN', 'blocked', 2)], {
        ...three,
        now: at(330),
        verifications: new Map([
          [at(0).getTime(), { state: 'unavailable' as const, reason: 'lease_expired' as const }],
        ]),
      }),
    );
    expect(d).toMatchObject({ kind: 'problem', roundAt: at(0), detail: { reason: 'lease_expired' } });
  });

  it('M2: two locations confirmed DOWN → judged without waiting for Bangkok (staging offsets)', () => {
    const d = decideMonitor(
      snapshot(
        [
          check('TYO', 'fail', 2),
          check('TYO', 'fail', 32, 2),
          check('SIN', 'fail', 46),
          check('SIN', 'fail', 76, 2),
        ],
        { ...three, now: at(80) },
      ),
    );
    expect(d).toMatchObject({ kind: 'open', startedAt: at(2), confirmedAt: at(76) });
  });

  it('H2 (INC-0138 Tubtong): DOWN confirmed while a PROBLEM (unverified) is open → escalate, not a silent relapse', () => {
    const problem: OpenIncident = {
      id: 'inc-138',
      state: 'unacked',
      severity: 'problem',
      hasRootCause: false,
    };
    expect(decideMonitor(snapshot(downRound(), { open: problem }))).toMatchObject({
      kind: 'escalate',
      roundAt: at(0),
      downStartedAt: at(1),
      confirmedAt: at(32),
    });
  });

  it('H2: the browser fails while a PROBLEM is open → escalate with the verify job', () => {
    const problem: OpenIncident = {
      id: 'inc-138',
      state: 'acknowledged',
      severity: 'problem',
      hasRootCause: false,
    };
    const d = decideMonitor(
      snapshot(blockedR1, {
        ...three,
        open: problem,
        verifications: new Map([
          [
            at(0).getTime(),
            { state: 'failed' as const, jobId: 'j1', completedAt: at(41), detail: 'HTTP 503' },
          ],
        ]),
      }),
    );
    expect(d).toMatchObject({
      kind: 'escalate',
      confirmedAt: at(41),
      verifyJobId: 'j1',
      browserDetail: 'HTTP 503',
    });
  });

  it('L4: a [B, B, F] round the browser loaded counts the two reachable locations', () => {
    const d = decideMonitor(
      snapshot(
        [
          check('BKK', 'blocked', 1),
          check('SIN', 'blocked', 2),
          check('TYO', 'fail', 3),
          check('TYO', 'fail', 33, 2),
        ],
        {
          ...three,
          open: incident('unacked'),
          verifications: new Map([[at(0).getTime(), { state: 'loaded' as const, jobId: 'j1' }]]),
        },
      ),
    );
    expect(d).toMatchObject({ kind: 'recover', okLocations: 2 });
  });
});
