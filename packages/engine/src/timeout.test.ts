import { describe, expect, it } from 'vitest';
import type { CheckOutcome, ProbeLocation } from '@dxt/shared';
import type { OpenIncident, StoredCheck } from './monitor';
import { decideSite, NEW_MONITOR, type MonitorCarry, type SiteMonitor, type SiteSnapshot } from './site';

// D-049: a timeout alone needs two failing rounds in a row before DOWN; a 5xx, a refused connection,
// DNS or TLS still confirm in one round (check + recheck). The cases are production's 14 days before
// 30 Oct 2026: every DOWN was "Timeout > 30 s (BKK, TYO)" with SIN passing. R = a Tier 1 minute tick.
const R = Date.parse('2026-10-16T06:43:00Z'); // INC-0015 ENEOS, 13:43 Bangkok
const at = (sec: number) => new Date(R + sec * 1000);
const LOCATIONS: ProbeLocation[] = ['BKK', 'SIN', 'TYO'];

function check(
  location: ProbeLocation,
  outcome: CheckOutcome,
  sec: number,
  over: Partial<StoredCheck> = {},
): StoredCheck {
  return {
    location,
    outcome,
    checkedAt: at(sec),
    attempt: 1,
    statusCode: outcome === 'fail' ? null : 200,
    error: outcome === 'fail' ? 'Timeout' : null,
    responseMs: outcome === 'fail' ? null : 900,
    ...over,
  };
}
const recheck = (location: ProbeLocation, sec: number, over: Partial<StoredCheck> = {}) =>
  check(location, 'fail', sec, { attempt: 2, ...over });

/** BKK and TYO time out on the check and the recheck, SIN passes (every production case). */
const timeoutRound = (base: number, over: Partial<StoredCheck> = {}) => [
  check('BKK', 'fail', base + 1, over),
  check('SIN', 'pass', base + 1),
  check('TYO', 'fail', base + 2, over),
  recheck('BKK', base + 31, over),
  recheck('TYO', base + 32, over),
];
const okRound = (base: number) => LOCATIONS.map((l) => check(l, 'pass', base + 1));

const carry = (over: Partial<MonitorCarry> = {}): MonitorCarry => ({ ...NEW_MONITOR, ...over });
/** The carry a judged timeout round leaves: BKK and TYO failing since its checks. */
const afterTimeoutRound = (base: number) =>
  carry({ failingSince: { BKK: at(base + 1).toISOString(), TYO: at(base + 2).toISOString() } });

function home(
  checks: StoredCheck[],
  c: MonitorCarry = NEW_MONITOR,
  over: Partial<SiteMonitor> = {},
): SiteMonitor {
  return {
    id: 'home',
    isPrimary: true,
    url: 'https://eneos.example/',
    slowThresholdMs: 10_000,
    allowedRedirectDomains: [],
    checks,
    carry: c,
    ...over,
  };
}

const site = (monitors: SiteMonitor[], over: Partial<SiteSnapshot> = {}): SiteSnapshot => ({
  now: at(140), // past the first round's deadline (60 s + 75 s)
  intervalSec: 60,
  locations: LOCATIONS,
  lastRoundAt: null,
  okRounds: 0,
  open: null,
  monitors,
  ...over,
});

