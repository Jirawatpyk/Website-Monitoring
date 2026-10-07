import { describe, expect, it } from 'vitest';
import type { CheckOutcome, ProbeLocation } from '@dxt/shared';
import { UNVERIFIED_NOTE, type OpenIncident, type StoredCheck, type Verification } from './monitor';
import { BLOCKED_NOTE } from './round';
import { decideSite, NEW_MONITOR, type MonitorCarry, type SiteMonitor, type SiteSnapshot } from './site';

// Site status from every monitor (spec §6, §11, StatusModel; D-022). Tier 2 (3-minute rounds) like
// INC-0141 Fuji Links: R = Fri 25 Sep 09:51 Bangkok (02:51Z), a 3-minute tick.
const R = Date.parse('2026-09-25T02:51:00Z');
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
    statusCode: outcome === 'fail' ? 500 : outcome === 'blocked' ? 403 : 200,
    error: null,
    responseMs: 800,
    ...over,
  };
}
const all = (outcome: CheckOutcome, sec = 1, over: Partial<StoredCheck> = {}) =>
  LOCATIONS.map((l, i) => check(l, outcome, sec + i, over));
const recheck = (location: ProbeLocation, outcome: CheckOutcome, sec: number) =>
  check(location, outcome, sec, { attempt: 2 });
const failed = (sec = 1) => [
  ...all('fail', sec),
  recheck('BKK', 'fail', sec + 30),
  recheck('SIN', 'fail', sec + 31),
  recheck('TYO', 'fail', sec + 32),
];

function monitor(id: string, checks: StoredCheck[], over: Partial<SiteMonitor> = {}): SiteMonitor {
  return {
    id,
    isPrimary: id === 'home',
    url: id === 'home' ? 'https://fujilinks.example/' : `https://fujilinks.example/${id}`,
    slowThresholdMs: 5_000,
    allowedRedirectDomains: [],
    checks,
    carry: NEW_MONITOR,
    ...over,
  };
}

const site = (monitors: SiteMonitor[], over: Partial<SiteSnapshot> = {}): SiteSnapshot => ({
  now: at(260), // past the round's deadline (180 s + 75 s): judged with what arrived
  intervalSec: 180,
  locations: LOCATIONS,
  lastRoundAt: null,
  okRounds: 0,
  open: null,
  monitors,
  ...over,
});

const incident = (
  state: OpenIncident['state'],
  severity: OpenIncident['severity'] = 'down',
): OpenIncident => ({
  id: 'inc-1',
  state,
  severity,
  hasRootCause: false,
});
const carry = (over: Partial<MonitorCarry>): MonitorCarry => ({ ...NEW_MONITOR, ...over });

describe('decideSite — slow (StatusModel: p50 over the threshold 3 checks in a row)', () => {
  const slow = all('pass', 1, { responseMs: 5_800 });

  it('INC-0141 Fuji Links: the third slow round (p50 5.8 s > 5 s) opens PROBLEM (Slow)', () => {
    const d = decideSite(site([monitor('home', slow, { carry: carry({ slowRounds: 2 }) })]));
    expect(d).toMatchObject({
      kind: 'problem',
      monitorId: 'home',
      trigger: 'slow',
      detail: { kind: 'slow', p50Ms: 5_800, thresholdMs: 5_000 },
      // From the first slow round, two rounds back.
      startedAt: at(-360),
      status: 'problem',
    });
    expect(d.kind !== 'wait' && d.kind !== 'verify' && d.monitors[0]).toMatchObject({ slowRounds: 3 });
  });

  it('the second slow round counts but raises nothing', () => {
    const d = decideSite(site([monitor('home', slow, { carry: carry({ slowRounds: 1 }) })]));
    expect(d).toMatchObject({ kind: 'none', okRounds: 1, status: 'ok' });
    expect(d.kind === 'none' && d.monitors[0]?.slowRounds).toBe(2);
  });

  it('a fast round ends the streak', () => {
    const d = decideSite(site([monitor('home', all('pass'), { carry: carry({ slowRounds: 2 }) })]));
    expect(d.kind === 'none' && d.monitors[0]?.slowRounds).toBe(0);
  });
});

