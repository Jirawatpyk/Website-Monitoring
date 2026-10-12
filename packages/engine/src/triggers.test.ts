import { describe, expect, it } from 'vitest';
import type { CheckOutcome, ProbeLocation } from '@dxt/shared';
import {
  faultyByMinute,
  slowLocationsByMinute,
  hostOf,
  isAllowedHost,
  keywordIssue,
  nextFailingSince,
  nextSlowRounds,
  redirectIssue,
  regionalIssue,
  roundP50,
  statusIssue,
  type CheckFacts,
} from './triggers';

// PROBLEM triggers (PRD §5, StatusModel, D-022). Times: Fri 25 Sep 09:52 Bangkok = 02:52Z (INC-0141).
const T = Date.parse('2026-09-25T02:52:00Z');
const at = (sec: number) => new Date(T + sec * 1000);
const fact = (location: ProbeLocation, over: Partial<CheckFacts> = {}): CheckFacts => ({
  location,
  outcome: 'pass',
  checkedAt: at(1),
  statusCode: 200,
  ...over,
});

describe('slow: p50 over the threshold 3 rounds in a row', () => {
  it('INC-0141 Fuji Links: p50 of BKK 5.6 s, SIN 5.8 s, TYO 6.4 s is 5.8 s', () => {
    expect(
      roundP50([
        fact('BKK', { responseMs: 5_600 }),
        fact('SIN', { responseMs: 5_800 }),
        fact('TYO', { responseMs: 6_400 }),
      ]),
    ).toBe(5_800);
  });

  it('takes the mean of two, and only passing checks with a time', () => {
    expect(roundP50([fact('SIN', { responseMs: 4_000 }), fact('TYO', { responseMs: 6_000 })])).toBe(5_000);
    expect(
      roundP50([
        fact('SIN', { responseMs: 4_000 }),
        fact('TYO', { outcome: 'fail', responseMs: 30_000 }),
        fact('BKK', { responseMs: null }),
      ]),
    ).toBeNull();
  });

  it.each([
    [0, 5_800, 1],
    [2, 5_800, 3],
    [2, 4_900, 0],
    [2, null, 2],
    [100, 9_000, 100],
  ])('streak %i, p50 %s ms over 5 s → %i', (previous, p50, next) => {
    expect(nextSlowRounds(previous, p50, 5_000)).toBe(next);
  });
});

describe('keyword: missing or forbidden text at a majority (INC-0129 WeCare Asia)', () => {
  it('a broken deploy lost the brand keyword everywhere → PROBLEM', () => {
    expect(
      keywordIssue([
        fact('BKK', { keywordMissing: ['WeCare'], keywordForbidden: [] }),
        fact('SIN', { keywordMissing: ['WeCare'], keywordForbidden: ['Index of /'] }),
        fact('TYO', { keywordMissing: [], keywordForbidden: [] }),
      ]),
    ).toEqual({ kind: 'keyword', missing: ['WeCare'], forbidden: ['Index of /'], locations: ['BKK', 'SIN'] });
  });

  it('one location of three, or one that checked, is not a majority', () => {
    expect(
      keywordIssue([
        fact('BKK', { keywordMissing: ['WeCare'] }),
        fact('SIN', { keywordMissing: [] }),
        fact('TYO', { keywordMissing: [] }),
      ]),
    ).toBeNull();
    // An agent not redeployed sends nothing: SIN alone isn't enough.
    expect(keywordIssue([fact('SIN', { keywordMissing: ['WeCare'] }), fact('BKK')])).toBeNull();
  });
});

