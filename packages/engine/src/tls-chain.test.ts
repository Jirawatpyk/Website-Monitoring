import { describe, expect, it } from 'vitest';
import type { CheckOutcome, ProbeLocation } from '@dxt/shared';
import { isHardFail, isTlsChainFail } from './hard-fail';
import type { StoredCheck } from './monitor';
import { faultyLocations } from './round';
import { decideSite, NEW_MONITOR, type SiteMonitor, type SiteSnapshot } from './site';

// D-029 — a misconfigured certificate chain is a PROBLEM, not a DOWN. Cando Asia, 8 Oct 2026: a
// Sectigo leaf served with a Let's Encrypt E6 intermediate → every probe gets
// UNABLE_TO_VERIFY_LEAF_SIGNATURE; browsers open the site. Tier 2 rounds of 180 s.
const R = Date.parse('2026-10-08T06:15:00Z');
const at = (sec: number) => new Date(R + sec * 1000);
const CHAIN = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';

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
    statusCode: outcome === 'pass' ? 200 : null,
    error: outcome === 'fail' ? 'Timeout' : null,
    responseMs: 600,
    ...over,
  };
}
const chain = (location: ProbeLocation, sec: number, over: Partial<StoredCheck> = {}) =>
  check(location, 'fail', sec, { error: CHAIN, ...over });
const recheck = (c: StoredCheck, sec: number) => ({ ...c, checkedAt: at(sec), attempt: 2 as const });

const home = (checks: StoredCheck[]): SiteMonitor => ({
  id: 'home',
  isPrimary: true,
  url: 'https://www.cando.example/',
  slowThresholdMs: 5_000,
  allowedRedirectDomains: [],
  checks,
  carry: NEW_MONITOR,
});
const keyPage = (checks: StoredCheck[]): SiteMonitor => ({
  ...home(checks),
  id: 'contact',
  isPrimary: false,
  url: 'https://www.cando.example/contact',
});
const site = (monitors: SiteMonitor[], over: Partial<SiteSnapshot> = {}): SiteSnapshot => ({
  now: at(260),
  intervalSec: 180,
  locations: ['BKK', 'SIN', 'TYO'],
  lastRoundAt: null,
  okRounds: 0,
  open: null,
  monitors,
  verifierAvailable: true,
  ...over,
});

describe('D-029 — isHardFail is the one rule', () => {
  it.each([
    [{ outcome: 'fail', error: 'Timeout' }, true, false],
    [{ outcome: 'fail', error: 'CERT_HAS_EXPIRED' }, true, false],
    [{ outcome: 'fail', error: 'ERR_TLS_CERT_ALTNAME_INVALID' }, true, false],
    [{ outcome: 'fail', error: CHAIN }, false, true],
    [{ outcome: 'fail', error: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }, false, true],
    [{ outcome: 'pass', error: null }, false, false],
    [{ outcome: 'blocked', error: null }, false, false],
  ] as const)('%o → hard fail %s, chain %s', (c, hard, isChain) => {
    expect(isHardFail(c)).toBe(hard);
    expect(isTlsChainFail(c)).toBe(isChain);
  });
});

describe('D-029 — TLS chain errors are a PROBLEM, not DOWN (decideSite)', () => {
  it('(1) a chain error at all three locations → PROBLEM (TLS chain) in that one round', () => {
    const rows = [chain('BKK', 1), chain('SIN', 2), chain('TYO', 3)];
    expect(decideSite(site([home(rows)]))).toMatchObject({
      kind: 'problem',
      trigger: 'tls_chain',
      detail: { kind: 'tls_chain', code: CHAIN, locations: ['BKK', 'SIN', 'TYO'] },
      startedAt: at(1),
    });
  });

  it('…and its rechecks change nothing: still PROBLEM, never DOWN', () => {
    const scheduled = [chain('BKK', 1), chain('SIN', 2), chain('TYO', 3)];
    const rows = [...scheduled, ...scheduled.map((c, i) => recheck(c, 31 + i))];
    const d = decideSite(site([home(rows)]));
    expect(d).toMatchObject({ kind: 'problem', trigger: 'tls_chain' });
  });

  it('(2) an expired certificate at all three locations is still DOWN, through check + recheck', () => {
    const expired = (l: ProbeLocation, sec: number) => check(l, 'fail', sec, { error: 'CERT_HAS_EXPIRED' });
    const scheduled = [expired('BKK', 1), expired('SIN', 2), expired('TYO', 3)];
    const rows = [...scheduled, ...scheduled.map((c, i) => recheck(c, 31 + i))];
    expect(decideSite(site([home(rows)]))).toMatchObject({ kind: 'open', startedAt: at(1) });
  });

  it('(3) chain errors at two locations and a 5xx at one → PROBLEM, not DOWN (one hard fail of three)', () => {
    const fivexx = check('TYO', 'fail', 3, { statusCode: 503, error: null });
    const rows = [chain('BKK', 1), chain('SIN', 2), fivexx, recheck(fivexx, 33)];
    expect(decideSite(site([home(rows)]))).toMatchObject({ kind: 'problem', trigger: 'tls_chain' });
  });

  it('two real hard fails still make DOWN, whatever the third location saw', () => {
    const t1 = check('SIN', 'fail', 2);
    const t2 = check('TYO', 'fail', 3);
    const rows = [chain('BKK', 1), t1, t2, recheck(t1, 32), recheck(t2, 33)];
    expect(decideSite(site([home(rows)]))).toMatchObject({ kind: 'open' });
  });

  it('one chain error with two passes is an OK round, and starts no regional clock', () => {
    const rows = [chain('BKK', 1), check('SIN', 'pass', 2), check('TYO', 'pass', 3)];
    const d = decideSite(site([home(rows)]));
    expect(d).toMatchObject({ kind: 'none', status: 'ok' });
    expect(d.kind === 'none' && d.monitors[0]?.failingSince).toEqual({});
  });

  it('a key page with a broken chain is a key-page PROBLEM', () => {
    const okHome = [check('BKK', 'pass', 1), check('SIN', 'pass', 2), check('TYO', 'pass', 3)];
    const page = [chain('BKK', 1), chain('SIN', 2), chain('TYO', 3)];
    expect(decideSite(site([home(okHome), keyPage(page)]))).toMatchObject({
      kind: 'problem',
      monitorId: 'contact',
      trigger: 'key_page',
      detail: { kind: 'tls_chain' },
    });
  });

  it('chain errors never mark a probe location faulty (spec §15.3 counts outages, not chain mistakes)', () => {
    const rows = [
      { location: 'SIN' as const, outcome: 'fail' as const, error: CHAIN },
      { location: 'SIN' as const, outcome: 'fail' as const, error: CHAIN },
      { location: 'SIN' as const, outcome: 'pass' as const, error: null },
      { location: 'TYO' as const, outcome: 'pass' as const, error: null },
    ];
    expect(faultyLocations(rows)).toEqual(new Set());
  });
});