describe('decideSite — keyword, redirect, regional on the primary', () => {
  it('INC-0129 WeCare Asia: the brand keyword gone at all three → PROBLEM (Keyword) at once', () => {
    const d = decideSite(
      site([monitor('home', all('pass', 1, { keywordMissing: ['WeCare'], keywordForbidden: [] }))]),
    );
    expect(d).toMatchObject({
      kind: 'problem',
      trigger: 'keyword',
      detail: { kind: 'keyword', missing: ['WeCare'] },
      startedAt: at(1),
    });
  });

  it('a redirect off the allowlist → PROBLEM (Redirect)', () => {
    const d = decideSite(
      site([monitor('home', all('pass', 1, { finalUrl: 'https://casino.example.net/' }))]),
    );
    expect(d).toMatchObject({ kind: 'problem', trigger: 'redirect', detail: { host: 'casino.example.net' } });
  });

  it('INC-0131: SIN failing ≥ 5 min while BKK and TYO pass → PROBLEM (Regional), not DOWN', () => {
    const checks = [check('BKK', 'pass', 1), check('SIN', 'fail', 2), check('TYO', 'pass', 3)];
    const since = carry({ failingSince: { SIN: at(-358).toISOString() } });
    expect(decideSite(site([monitor('home', checks, { carry: since })]))).toMatchObject({
      kind: 'problem',
      trigger: 'regional',
      detail: { kind: 'regional', location: 'SIN', minutes: 6 },
      startedAt: at(-358),
    });
    // 4 min in: still just OK, the clock carries on.
    const young = carry({ failingSince: { SIN: at(-238).toISOString() } });
    const d = decideSite(site([monitor('home', checks, { carry: young })]));
    expect(d).toMatchObject({ kind: 'none', status: 'ok' });
    expect(d.kind === 'none' && d.monitors[0]?.failingSince).toEqual({ SIN: at(-238).toISOString() });
  });

  it('a location failing most monitors that minute is no data: no regional, two vote (spec §15.3)', () => {
    const checks = [check('BKK', 'pass', 1), check('SIN', 'fail', 2), check('TYO', 'pass', 3)];
    const since = carry({ failingSince: { SIN: at(-358).toISOString() } });
    const d = decideSite(
      site([monitor('home', checks, { carry: since })], {
        faulty: new Map([[R, new Set<ProbeLocation>(['SIN'])]]),
      }),
    );
    expect(d).toMatchObject({ kind: 'none', okRounds: 1, status: 'ok' });
    // Its clock is dropped: a minute it had no say in can't carry an old start into a later Regional.
    expect(d.kind === 'none' && d.monitors[0]?.failingSince).toEqual({});
  });
});

describe('decideSite — only the primary monitor can make a site DOWN (spec §6, Done-when 2)', () => {
  it('a key page returning 500 while the home page is fine → PROBLEM (Key page), never DOWN', () => {
    const d = decideSite(site([monitor('home', all('pass')), monitor('booking', failed())]));
    expect(d).toMatchObject({
      kind: 'problem',
      monitorId: 'booking',
      trigger: 'key_page',
      detail: { kind: 'hard_fail', failing: [{ location: 'BKK', statusCode: 500 }, {}, {}] },
      startedAt: at(1),
      status: 'problem',
    });
    expect(d.kind === 'problem' && d.monitors.map((m) => [m.monitorId, m.status])).toEqual([
      ['home', 'ok'],
      ['booking', 'problem'],
    ]);
  });

  it('a key page answering 404 → PROBLEM (Key page)', () => {
    const d = decideSite(
      site([monitor('home', all('pass')), monitor('contact', all('pass', 1, { statusCode: 404 }))]),
    );
    expect(d).toMatchObject({
      kind: 'problem',
      trigger: 'key_page',
      detail: { kind: 'status', statusCode: 404 },
    });
  });

  it('a slow or defaced key page is a key-page problem too', () => {
    const d = decideSite(
      site([
        monitor('home', all('pass')),
        monitor('booking', all('pass', 1, { keywordMissing: ['Book now'], keywordForbidden: [] })),
      ]),
    );
    expect(d).toMatchObject({ kind: 'problem', trigger: 'key_page', detail: { kind: 'keyword' } });
  });

  it('the primary going DOWN wins over a key-page problem, and doesn’t wait for a key page', () => {
    const d = decideSite(
      site([monitor('home', failed()), monitor('booking', [check('BKK', 'pass', 1)])], { now: at(40) }),
    );
    expect(d).toMatchObject({ kind: 'open', monitorId: 'home', startedAt: at(1), status: 'down' });
  });

  it('the primary’s own problem comes before a key page’s', () => {
    const d = decideSite(
      site([
        monitor('booking', all('pass', 1, { statusCode: 404 })),
        monitor('home', all('pass', 1, { keywordMissing: ['Fuji'], keywordForbidden: [] })),
      ]),
    );
    expect(d).toMatchObject({ kind: 'problem', monitorId: 'home', trigger: 'keyword' });
  });

  it('a blocked key page goes to the verifier; its browser failure is a key-page problem', () => {
    const blocked = all('blocked');
    expect(
      decideSite(
        site([monitor('home', all('pass')), monitor('booking', blocked)], { verifierAvailable: true }),
      ),
    ).toEqual({ kind: 'verify', roundAt: at(0), monitorIds: ['booking'] });
    const failedJob: Verification = { state: 'failed', jobId: 'j1', completedAt: at(20), detail: 'HTTP 502' };
    const d = decideSite(
      site([
        monitor('home', all('pass')),
        monitor('booking', blocked, { verifications: new Map([[R, failedJob]]) }),
      ]),
    );
    expect(d).toMatchObject({
      kind: 'problem',
      trigger: 'key_page',
      detail: { kind: 'browser', detail: 'HTTP 502' },
    });
  });

  it('a key page still showing a problem but with no data holds the recovery: nobody saw it recover', () => {
    const kept = carry({
      status: 'problem',
      trigger: 'key_page',
      cause: 'Home OK · /booking → HTTP 500 (BKK)',
    });
    const d = decideSite(
      site([monitor('home', all('pass')), monitor('booking', [], { carry: kept })], {
        open: incident('unacked', 'problem'),
      }),
    );
    expect(d).toMatchObject({ kind: 'none', status: null });
  });

  it('a key page with no data doesn’t hold back an OK round', () => {
    const d = decideSite(site([monitor('home', all('pass')), monitor('booking', [])]));
    expect(d).toMatchObject({ kind: 'none', okRounds: 1, status: 'ok' });
  });
});

