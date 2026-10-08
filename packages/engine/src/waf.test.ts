import { describe, expect, it } from 'vitest';
import type { CheckOutcome, ProbeLocation } from '@dxt/shared';
import { UNVERIFIED_NOTE, type StoredCheck, type Verification } from './monitor';
import { BLOCKED_NOTE, evaluateRound } from './round';
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
  ...over,
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

  it('a key page behind the WAF failing at BKK twice is a key-page PROBLEM, never DOWN', () => {
    const okHome = [check('BKK', 'pass', 1), ...akamaiAbroad()];
    const broken = [check('BKK', 'fail', 1), ...akamaiAbroad(), recheck('BKK', 'fail', 31)];
    expect(decideSite(site([home(okHome), keyPage(broken)]))).toMatchObject({
      kind: 'problem',
      monitorId: 'flightdeals',
      trigger: 'key_page',
    });
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
