import { describe, expect, it } from 'vitest';
import type { CheckOutcome, ProbeLocation } from '@dxt/shared';
import { UNVERIFIED_NOTE, type StoredCheck, type Verification } from './monitor';
import { BLOCKED_NOTE, evaluateRound } from './round';
import { minuteOf } from './triggers';
import { decideSite, NEW_MONITOR, type SiteMonitor, type SiteSnapshot } from './site';

// D-027 — sites behind a WAF. Bangkok Airways – Taiwan, 8 Oct 2026: Akamai answers SIN and TYO with
// 403 "Access Denied" (and the browser verifier too); the Bangkok probe gets 200. Tier 2 rounds of
// 180 s like the site tests: R = a 3-minute tick, judged after the round's deadline.
const R = Date.parse('2026-10-08T06:15:00Z');
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
    statusCode: outcome === 'fail' ? 503 : outcome === 'blocked' ? 403 : 200,
    error: null,
    responseMs: 600,
    ...over,
  };
}
/** Akamai's block page at SIN and TYO: blocked with the header-level signature. */
const akamaiAbroad = (sec = 2) => [
  check('SIN', 'blocked', sec, { waf: 'akamai' }),
  check('TYO', 'blocked', sec + 1, { waf: 'akamai' }),
];
const recheck = (
  location: ProbeLocation,
  outcome: CheckOutcome,
  sec: number,
  over: Partial<StoredCheck> = {},
) => check(location, outcome, sec, { attempt: 2, ...over });

const home = (checks: StoredCheck[], over: Partial<SiteMonitor> = {}): SiteMonitor => ({
  id: 'home',
  isPrimary: true,
  url: 'https://www.bangkokair.example/twn',
  slowThresholdMs: 5_000,
  allowedRedirectDomains: [],
  checks,
  carry: NEW_MONITOR,
  ...over,
});
const keyPage = (checks: StoredCheck[]): SiteMonitor => ({
  ...home(checks),
  id: 'flightdeals',
  isPrimary: false,
  url: 'https://www.bangkokair.example/twn/flightdeals',
});

const site = (monitors: SiteMonitor[], over: Partial<SiteSnapshot> = {}): SiteSnapshot => ({
  now: at(260),
  intervalSec: 180,
  locations: LOCATIONS,
  lastRoundAt: null,
  okRounds: 0,
  open: null,
  monitors,
  behindWaf: true,
  verifierAvailable: true,
  // The control-check cases below describe a check that has been failing long enough (D-028, D-038).
  bkkControlDown: true,
  ...over,
});

describe('D-038 — one failing BKK control minute is no data, not PROBLEM', () => {
  it('a round with nobody left to vote keeps the current status while the control check has only just failed', () => {
    const rows = [
      check('BKK', 'fail', 1, { controlOk: false }),
      ...akamaiAbroad(),
      recheck('BKK', 'fail', 31, { controlOk: false }),
    ];
    const d = decideSite(site([home(rows)], { bkkControlDown: false, okRounds: 4 }));
    expect(d).toMatchObject({ kind: 'none', status: null, okRounds: 4, unverified: [] });
  });

  it('a pass during that minute is no data either (an OK site stays OK, a recovering incident keeps counting)', () => {
    const rows = [check('BKK', 'pass', 1, { controlOk: false }), ...akamaiAbroad()];
    expect(decideSite(site([home(rows)], { bkkControlDown: false, okRounds: 1 }))).toMatchObject({
      kind: 'none',
      status: null,
      okRounds: 1,
    });
  });

  it('once it has failed long enough the round is PROBLEM (unverified) as before (D-028)', () => {
    const rows = [check('BKK', 'pass', 1, { controlOk: false }), ...akamaiAbroad()];
    expect(decideSite(site([home(rows)], { bkkControlDown: true }))).toMatchObject({
      kind: 'problem',
      detail: { kind: 'blocked', reason: 'control_failed' },
    });
  });
});