describe('decideSite — status while an incident is open (D-022, S03 engine M1)', () => {
  it('M1: blocked and unverified while the incident is in Monitoring → PROBLEM AGAIN, site PROBLEM (D-022)', () => {
    const d = decideSite(
      site([monitor('home', all('blocked'))], { open: incident('monitoring'), okRounds: 1 }),
    );
    expect(d).toMatchObject({
      kind: 'relapse',
      severity: 'problem',
      trigger: 'blocked_unverified',
      status: 'problem',
      note: UNVERIFIED_NOTE,
      unverified: [{ monitorId: 'home', reason: 'no_poll' }],
    });
  });

  it('M1: the next OK round shows OK again', () => {
    const d = decideSite(
      site(
        [
          monitor('home', all('pass'), {
            carry: carry({ status: 'problem', trigger: 'blocked_unverified' }),
          }),
        ],
        {
          open: incident('monitoring'),
          okRounds: 0,
        },
      ),
    );
    expect(d).toMatchObject({ kind: 'none', okRounds: 1, status: 'ok' });
  });

  it('an open PROBLEM still failing is no relapse; a DOWN not yet recovered keeps the site DOWN', () => {
    const problem = all('pass', 1, { keywordMissing: ['Fuji'], keywordForbidden: [] });
    const p = decideSite(site([monitor('home', problem)], { open: incident('unacked', 'problem') }));
    expect(p).toEqual(expect.objectContaining({ kind: 'none', status: 'problem' }));
    // The home page is still down, a key page broken too: no RECOVERED, never below DOWN.
    const d = decideSite(
      site([monitor('home', failed()), monitor('booking', failed())], { open: incident('acknowledged') }),
    );
    expect(d).toMatchObject({ kind: 'none', status: 'down' });
  });

  it('recovers when every monitor is OK; the site shows OK only after the second OK round (PRD §5)', () => {
    const open = incident('unacked', 'problem');
    const r = decideSite(site([monitor('home', all('pass')), monitor('booking', all('pass'))], { open }));
    expect(r).toMatchObject({
      kind: 'recover',
      from: 'unacked',
      to: 'monitoring',
      okLocations: 3,
      status: 'problem',
    });
    const s = decideSite(
      site([monitor('home', all('pass'))], { open: incident('monitoring', 'problem'), okRounds: 1 }),
    );
    expect(s).toMatchObject({ kind: 'settle', to: 'needs_root_cause', status: 'ok' });
  });

  it('a verified blocked round carries the OK note; a DOWN confirmed on a PROBLEM escalates (D-021)', () => {
    const loaded = new Map([[R, { state: 'loaded', jobId: 'j1' } as Verification]]);
    const ok = decideSite(site([monitor('home', all('blocked'), { verifications: loaded })]));
    expect(ok).toMatchObject({ kind: 'none', status: 'ok', note: BLOCKED_NOTE });
    const up = decideSite(site([monitor('home', failed())], { open: incident('unacked', 'problem') }));
    expect(up).toMatchObject({ kind: 'escalate', monitorId: 'home', downStartedAt: at(1), status: 'down' });
  });

  it('too few locations for the home page: keep the status and the OK count; key pages keep their state', () => {
    const kept = carry({ status: 'problem', trigger: 'key_page', cause: 'Key page /booking: HTTP 404' });
    const d = decideSite(
      site([monitor('home', [check('SIN', 'pass', 1)]), monitor('booking', [], { carry: kept })], {
        okRounds: 1,
      }),
    );
    expect(d).toMatchObject({ kind: 'none', okRounds: 1, status: null });
    expect(d.kind === 'none' && d.monitors[1]).toMatchObject({
      status: 'problem',
      trigger: 'key_page',
      cause: 'Key page /booking: HTTP 404',
    });
  });

  it('a failure the recheck cleared is no OK round and raises nothing', () => {
    const checks = [
      ...all('fail'),
      recheck('BKK', 'pass', 31),
      recheck('SIN', 'pass', 32),
      recheck('TYO', 'pass', 33),
    ];
    expect(decideSite(site([monitor('home', checks)], { okRounds: 2 }))).toMatchObject({
      kind: 'none',
      okRounds: 0,
      status: null,
    });
  });

  it('waits while a key page’s verify job runs, and with nothing to judge', () => {
    const pending = new Map([[R, { state: 'pending' } as Verification]]);
    expect(
      decideSite(
        site([monitor('home', all('pass')), monitor('booking', all('blocked'), { verifications: pending })]),
      ),
    ).toEqual({ kind: 'wait' });
    expect(decideSite(site([monitor('home', [])]))).toEqual({ kind: 'wait' });
  });
});

