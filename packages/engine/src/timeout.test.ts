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

  it('a newer round still incomplete changes nothing: the second timeout round is judged DOWN', () => {
    const newer = [check('BKK', 'fail', 121)]; // no recheck, no other location yet
    const d = decideSite(
      site([home([...timeoutRound(0), ...timeoutRound(60), ...newer], afterTimeoutRound(0))], {
        lastRoundAt: at(0),
        now: at(140),
      }),
    );
    expect(d).toMatchObject({ kind: 'open', roundAt: at(60), startedAt: at(1) });
  });
});

describe('a timeout on a site behind a WAF, decided by one location (D-027, D-049)', () => {
  // Bangkok Airways style: SIN and TYO WAF-blocked sit out, BKK alone decides (need = 1).
  const wafRound = (base: number, bkk: Partial<StoredCheck> = {}) => [
    check('BKK', 'fail', base + 1, { controlOk: true, ...bkk }),
    check('SIN', 'blocked', base + 2, { statusCode: 403, error: null, waf: 'cloudflare' }),
    check('TYO', 'blocked', base + 3, { statusCode: 403, error: null, waf: 'cloudflare' }),
    recheck('BKK', base + 31, { controlOk: true, ...bkk }),
  ];
  const waf = (checks: StoredCheck[], over: Partial<SiteSnapshot> = {}) =>
    decideSite(site([home(checks)], { behindWaf: true, ...over }));

  it('the first timeout round of the one voter is no DOWN; the second is', () => {
    expect(waf(wafRound(0)).kind).toBe('none');
    expect(waf([...wafRound(0), ...wafRound(60)], { lastRoundAt: at(0), now: at(200) })).toMatchObject({
      kind: 'open',
      startedAt: at(1),
      roundAt: at(60),
    });
  });

  it('a Bangkok failure its control check can’t vouch for is no "round before"', () => {
    const untrusted = wafRound(0, { controlOk: false });
    expect(waf([...untrusted, ...wafRound(60)], { lastRoundAt: at(0), now: at(200) }).kind).toBe('none');
  });
});