describe('D-027 — sites behind a WAF (decideSite)', () => {
  it('(e) BKK passes, Akamai blocks SIN and TYO → OK, with who decided in the note', () => {
    const rows = [check('BKK', 'pass', 1, { keywordMissing: [], keywordForbidden: [] }), ...akamaiAbroad()];
    expect(decideSite(site([home(rows)]))).toMatchObject({
      kind: 'none',
      status: 'ok',
      okRounds: 1,
      note: 'Verified from BKK; SIN, TYO blocked by bot protection',
    });
  });

  it('(a) the origin is down: BKK 503 and its recheck 503, SIN / TYO still blocked at the edge → DOWN', () => {
    const rows = [check('BKK', 'fail', 1), ...akamaiAbroad(), recheck('BKK', 'fail', 31)];
    const d = decideSite(site([home(rows)]));
    expect(d).toMatchObject({ kind: 'open', monitorId: 'home', startedAt: at(1), confirmedAt: at(31) });
    if (d.kind !== 'open') throw new Error('expected open');
    expect(d.failing.map((c) => c.location)).toEqual(['BKK']);
    // "Confirmed by" names who confirmed it and who the WAF blocked.
    expect(d.wafBlocked).toEqual(['SIN', 'TYO']);
  });

  it('(L1) the DOWN starts at the first failure the control check vouched for, not an earlier one it didn’t', () => {
    // The round before (already judged): BKK failed while the VPS's control check was down — no data.
    const judged = { lastRoundAt: at(-180) };
    const before = [
      check('BKK', 'fail', -179, { controlOk: false }),
      check('SIN', 'blocked', -178, { waf: 'akamai' }),
      check('TYO', 'blocked', -177, { waf: 'akamai' }),
    ];
    const rows = [...before, check('BKK', 'fail', 1), ...akamaiAbroad(), recheck('BKK', 'fail', 31)];
    expect(decideSite(site([home(rows)], judged))).toMatchObject({ kind: 'open', startedAt: at(1) });
    // The same earlier failure with the control fine is the start, as spec §6 says.
    const vouched = [{ ...before[0]!, controlOk: true }, ...rows.slice(1)];
    expect(decideSite(site([home(vouched)], judged))).toMatchObject({ kind: 'open', startedAt: at(-179) });
  });

  it('(L1) an earlier untrusted failure stays no data even when the confirming round carries no Akamai signature', () => {
    // 06:12 BKK failed with the Akamai control down while SIN / TYO were blocked by Akamai;
    // 06:15 the origin is down and Akamai answers everyone with a 503 (no block).
    const before = [
      check('BKK', 'fail', -179, { akamaiOk: false }),
      check('SIN', 'blocked', -178, { waf: 'akamai' }),
      check('TYO', 'blocked', -177, { waf: 'akamai' }),
    ];
    const rows = [
      ...before,
      check('BKK', 'fail', 1),
      check('SIN', 'fail', 2),
      check('TYO', 'fail', 3),
      recheck('BKK', 'fail', 31),
      recheck('SIN', 'fail', 32),
      recheck('TYO', 'fail', 33),
    ];
    expect(decideSite(site([home(rows)], { lastRoundAt: at(-180) }))).toMatchObject({
      kind: 'open',
      startedAt: at(1),
    });
  });

  it('(L2) behind Akamai, BKK failing while the Akamai control failed too is the route, not the origin → PROBLEM (unverified)', () => {
    const rows = [
      check('BKK', 'fail', 1, { akamaiOk: false }),
      ...akamaiAbroad(),
      recheck('BKK', 'fail', 31, { akamaiOk: false }),
    ];
    expect(decideSite(site([home(rows)]))).toMatchObject({
      kind: 'problem',
      detail: { kind: 'blocked', reason: 'control_failed' },
    });
  });

  it('(L2) the Akamai control passing while the site fails is the origin → DOWN', () => {
    const rows = [
      check('BKK', 'fail', 1, { akamaiOk: true }),
      ...akamaiAbroad(),
      recheck('BKK', 'fail', 31, { akamaiOk: true }),
    ];
    expect(decideSite(site([home(rows)]))).toMatchObject({ kind: 'open', startedAt: at(1) });
  });

  it('(L2) the Akamai control only guards sites behind Akamai: behind Cloudflare a failure still counts', () => {
    const rows = [
      check('BKK', 'fail', 1, { akamaiOk: false }),
      check('SIN', 'blocked', 2, { waf: 'cloudflare' }),
      check('TYO', 'blocked', 3, { waf: 'cloudflare' }),
      recheck('BKK', 'fail', 31, { akamaiOk: false }),
    ];
    expect(decideSite(site([home(rows)]))).toMatchObject({ kind: 'open' });
  });

  it('(L2) a pass with the Akamai control down still counts: the site answered', () => {
    const rows = [check('BKK', 'pass', 1, { akamaiOk: false }), ...akamaiAbroad()];
    expect(decideSite(site([home(rows)]))).toMatchObject({ kind: 'none', status: 'ok' });
  });

  it('BKK fails but its recheck passes → a blip, not DOWN', () => {
    const rows = [check('BKK', 'fail', 1), ...akamaiAbroad(), recheck('BKK', 'pass', 31)];
    const d = decideSite(site([home(rows)]));
    expect(d.kind).not.toBe('open');
  });

  it('(b) the VPS’s control check failed: BKK can’t decide → PROBLEM (unverified), never DOWN', () => {
    const rows = [
      check('BKK', 'fail', 1, { controlOk: false }),
      ...akamaiAbroad(),
      recheck('BKK', 'fail', 31, { controlOk: false }),
    ];
    expect(decideSite(site([home(rows)]))).toMatchObject({
      kind: 'problem',
      trigger: 'blocked_unverified',
      detail: { kind: 'blocked', reason: 'control_failed', locations: ['SIN', 'TYO'], statusCode: 403 },
      note: UNVERIFIED_NOTE,
      unverified: [{ monitorId: 'home', reason: 'control_failed' }],
    });
  });

  it('(b) a pass is not trusted either while the control check is down', () => {
    const rows = [check('BKK', 'pass', 1, { controlOk: false }), ...akamaiAbroad()];
    expect(decideSite(site([home(rows)]))).toMatchObject({
      kind: 'problem',
      detail: { kind: 'blocked', reason: 'control_failed' },
    });
  });

  it('one control URL down (controlOk true) or an agent that doesn’t report it (null) still counts', () => {
    for (const controlOk of [true, null]) {
      const rows = [check('BKK', 'pass', 1, { controlOk }), ...akamaiAbroad()];
      expect(decideSite(site([home(rows)]))).toMatchObject({ kind: 'none', status: 'ok' });
    }
  });

  it('(c) every location WAF-blocked, Bangkok too → the verifier decides; blocked in the browser → PROBLEM (unverified)', () => {
    const rows = [check('BKK', 'blocked', 1, { waf: 'akamai' }), ...akamaiAbroad()];
    expect(decideSite(site([home(rows)]))).toEqual({ kind: 'verify', roundAt: at(0), monitorIds: ['home'] });
    const blocked: Verification = { state: 'blocked', jobId: 'j1' };
    expect(decideSite(site([home(rows, { verifications: new Map([[R, blocked]]) })]))).toMatchObject({
      kind: 'problem',
      trigger: 'blocked_unverified',
      detail: { kind: 'blocked', reason: 'browser_blocked' },
    });
  });

  it('(c) every location blocked, the verifier loads the page → OK with the browser note (spec §6)', () => {
    const rows = [check('BKK', 'blocked', 1, { waf: 'akamai' }), ...akamaiAbroad()];
    const loaded: Verification = { state: 'loaded', jobId: 'j1' };
    expect(decideSite(site([home(rows, { verifications: new Map([[R, loaded]]) })]))).toMatchObject({
      kind: 'none',
      status: 'ok',
      note: BLOCKED_NOTE,
    });
  });

  it('(d) every location blocked, the browser gets through the WAF and sees a 503 / timeout → DOWN', () => {
    const rows = [check('BKK', 'blocked', 1, { waf: 'akamai' }), ...akamaiAbroad()];
    for (const detail of ['HTTP 503', 'Timeout']) {
      const failed: Verification = { state: 'failed', jobId: 'j1', completedAt: at(40), detail };
      expect(decideSite(site([home(rows, { verifications: new Map([[R, failed]]) })]))).toMatchObject({
        kind: 'open',
        startedAt: at(1),
        confirmedAt: at(40),
        verifyJobId: 'j1',
        browserDetail: detail,
      });
    }
  });

  it('(f) the same rows on a site not behind a WAF keep today’s rule: the verifier decides', () => {
    const rows = [check('BKK', 'pass', 1), ...akamaiAbroad()];
    expect(decideSite(site([home(rows)], { behindWaf: false }))).toEqual({
      kind: 'verify',
      roundAt: at(0),
      monitorIds: ['home'],
    });
    const down = [check('BKK', 'fail', 1), ...akamaiAbroad(), recheck('BKK', 'fail', 31)];
    expect(decideSite(site([home(down)], { behindWaf: false })).kind).toBe('verify');
  });

  it('only a WAF signature abstains: a body-only block (no `waf`) still goes to the verifier', () => {
    const rows = [check('BKK', 'pass', 1), check('SIN', 'blocked', 2), check('TYO', 'blocked', 3)];
    expect(decideSite(site([home(rows)])).kind).toBe('verify');
  });

  it('BKK alone, with SIN and TYO silent rather than blocked, is still too few locations', () => {
    expect(decideSite(site([home([check('BKK', 'pass', 1)])]))).toMatchObject({ kind: 'none', status: null });
  });

  it('a missing keyword seen from BKK alone is a keyword PROBLEM', () => {
    const rows = [
      check('BKK', 'pass', 1, { keywordMissing: ['搜尋航班'], keywordForbidden: [] }),
      ...akamaiAbroad(),
    ];
    expect(decideSite(site([home(rows)]))).toMatchObject({ kind: 'problem', trigger: 'keyword' });
  });

  it('slow and redirect seen from BKK alone count too (D-027: one deciding location is evidence enough)', () => {
    const slow = [check('BKK', 'pass', 1, { responseMs: 6_200 }), ...akamaiAbroad()];
    expect(decideSite(site([home(slow, { carry: { ...NEW_MONITOR, slowRounds: 2 } })]))).toMatchObject({
      kind: 'problem',
      trigger: 'slow',
      detail: { kind: 'slow', p50Ms: 6_200, locations: ['BKK'] },
    });
    const hijacked = [check('BKK', 'pass', 1, { finalUrl: 'https://evil.example/' }), ...akamaiAbroad()];
    expect(decideSite(site([home(hijacked)]))).toMatchObject({ kind: 'problem', trigger: 'redirect' });
  });

  it('D-039: BKK slow on most sites that minute is no evidence — the streak holds, no PROBLEM (INC-0010)', () => {
    const slow = [check('BKK', 'pass', 1, { responseMs: 6_200 }), ...akamaiAbroad()];
    const slowBkk = new Map([[minuteOf(at(1)), new Set<ProbeLocation>(['BKK'])]]);
    const d = decideSite(
      site([home(slow, { carry: { ...NEW_MONITOR, slowRounds: 2 } })], { slowLocations: slowBkk }),
    );
    expect(d.kind).not.toBe('problem');
    expect(d.kind !== 'wait' && d.kind !== 'verify' && d.monitors[0]).toMatchObject({ slowRounds: 2 });
  });

  it('a key page behind the WAF failing at BKK twice is a key-page PROBLEM, never DOWN', () => {
    const okHome = [check('BKK', 'pass', 1), ...akamaiAbroad()];
    const broken = [check('BKK', 'fail', 1), ...akamaiAbroad(), recheck('BKK', 'fail', 31)];
    expect(decideSite(site([home(okHome), keyPage(broken)]))).toMatchObject({
      kind: 'problem',
      monitorId: 'flightdeals',
      trigger: 'key_page',
    });
  });

  it('BKK failing while SIN passes and TYO is WAF-blocked → OK with a regional clock, then PROBLEM (Regional)', () => {
    const rows = [
      check('BKK', 'fail', 1),
      check('SIN', 'pass', 2),
      check('TYO', 'blocked', 3, { waf: 'cloudflare' }),
      recheck('BKK', 'fail', 31),
    ];
    const d = decideSite(site([home(rows)]));
    expect(d).toMatchObject({
      kind: 'none',
      status: 'ok',
      note: 'Verified from SIN; TYO blocked by bot protection',
    });
    expect(d.kind === 'none' && d.monitors[0]?.failingSince).toEqual({ BKK: at(1).toISOString() });
    const since = { ...NEW_MONITOR, failingSince: { BKK: at(-358).toISOString() } };
    expect(decideSite(site([home(rows, { carry: since })]))).toMatchObject({
      kind: 'problem',
      trigger: 'regional',
      detail: { kind: 'regional', location: 'BKK' },
    });
  });

  it('a location the WAF now blocks drops its old failure clock', () => {
    const rows = [
      check('BKK', 'pass', 1),
      check('SIN', 'pass', 2),
      check('TYO', 'blocked', 3, { waf: 'akamai' }),
    ];
    const since = { ...NEW_MONITOR, failingSince: { TYO: at(-3600).toISOString() } };
    const d = decideSite(site([home(rows, { carry: since })]));
    expect(d).toMatchObject({ kind: 'none', status: 'ok' });
    expect(d.kind === 'none' && d.monitors[0]?.failingSince).toEqual({});
  });

  it('a location excluded as no data isn’t named in the note', () => {
    const rows = [
      check('BKK', 'pass', 1),
      check('SIN', 'pass', 2),
      check('TYO', 'blocked', 3, { waf: 'akamai' }),
    ];
    const minute = minuteOf(at(3));
    const d = decideSite(
      site([home(rows)], { faulty: new Map([[minute, new Set<ProbeLocation>(['TYO'])]]) }),
    );
    expect(d).toMatchObject({ kind: 'none', status: 'ok' });
    expect(d.kind === 'none' && 'note' in d ? d.note : undefined).toBeUndefined();
  });

  // engine-reviewer (S05b): the Bangkok Airways TW rows with the VPS's own network down.
  const faultyBkk = (sec = 1) => new Map([[minuteOf(at(sec)), new Set<ProbeLocation>(['BKK'])]]);
  const netDown = () => [
    check('BKK', 'fail', 1, { controlOk: false }),
    ...akamaiAbroad(),
    recheck('BKK', 'fail', 31, { controlOk: false }),
  ];

  it('BKK excluded as faulty (its network down fails every site) with the control check down → untrusted, never a verify job', () => {
    expect(decideSite(site([home(netDown())], { faulty: faultyBkk() }))).toMatchObject({
      kind: 'problem',
      detail: { kind: 'blocked', reason: 'control_failed' },
    });
  });

  it('…and never DOWN, even with a failed browser verdict from that same VPS', () => {
    const failed: Verification = { state: 'failed', jobId: 'j1', completedAt: at(40), detail: 'No response' };
    const d = decideSite(
      site([home(netDown(), { verifications: new Map([[R, failed]]) })], { faulty: faultyBkk() }),
    );
    expect(d).toMatchObject({ kind: 'problem', detail: { kind: 'blocked', reason: 'control_failed' } });
  });

  it('control down and a body-only block left voting → still untrusted, never the verifier on that VPS', () => {
    const failed: Verification = { state: 'failed', jobId: 'j1', completedAt: at(40), detail: 'No response' };
    const rows = [
      check('BKK', 'fail', 1, { controlOk: false }),
      check('SIN', 'blocked', 2, { waf: 'akamai' }),
      check('TYO', 'blocked', 3, { statusCode: 429 }),
      recheck('BKK', 'fail', 31, { controlOk: false }),
    ];
    expect(decideSite(site([home(rows, { verifications: new Map([[R, failed]]) })]))).toMatchObject({
      kind: 'problem',
      detail: { kind: 'blocked', reason: 'control_failed' },
    });
  });

  it('BKK faulty with its control down and SIN / TYO silent: too few locations, the status stays (spec §6)', () => {
    const rows = [
      check('BKK', 'fail', 1, { controlOk: false }),
      recheck('BKK', 'fail', 31, { controlOk: false }),
    ];
    expect(decideSite(site([home(rows)], { faulty: faultyBkk() }))).toMatchObject({
      kind: 'none',
      status: null,
    });
  });

  it('BKK fails with the control check fine, but its recheck runs with it down → PROBLEM (unverified), not a blip', () => {
    const rows = [
      check('BKK', 'fail', 1),
      ...akamaiAbroad(),
      recheck('BKK', 'fail', 31, { controlOk: false }),
    ];
    expect(decideSite(site([home(rows)]))).toMatchObject({
      kind: 'problem',
      detail: { kind: 'blocked', reason: 'control_failed' },
      startedAt: at(1),
    });
  });

  it('a split round keeps the one passing voter’s evidence: keyword missing at BKK → PROBLEM (Keyword)', () => {
    const rows = [
      check('BKK', 'pass', 1, { keywordMissing: ['Brand'], keywordForbidden: [] }),
      check('SIN', 'fail', 2),
      check('TYO', 'blocked', 3, { waf: 'akamai' }),
      recheck('SIN', 'fail', 32),
    ];
    expect(decideSite(site([home(rows)]))).toMatchObject({ kind: 'problem', trigger: 'keyword' });
  });

  it('the flag alone relaxes nothing: 1 pass, 1 fail and a silent TYO keep an open DOWN open', () => {
    const rows = [check('BKK', 'pass', 1), check('SIN', 'fail', 2), recheck('SIN', 'fail', 32)];
    for (const behindWaf of [true, false]) {
      const d = decideSite(
        site([home(rows)], {
          behindWaf,
          open: { id: 'inc-1', state: 'unacked', severity: 'down', hasRootCause: false },
        }),
      );
      expect(d).toMatchObject({ kind: 'none', status: null });
    }
  });

  it('a key page behind the WAF doesn’t put the WAF note on a site whose home page all three see', () => {
    const okHome = [check('BKK', 'pass', 1), check('SIN', 'pass', 2), check('TYO', 'pass', 3)];
    const page = [check('BKK', 'pass', 1), ...akamaiAbroad()];
    const d = decideSite(site([home(okHome), keyPage(page)]));
    expect(d).toMatchObject({ kind: 'none', status: 'ok' });
    expect('note' in d ? d.note : undefined).toBeUndefined();
  });

  it('a WAF block never starts a regional clock', () => {
    const rows = [check('BKK', 'pass', 1), ...akamaiAbroad()];
    const d = decideSite(site([home(rows)]));
    if (d.kind !== 'none') throw new Error('expected none');
    expect(d.monitors[0]?.failingSince).toEqual({});
  });
});