describe('decideSite — engine review S04a', () => {
  // INC-0142 MuvMi with Bangkok's own network broken that minute (spec §15.3): BKK and TYO time out
  // and recheck, SIN answers 504 later in the minute. Tier 1 rounds.
  const T1 = { intervalSec: 60 };
  const inc0142 = [
    check('BKK', 'fail', 12),
    check('TYO', 'fail', 14),
    check('BKK', 'fail', 41, { attempt: 2 }),
    check('TYO', 'fail', 44, { attempt: 2 }),
    check('SIN', 'fail', 46),
    check('SIN', 'fail', 76, { attempt: 2 }),
  ];
  const faultyBkk = new Map([[R, new Set<ProbeLocation>(['BKK'])]]);

  it('H1: a faulty location never makes a round ready — it waits for SIN instead of being used up', () => {
    const early = decideSite(
      site([monitor('home', inc0142.slice(0, 4))], { ...T1, now: at(45), faulty: faultyBkk }),
    );
    expect(early).toEqual({ kind: 'wait' });
  });

  it('H1: once SIN confirms, DOWN opens on TYO + SIN', () => {
    const d = decideSite(site([monitor('home', inc0142)], { ...T1, now: at(77), faulty: faultyBkk }));
    expect(d).toMatchObject({ kind: 'open', startedAt: at(14) });
    expect(d.kind === 'open' && d.failing.map((c) => c.location)).toEqual(['TYO', 'SIN']);
  });

  it('M1: a failing-since clock of a location that stopped beating is dropped, not turned into Regional', () => {
    const stale = carry({ failingSince: { BKK: at(-7200).toISOString() } });
    const checks = [check('BKK', 'fail', 1), check('SIN', 'pass', 2), check('TYO', 'pass', 3)];
    // BKK just came back: its clock starts again at this failure.
    const back = decideSite(site([monitor('home', checks, { carry: stale })], { locations: ['SIN', 'TYO'] }));
    expect(back).toMatchObject({ kind: 'none', status: 'ok' });
    expect(back.kind === 'none' && back.monitors[0]?.failingSince).toEqual({ BKK: at(1).toISOString() });
  });

  it('L2: a blocked key page the verifier can’t decide is a key-page problem, and leaves the site note alone', () => {
    const d = decideSite(site([monitor('home', all('pass')), monitor('booking', all('blocked'))]));
    expect(d).toMatchObject({
      kind: 'problem',
      monitorId: 'booking',
      trigger: 'key_page',
      detail: { kind: 'blocked' },
    });
    expect(d).not.toHaveProperty('note');
  });
});

describe('decideSite — engine review S04a round 2', () => {
  it('a DOWN two locations confirmed isn’t held back while a DOWN incident is in Monitoring (DOWN AGAIN)', () => {
    const two = [
      check('SIN', 'fail', 1),
      check('TYO', 'fail', 2),
      check('SIN', 'fail', 31, { attempt: 2 }),
      check('TYO', 'fail', 32, { attempt: 2 }),
    ];
    // BKK beats but hasn't reported yet, 35 s into the round.
    const d = decideSite(
      site([monitor('home', two)], { intervalSec: 60, now: at(35), open: incident('monitoring') }),
    );
    expect(d).toMatchObject({ kind: 'relapse', severity: 'down', status: 'down' });
  });
});