describe('redirect: final host outside the site allowlist (hijack signal)', () => {
  it.each([
    ['example.com', 'https://www.example.com/', [], true],
    ['www.example.com', 'https://example.com/', [], true],
    ['shop.example.com', 'https://example.com/', [], true],
    ['example.com.evil.io', 'https://example.com/', [], false],
    ['evil.io', 'https://example.com/', [], false],
    ['pay.gateway.co.th', 'https://example.com/', ['gateway.co.th'], true],
    ['GATEWAY.co.th', 'https://example.com/', ['https://www.gateway.co.th/'], true],
  ] as const)('%s for %s (allowlist %j) → %s', (host, url, allowlist, allowed) => {
    expect(isAllowedHost(host, url, allowlist)).toBe(allowed);
  });

  it('reads the host from an absolute URL', () => {
    expect(hostOf('https://user@Shop.Example.com:8443/path?q#h')).toBe('shop.example.com');
    expect(hostOf('http://example.com')).toBe('example.com');
  });

  it('fires when most locations that answered ended elsewhere', () => {
    const off = (l: ProbeLocation) => fact(l, { finalUrl: 'https://casino.example.net/' });
    expect(
      redirectIssue(
        [off('BKK'), off('SIN'), fact('TYO', { finalUrl: 'https://a.example.com/' })],
        'https://a.example.com/',
        [],
      ),
    ).toEqual({ kind: 'redirect', host: 'casino.example.net', locations: ['BKK', 'SIN'] });
    expect(
      redirectIssue(
        [off('BKK'), fact('SIN', { finalUrl: 'https://a.example.com/' })],
        'https://a.example.com/',
        [],
      ),
    ).toBeNull();
    expect(redirectIssue([off('BKK'), fact('SIN')], 'https://a.example.com/', [])).toBeNull();
  });
});

describe('key page 4xx', () => {
  it('a 404 at most locations → PROBLEM; a WAF block is not a 4xx here', () => {
    expect(
      statusIssue([
        fact('BKK', { statusCode: 404 }),
        fact('SIN', { statusCode: 404 }),
        fact('TYO', { outcome: 'blocked', statusCode: 403 }),
      ]),
    ).toEqual({ kind: 'status', statusCode: 404, locations: ['BKK', 'SIN'] });
    expect(statusIssue([fact('BKK', { statusCode: 404 }), fact('SIN')])).toBeNull();
    expect(statusIssue([fact('BKK', { statusCode: 404 })])).toBeNull();
  });
});

describe('regional: one location failing ≥ 5 min while the others pass (INC-0131 BA – Taiwan, SIN)', () => {
  const round = (sec: number, sin: CheckOutcome) => [
    fact('BKK', { checkedAt: at(sec) }),
    fact('SIN', { outcome: sin, checkedAt: at(sec + 1) }),
    fact('TYO', { checkedAt: at(sec + 2) }),
  ];

  it('a failure starts the clock, a pass or a block stops it, no data keeps it', () => {
    const one = nextFailingSince({}, round(0, 'fail'));
    expect(one).toEqual({ SIN: at(1).toISOString() });
    expect(nextFailingSince(one, round(60, 'fail'))).toEqual(one);
    expect(nextFailingSince(one, [fact('BKK', { checkedAt: at(60) })])).toEqual(one);
    expect(nextFailingSince(one, round(60, 'pass'))).toEqual({});
    expect(nextFailingSince(one, round(60, 'blocked'))).toEqual({});
  });

  it('SIN failing since 21:12 → PROBLEM at 21:17, not at 21:16', () => {
    const since = { SIN: at(1).toISOString() };
    expect(regionalIssue(round(240, 'fail'), since)).toBeNull();
    expect(regionalIssue(round(300, 'fail'), since)).toEqual({
      kind: 'regional',
      location: 'SIN',
      minutes: 5,
      failure: { statusCode: 200, error: null },
      okLocations: ['BKK', 'TYO'],
      since: at(1).toISOString(),
    });
    expect(regionalIssue(round(420, 'fail'), since)).toMatchObject({
      kind: 'regional',
      location: 'SIN',
      minutes: 7,
    });
  });

  it('two failing, or no pass majority, is not regional', () => {
    const since = { SIN: at(1).toISOString(), TYO: at(2).toISOString() };
    expect(
      regionalIssue(
        [fact('BKK', { checkedAt: at(400) }), fact('SIN', { outcome: 'fail', checkedAt: at(401) })],
        since,
      ),
    ).toBeNull();
    expect(regionalIssue(round(400, 'pass'), since)).toBeNull();
  });
});