describe('a timeout needs two failing rounds before DOWN (D-049)', () => {
  it('INC-0015 ENEOS (Tier 1): one timeout round is no DOWN — it only starts the streak', () => {
    const d = decideSite(site([home(timeoutRound(0))]));
    expect(d.kind).toBe('none');
    expect(d.kind !== 'wait' && d.kind !== 'verify' && d.monitors[0]?.failingSince).toEqual({
      BKK: at(1).toISOString(),
      TYO: at(2).toISOString(),
    });
  });

  it('…and the next round OK ends it: nothing ever opened', () => {
    const d = decideSite(
      site([home([...timeoutRound(0), ...okRound(60)], afterTimeoutRound(0))], {
        lastRoundAt: at(0),
        now: at(200),
      }),
    );
    expect(d.kind).toBe('none');
    expect(d.kind !== 'wait' && d.kind !== 'verify' && d.monitors[0]?.failingSince).toEqual({});
  });

  it('INC-0027 ENEOS: the second timeout round is DOWN, from the first round’s first timeout', () => {
    const d = decideSite(
      site([home([...timeoutRound(0), ...timeoutRound(60)], afterTimeoutRound(0))], {
        lastRoundAt: at(0),
        now: at(200),
      }),
    );
    expect(d).toMatchObject({ kind: 'open', startedAt: at(1), roundAt: at(60), status: 'down' });
  });

  it('INC-0036 EQHO (Tier 2): DOWN on the second 3-minute round', () => {
    // 3-minute ticks: 06:42 (at(-60)) and 06:45 (at(120)).
    const d = decideSite(
      site([home([...timeoutRound(-60), ...timeoutRound(120)], afterTimeoutRound(-60))], {
        intervalSec: 180,
        lastRoundAt: at(-60),
        now: at(380),
      }),
    );
    expect(d).toMatchObject({ kind: 'open', startedAt: at(-59), roundAt: at(120) });
  });

  it('the round before is read from its own checks: a carried clock alone is not enough', () => {
    const d = decideSite(
      site([home(timeoutRound(60), afterTimeoutRound(0))], { lastRoundAt: at(0), now: at(200) }),
    );
    expect(d.kind).toBe('none');
  });

  it('one location failing the round before is not enough', () => {
    const before = [check('BKK', 'fail', 1), check('SIN', 'pass', 1), check('TYO', 'pass', 2)];
    const d = decideSite(
      site([home([...before, ...timeoutRound(60)])], { lastRoundAt: at(0), now: at(200) }),
    );
    expect(d.kind).toBe('none');
  });

  it('engine review H1: timeout → a round the engine skipped (BKK late, TYO passing) → timeout is no DOWN', () => {
    const skipped = [check('SIN', 'pass', 61), check('TYO', 'pass', 62)];
    const d = decideSite(
      site([home([...timeoutRound(0), ...skipped, ...timeoutRound(120)], afterTimeoutRound(0))], {
        lastRoundAt: at(0),
        now: at(185),
      }),
    );
    // No DOWN to judge past it, so the engine waits for the incomplete round instead of skipping it.
    expect(d.kind).toBe('wait');
  });

  it('a round with no data in between is no "round before": the streak starts again', () => {
    const d = decideSite(
      site([home([...timeoutRound(0), ...timeoutRound(120)], afterTimeoutRound(0))], {
        lastRoundAt: at(60),
        now: at(260),
      }),
    );
    expect(d.kind).toBe('none');
  });

  it('a stall moving between locations still counts: {BKK, TYO} then {SIN, TYO} → DOWN', () => {
    const moved = [
      check('BKK', 'pass', 61),
      check('SIN', 'fail', 61),
      check('TYO', 'fail', 62),
      recheck('SIN', 91),
      recheck('TYO', 92),
    ];
    const d = decideSite(
      site([home([...timeoutRound(0), ...moved], afterTimeoutRound(0))], {
        lastRoundAt: at(0),
        now: at(200),
      }),
    );
    expect(d).toMatchObject({ kind: 'open', roundAt: at(60) });
  });

  it('all three locations timing out two rounds running → DOWN on the second', () => {
    const three = (base: number) => [
      ...LOCATIONS.map((l, i) => check(l, 'fail', base + 1 + i)),
      ...LOCATIONS.map((l, i) => recheck(l, base + 31 + i)),
    ];
    expect(decideSite(site([home(three(0))])).kind).toBe('none');
    const d = decideSite(site([home([...three(0), ...three(60)])], { lastRoundAt: at(0), now: at(200) }));
    expect(d).toMatchObject({ kind: 'open', startedAt: at(1), roundAt: at(60) });
  });

  it('INC-0035 DxT Games (Tier 3): a timeout, then OK five minutes later → no DOWN', () => {
    // 5-minute ticks: 06:40 (at(-180)) and 06:45 (at(120)).
    expect(decideSite(site([home(timeoutRound(-180))], { intervalSec: 300, now: at(200) })).kind).toBe(
      'none',
    );
    const d = decideSite(
      site([home([...timeoutRound(-180), ...okRound(120)])], {
        intervalSec: 300,
        lastRoundAt: at(-180),
        now: at(500),
      }),
    );
    expect(d.kind).toBe('none');
  });

  it('a 503 on the check and a timeout on its recheck confirm in one round (not a timeout alone)', () => {
    const rows = [
      check('BKK', 'fail', 1, { statusCode: 503, error: null }),
      check('SIN', 'pass', 1),
      check('TYO', 'fail', 2, { statusCode: 503, error: null }),
      recheck('BKK', 31),
      recheck('TYO', 32),
    ];
    expect(decideSite(site([home(rows)]))).toMatchObject({ kind: 'open', startedAt: at(1) });
  });

  it('INC-0142 MuvMi (spec §6): timeouts at BKK and TYO with a 504 at SIN confirm in one round', () => {
    const rows = [
      check('BKK', 'fail', 1),
      check('SIN', 'fail', 1, { statusCode: 504, error: null }),
      check('TYO', 'fail', 2),
      recheck('BKK', 31),
      recheck('SIN', 31, { statusCode: 504, error: null }),
      recheck('TYO', 32),
    ];
    expect(decideSite(site([home(rows)]))).toMatchObject({ kind: 'open', startedAt: at(1) });
  });

  it('a recovered incident relapses on a timeout only on its second round', () => {
    const open: OpenIncident = { id: 'inc-1', state: 'monitoring', severity: 'down', hasRootCause: false };
    expect(decideSite(site([home(timeoutRound(0))], { open })).kind).toBe('none');
    const d = decideSite(
      site([home([...timeoutRound(0), ...timeoutRound(60)], afterTimeoutRound(0))], {
        open,
        lastRoundAt: at(0),
        now: at(200),
      }),
    );
    expect(d).toMatchObject({ kind: 'relapse', startedAt: at(1) });
  });

  it('a 503 still confirms DOWN in one round (unchanged)', () => {
    const d = decideSite(site([home(timeoutRound(0, { statusCode: 503, error: null }))]));
    expect(d).toMatchObject({ kind: 'open', startedAt: at(1) });
  });

  it('a refused connection still confirms DOWN in one round (unchanged)', () => {
    const d = decideSite(site([home(timeoutRound(0, { error: 'ECONNREFUSED' }))]));
    expect(d).toMatchObject({ kind: 'open', startedAt: at(1) });
  });

  it('a timeout at one location and a 503 at another confirm in one round: not a timeout alone', () => {
    const mixed = [
      check('BKK', 'fail', 1),
      check('SIN', 'pass', 1),
      check('TYO', 'fail', 2, { statusCode: 503, error: null }),
      recheck('BKK', 31),
      recheck('TYO', 32, { statusCode: 503, error: null }),
    ];
    expect(decideSite(site([home(mixed)]))).toMatchObject({ kind: 'open' });
  });

  it('a key page that times out two rounds running is a PROBLEM (key page), not one round', () => {
    const page = (checks: StoredCheck[], c: MonitorCarry = NEW_MONITOR): SiteMonitor => ({
      ...home(checks, c),
      id: 'contact',
      isPrimary: false,
      url: 'https://eneos.example/contact-us',
    });
    expect(decideSite(site([home(okRound(0)), page(timeoutRound(0))])).kind).toBe('none');
    const d = decideSite(
      site([home(okRound(60)), page([...timeoutRound(0), ...timeoutRound(60)], afterTimeoutRound(0))], {
        lastRoundAt: at(0),
        now: at(200),
      }),
    );
    expect(d).toMatchObject({ kind: 'problem', trigger: 'key_page' });
  });

  it('an open PROBLEM escalates to DOWN only on the second timeout round (D-021)', () => {
    const open: OpenIncident = { id: 'inc-1', state: 'unacked', severity: 'problem', hasRootCause: false };
    expect(decideSite(site([home(timeoutRound(0))], { open })).kind).not.toBe('escalate');
    const d = decideSite(
      site([home([...timeoutRound(0), ...timeoutRound(60)], afterTimeoutRound(0))], {
        open,
        lastRoundAt: at(0),
        now: at(200),
      }),
    );
    expect(d).toMatchObject({ kind: 'escalate', downStartedAt: at(1) });
  });
});