describe('Tier 2–3: a timeout round is confirmed a minute later (D-051)', () => {
  // INC-0036 EQHO (Tier 2): the 3-minute round at 06:42 (at(-60)); every location runs a confirm check
  // at the next minute tick (06:43, at(0)) with its own recheck. SIN passes as in production.
  const T = -60;
  const tier2 = (checks: StoredCheck[], over: Partial<SiteSnapshot> = {}) =>
    decideSite(site([home(checks)], { intervalSec: 180, now: at(T + 150), ...over }));
  const confirm = (location: ProbeLocation, outcome: CheckOutcome, sec: number) =>
    check(location, outcome, sec, { confirm: true });
  const confirmRecheck = (location: ProbeLocation, sec: number) => recheck(location, sec, { confirm: true });
  /** BKK and TYO time out on the confirm and its recheck, SIN's confirm passes. */
  const failingConfirm = (base: number) => [
    confirm('BKK', 'fail', base + 61),
    confirm('TYO', 'fail', base + 62),
    confirm('SIN', 'pass', base + 106),
    confirmRecheck('BKK', base + 91),
    confirmRecheck('TYO', base + 92),
  ];
  const passingConfirm = (base: number) => LOCATIONS.map((l) => confirm(l, 'pass', base + 61));

  it('the confirm and its recheck failing at 2 locations is the second round: DOWN from the first timeout', () => {
    const d = tier2([...timeoutRound(T), ...failingConfirm(T)]);
    expect(d).toMatchObject({
      kind: 'open',
      roundAt: at(T),
      startedAt: at(T + 1),
      confirmedAt: at(T + 92),
      status: 'down',
    });
  });

  it('INC-0035 DxT Games (Tier 3): the same a minute after a 5-minute round', () => {
    const d = decideSite(
      site([home([...timeoutRound(-180), ...failingConfirm(-180)])], { intervalSec: 300, now: at(-20) }),
    );
    expect(d).toMatchObject({ kind: 'open', roundAt: at(-180), startedAt: at(-179) });
  });

  it('a passing confirm makes the round a blip (D-049), kept for D-050', () => {
    const d = tier2([...timeoutRound(T), ...passingConfirm(T)], { now: at(T + 80) });
    expect(d.kind).toBe('none');
    expect(d.kind === 'none' && d.monitors[0]?.blips).toEqual([at(T + 1)]);
  });

  it('a confirm never stands in for the round’s own check', () => {
    // If the passing confirms replaced the scheduled timeouts, the round would be an OK round.
    const d = tier2([...timeoutRound(T), ...passingConfirm(T)], { now: at(T + 80) });
    expect(d.kind === 'none' && d.status).toBeNull();
  });

  it('waits for confirms still to come, and for a failed confirm’s recheck', () => {
    expect(tier2(timeoutRound(T), { now: at(T + 70) }).kind).toBe('wait');
    const noRecheck = [
      confirm('BKK', 'fail', T + 61),
      confirm('TYO', 'fail', T + 62),
      confirm('SIN', 'pass', T + 61),
    ];
    expect(tier2([...timeoutRound(T), ...noRecheck], { now: at(T + 80) }).kind).toBe('wait');
  });

  it('stops waiting once 2 failures can no longer happen: one fails, two pass → blip at once', () => {
    const oneFails = [
      confirm('BKK', 'fail', T + 61),
      confirm('TYO', 'pass', T + 62),
      confirm('SIN', 'pass', T + 61),
    ];
    expect(tier2([...timeoutRound(T), ...oneFails], { now: at(T + 70) }).kind).toBe('none');
  });

  it('no confirm by the round’s deadline → a blip, as before D-051', () => {
    expect(tier2(timeoutRound(T), { now: at(T + 180 + 76) }).kind).toBe('none');
  });

  it('confirms that come after the round was judged change nothing', () => {
    expect(tier2([...timeoutRound(T), ...failingConfirm(T)], { lastRoundAt: at(T) }).kind).toBe('wait');
  });

  it('a confirm in the round before is not that round’s own check (firstTimeoutRound)', () => {
    // The round at 06:39 passed; its stray failing confirms must not make it "a round that failed".
    const before = [...okRound(T - 180), confirm('BKK', 'fail', T - 119), confirm('TYO', 'fail', T - 118)];
    const d = tier2([...before, ...timeoutRound(T)], { lastRoundAt: at(T - 180), now: at(T + 70) });
    expect(d.kind).toBe('wait');
  });

  it('a WAF round one location decided can’t ask for a confirm: a blip at once, no wait', () => {
    const waf = { statusCode: 403, error: null, waf: 'cloudflare' as const };
    const round = [
      check('BKK', 'fail', T + 1, { controlOk: true }),
      check('SIN', 'blocked', T + 2, waf),
      check('TYO', 'blocked', T + 3, waf),
      recheck('BKK', T + 31, { controlOk: true }),
    ];
    expect(tier2(round, { behindWaf: true, now: at(T + 70) }).kind).toBe('none');
  });

  it('an open PROBLEM escalates to DOWN on a failing confirm (D-021)', () => {
    const open: OpenIncident = { id: 'i1', state: 'unacked', severity: 'problem', hasRootCause: false };
    const d = tier2([...timeoutRound(T), ...failingConfirm(T)], { open });
    expect(d).toMatchObject({ kind: 'escalate', downStartedAt: at(T + 1) });
  });

  it('a round waiting for its confirm never holds back a DOWN on the next round, but holds an OK one', () => {
    // No confirm came for 06:42 (BKK on an old agent, say) and 06:45 times out again: DOWN at once.
    const down = tier2([...timeoutRound(T), ...timeoutRound(T + 180)], { now: at(T + 220) });
    expect(down).toMatchObject({ kind: 'open', roundAt: at(T + 180), startedAt: at(T + 1) });
    // 06:45 passes: it waits behind 06:42 (judged oldest first) until that one is decided.
    const ok = tier2([...timeoutRound(T), ...okRound(T + 180)], { now: at(T + 230) });
    expect(ok.kind).toBe('wait');
  });

  it('DOWN AGAIN on the next round isn’t held by a round waiting for its confirm (engine review M2)', () => {
    const open: OpenIncident = {
      id: 'i1',
      state: 'monitoring',
      severity: 'down',
      hasRootCause: false,
      episodeSeverity: 'down',
    };
    const fiveOhThree = { statusCode: 503, error: null };
    const next = [
      check('BKK', 'fail', T + 181, fiveOhThree),
      check('SIN', 'pass', T + 181),
      check('TYO', 'fail', T + 182, fiveOhThree),
      recheck('BKK', T + 211, fiveOhThree),
      recheck('TYO', T + 212, fiveOhThree),
    ];
    const d = tier2([...timeoutRound(T), ...next], { open, now: at(T + 220) });
    expect(d).toMatchObject({ kind: 'relapse', severity: 'down', roundAt: at(T + 180) });
  });

  it('a confirm from a location faulty in its own minute is no evidence (spec §15.3, engine review M1)', () => {
    // BKK fails most sites in the minute of its confirm: only TYO's failing confirm counts → no DOWN.
    const faulty = new Map([[Math.floor(at(T + 61).getTime() / 60_000) * 60_000, new Set(['BKK' as const])]]);
    const d = tier2([...timeoutRound(T), ...failingConfirm(T)], { faulty });
    expect(d.kind).toBe('none');
  });

  it('Tier 1 never waits for a confirm: its next round is a minute away', () => {
    expect(decideSite(site([home(timeoutRound(0))], { now: at(70) })).kind).toBe('none');
  });
});