describe('D-027 — evaluateRound on a WAF site', () => {
  const base = { now: at(60), windowSec: 240 };
  const r = (location: ProbeLocation, outcome: CheckOutcome, over: Partial<StoredCheck> = {}) =>
    check(location, outcome, 1, over);

  it.each([
    ['BKK pass, SIN / TYO WAF', [r('BKK', 'pass'), ...akamaiAbroad(1)], 'pass'],
    ['BKK fail, SIN / TYO WAF', [r('BKK', 'fail'), ...akamaiAbroad(1)], 'hard_fail'],
    ['BKK + SIN pass, TYO WAF', [r('BKK', 'pass'), r('SIN', 'pass'), akamaiAbroad(1)[1]!], 'pass'],
    ['BKK + SIN fail, TYO WAF', [r('BKK', 'fail'), r('SIN', 'fail'), akamaiAbroad(1)[1]!], 'hard_fail'],
    [
      'all three WAF-blocked',
      [r('BKK', 'blocked', { waf: 'akamai' }), ...akamaiAbroad(1)],
      'needs_verification',
    ],
    [
      'control down, SIN / TYO WAF',
      [r('BKK', 'pass', { controlOk: false }), ...akamaiAbroad(1)],
      'untrusted',
    ],
    [
      'control down but SIN and TYO pass',
      [r('BKK', 'fail', { controlOk: false }), r('SIN', 'pass'), r('TYO', 'pass')],
      'pass',
    ],
  ] as const)('%s → %s', (_name, results, kind) => {
    expect(evaluateRound({ ...base, results, wafSite: true }).kind).toBe(kind);
  });

  it('names who sat out', () => {
    expect(
      evaluateRound({ ...base, results: [r('BKK', 'pass'), ...akamaiAbroad(1)], wafSite: true }),
    ).toEqual({
      kind: 'pass',
      failing: [],
      abstained: ['SIN', 'TYO'],
    });
  });
});