describe('faulty location (spec §15.3): one location failing more than half the monitors in a minute', () => {
  const rows = (failingAtSin: number, total: number, sec = 1) =>
    Array.from({ length: total }, (_, i) =>
      (['BKK', 'SIN', 'TYO'] as const).map((location) => ({
        siteId: `s${i}`,
        location,
        outcome: (location === 'SIN' && i < failingAtSin ? 'fail' : 'pass') as CheckOutcome,
        checkedAt: at(sec + i),
      })),
    ).flat();

  it('SIN fails 3 of 4 sites in a minute → no data for that minute', () => {
    expect(faultyByMinute(rows(3, 4))).toEqual(new Map([[T, new Set(['SIN'])]]));
  });

  it('below 3 sites from a location the rule doesn’t apply (it would hide a regional problem)', () => {
    expect(faultyByMinute(rows(2, 2))).toEqual(new Map());
  });

  it('half or fewer is not faulty; minutes are judged apart', () => {
    expect(faultyByMinute(rows(2, 4))).toEqual(new Map());
    const two = [...rows(3, 4), ...rows(0, 4, 61)];
    expect([...faultyByMinute(two).keys()]).toEqual([T]);
  });
});

describe('slow location (D-039): one location slow on most sites in a minute times itself', () => {
  // Production, Mon 12 Oct 2026 16:15 Bangkok: BKK over 3 s on 10 of 10 sites, SIN's median 0.6 s.
  const rows = (slowAtBkk: number, total: number, sinMs = 600) =>
    Array.from({ length: total }, (_, i) =>
      (['BKK', 'SIN'] as const).map((location) => ({
        siteId: `s${i}`,
        location,
        outcome: 'pass' as CheckOutcome,
        checkedAt: at(1),
        responseMs: location === 'BKK' ? (i < slowAtBkk ? 3993 : 1500) : sinMs,
        slowThresholdMs: 3000,
      })),
    ).flat();

  it.each([
    ['BKK slow on 10 of 10, SIN fast → BKK is no evidence', rows(10, 10), [T]],
    ['BKK slow on 3 of 5 (more than half) → BKK', rows(3, 5), [T]],
    ['BKK slow on 2 of 5 (16:17) → judged as usual', rows(2, 5), []],
    ['everyone slow everywhere → the sites may really be slow', rows(5, 5, 4000), []],
    ['below 3 sites the rule doesn’t apply', rows(2, 2), []],
  ])('%s', (_, checks, minutes) => {
    const out = slowLocationsByMinute(checks);
    expect([...out.keys()]).toEqual(minutes);
    for (const m of minutes) expect(out.get(m)).toEqual(new Set(['BKK']));
  });

  const timed = (siteId: string, location: ProbeLocation, responseMs: number) => ({
    siteId,
    location,
    outcome: 'pass' as CheckOutcome,
    checkedAt: at(1),
    responseMs,
    slowThresholdMs: 3000,
  });

  it('only the sites both timed are compared: slow only where SIN can’t reach (behind a WAF) accuses nobody', () => {
    const waf = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((id) => timed(id, 'BKK', 4000));
    const open = ['o1', 'o2', 'o3', 'o4', 'o5'].flatMap((id) => [
      timed(id, 'BKK', 900),
      timed(id, 'SIN', 600),
    ]);
    expect(slowLocationsByMinute([...waf, ...open]).size).toBe(0);
  });

  it('two locations slow is left alone — the sole outlier only, as spec §15.3', () => {
    const checks = ['a', 'b', 'c', 'd'].flatMap((id) => [
      timed(id, 'BKK', 4000),
      timed(id, 'TYO', 4000),
      timed(id, 'SIN', 600),
    ]);
    expect(slowLocationsByMinute(checks).size).toBe(0);
  });

  it('exactly half is not over half (a tie never flags)', () => {
    expect(slowLocationsByMinute(rows(5, 10)).size).toBe(0);
  });

  it('each site is held to its own limit; failed checks don’t count', () => {
    const own = rows(10, 10).map((c) => (c.location === 'BKK' ? { ...c, slowThresholdMs: 5000 } : c));
    expect(slowLocationsByMinute(own).size).toBe(0);
    const failed = rows(10, 10).map((c) =>
      c.location === 'BKK' ? { ...c, outcome: 'fail' as CheckOutcome } : c,
    );
    expect(slowLocationsByMinute(failed).size).toBe(0);
  });
});