// Retro S05b: engine-reviewer needed three rounds, each fix exposing a new edge case. These
// invariants run every combination instead of the cases someone thought of.
describe('D-027 invariants over every combination', () => {
  type Bkk = 'pass' | 'fail' | 'fail-control' | 'fail-akamai' | 'blocked-waf' | 'chain' | 'chain-control';
  type Abroad = 'pass' | 'fail' | 'waf' | 'body-block' | 'silent' | 'chain';
  const BKK: Bkk[] = ['pass', 'fail', 'fail-control', 'fail-akamai', 'blocked-waf', 'chain', 'chain-control'];
  const ABROAD: Abroad[] = ['pass', 'fail', 'waf', 'body-block', 'silent', 'chain'];
  const VERDICTS: (Verification | undefined)[] = [
    undefined,
    { state: 'loaded', jobId: 'j1' },
    { state: 'blocked', jobId: 'j1' },
    { state: 'failed', jobId: 'j1', completedAt: at(40), detail: 'No response' },
  ];
  const bkkRows = (b: Bkk): StoredCheck[] => {
    const over: Partial<StoredCheck> =
      b === 'fail-control'
        ? { controlOk: false }
        : b === 'fail-akamai'
          ? { akamaiOk: false }
          : { controlOk: true };
    if (b === 'pass') return [check('BKK', 'pass', 1, over)];
    if (b === 'blocked-waf') return [check('BKK', 'blocked', 1, { waf: 'akamai' })];
    if (b === 'chain')
      return [check('BKK', 'fail', 1, { statusCode: null, error: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })];
    if (b === 'chain-control')
      return [
        check('BKK', 'fail', 1, {
          statusCode: null,
          error: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
          controlOk: false,
        }),
      ];
    return [check('BKK', 'fail', 1, over), recheck('BKK', 'fail', 31, over)];
  };
  const abroadRows = (loc: ProbeLocation, a: Abroad, sec: number): StoredCheck[] => {
    if (a === 'silent') return [];
    if (a === 'pass') return [check(loc, 'pass', sec)];
    if (a === 'waf') return [check(loc, 'blocked', sec, { waf: 'akamai' })];
    if (a === 'body-block') return [check(loc, 'blocked', sec)];
    // D-029: a certificate-chain error is never a hard-fail vote.
    if (a === 'chain')
      return [check(loc, 'fail', sec, { statusCode: null, error: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })];
    return [check(loc, 'fail', sec), recheck(loc, 'fail', sec + 30)];
  };
  const cases = BKK.flatMap((b) =>
    ABROAD.flatMap((sin) => ABROAD.flatMap((tyo) => VERDICTS.map((v) => ({ b, sin, tyo, v })))),
  );
  const rowsOf = ({ b, sin, tyo }: (typeof cases)[number]) => [
    ...bkkRows(b),
    ...abroadRows('SIN', sin, 2),
    ...abroadRows('TYO', tyo, 3),
  ];
  const decide = (c: (typeof cases)[number], behindWaf: boolean) =>
    decideSite(
      site([home(rowsOf(c), c.v ? { verifications: new Map([[R, c.v]]) } : {})], {
        behindWaf,
        now: at(260),
      }),
    );

  it('rule 2: with the VPS untrusted, a DOWN never rests on BKK or on its browser', () => {
    for (const c of cases) {
      if (c.b !== 'fail-control' && c.b !== 'fail-akamai') continue;
      // The Akamai control only guards a site the lookback shows behind Akamai.
      if (c.b === 'fail-akamai' && c.sin !== 'waf' && c.tyo !== 'waf') continue;
      const d = decide(c, true);
      if (d.kind !== 'open') continue;
      const why = JSON.stringify(c);
      expect(d.verifyJobId, why).toBeUndefined();
      expect(
        d.failing.map((f) => f.location),
        why,
      ).not.toContain('BKK');
      expect(d.failing.length, why).toBeGreaterThan(0);
    }
  });

  it('rule 5: a flagged site with no WAF signature in the round decides exactly as an unflagged one', () => {
    for (const c of cases) {
      if (c.b === 'blocked-waf' || c.sin === 'waf' || c.tyo === 'waf') continue;
      if (c.b === 'fail-control' || c.b === 'fail-akamai' || c.b === 'chain-control') continue;
      expect(decide(c, true), JSON.stringify(c)).toEqual(decide(c, false));
    }
  });

  it('D-029: with the VPS’s control down, a chain round never ends in a DOWN from that VPS’s browser', () => {
    for (const c of cases) {
      if (c.b !== 'chain-control') continue;
      for (const behindWaf of [true, false]) {
        const d = decide(c, behindWaf);
        if (d.kind === 'open' && d.verifyJobId) {
          // only a blocked (not chain) round may still reach the browser on a site not behind a WAF
          expect(
            [c.sin, c.tyo].some((a) => a === 'body-block' || a === 'waf'),
            JSON.stringify(c),
          ).toBe(true);
        }
      }
    }
  });

  it('D-029: a DOWN never counts a chain error among the locations that confirmed it', () => {
    for (const c of cases) {
      for (const behindWaf of [true, false]) {
        const d = decide(c, behindWaf);
        if (d.kind !== 'open' || d.verifyJobId) continue;
        expect(
          d.failing.filter((f) => f.error === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'),
          JSON.stringify(c),
        ).toEqual([]);
      }
    }
  });

  it('every combination decides without throwing and never starts a DOWN at an invalid time', () => {
    for (const c of cases) {
      const d = decide(c, true);
      if (d.kind === 'open') expect(Number.isFinite(d.startedAt.getTime()), JSON.stringify(c)).toBe(true);
    }
  });
});
