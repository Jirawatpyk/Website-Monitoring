import { describe, expect, it } from 'vitest';
import type { CheckOutcome, ProbeLocation } from '@dxt/shared';
import type { OpenIncident, StoredCheck } from './monitor';
import { decideSite, NEW_MONITOR, type MonitorCarry, type SiteMonitor, type SiteSnapshot } from './site';
import { crawlerIssue, type CrawlerFact } from './triggers';

// S09c (D-041, D-042): what only a crawler view saw. Every 30 min the crawler fetches each live home
// page as Googlebot and as a mobile browser arriving from Google search; the engine reads each view's
// latest usable fetch beside the round. Tier 2 rounds as site.test.ts (Fuji Links, 3 minutes).
const R = Date.parse('2026-09-25T02:51:00Z');
const at = (sec: number) => new Date(R + sec * 1000);
const LOCATIONS: ProbeLocation[] = ['BKK', 'SIN', 'TYO'];

const check = (location: ProbeLocation, outcome: CheckOutcome, sec: number): StoredCheck => ({
  location,
  outcome,
  checkedAt: at(sec),
  attempt: 1,
  statusCode: outcome === 'fail' ? 500 : 200,
  error: null,
  responseMs: 800,
  keywordMissing: [],
  keywordForbidden: [],
});
const all = (outcome: CheckOutcome, over: Partial<StoredCheck> = {}) =>
  LOCATIONS.map((l, i) => ({ ...check(l, outcome, 1 + i), ...over }));
const failed = () => [
  ...all('fail'),
  ...LOCATIONS.map((l, i) => ({ ...check(l, 'fail', 31 + i), attempt: 2 as const })),
];
const clean = all('pass');

const monitor = (id: string, checks: StoredCheck[], over: Partial<SiteMonitor> = {}): SiteMonitor => ({
  id,
  isPrimary: id === 'home',
  url: id === 'home' ? 'https://fujilinks.example/' : `https://fujilinks.example/${id}`,
  slowThresholdMs: 5_000,
  allowedRedirectDomains: [],
  checks,
  carry: NEW_MONITOR,
  ...over,
});
const site = (monitors: SiteMonitor[], over: Partial<SiteSnapshot> = {}): SiteSnapshot => ({
  now: at(260),
  intervalSec: 180,
  locations: LOCATIONS,
  lastRoundAt: null,
  okRounds: 0,
  open: null,
  monitors,
  ...over,
});
const fact = (over: Partial<CrawlerFact> = {}): CrawlerFact => ({
  view: 'googlebot',
  checkedAt: at(-600),
  finalUrl: 'https://fujilinks.example/',
  forbidden: [],
  ...over,
});
const open: OpenIncident = { id: 'inc-1', state: 'unacked', severity: 'problem', hasRootCause: false };
const held: MonitorCarry = { ...NEW_MONITOR, status: 'problem', trigger: 'keyword' };

describe('decideSite — crawler views', () => {
  it.each<[string, CrawlerFact[], object]>([
    [
      'a phrase only Googlebot was served → PROBLEM (Keyword) "as Googlebot", started at the fetch',
      [fact({ forbidden: ['บาคาร่า'] }), fact({ view: 'google_referer' })],
      {
        kind: 'problem',
        trigger: 'keyword',
        detail: { kind: 'keyword', missing: [], forbidden: ['บาคาร่า'], locations: [], view: 'googlebot' },
        startedAt: at(-600),
        status: 'problem',
      },
    ],
    [
      'a redirect only for visitors from Google search → PROBLEM (Redirect) "from Google search"',
      [fact(), fact({ view: 'google_referer', finalUrl: 'https://casino.example.net/x' })],
      {
        kind: 'problem',
        trigger: 'redirect',
        detail: { kind: 'redirect', host: 'casino.example.net', locations: [], view: 'google_referer' },
      },
    ],
    [
      'both views hit: a forbidden word before a redirect, Googlebot first',
      [
        fact({ view: 'google_referer', forbidden: ['แทงบอล'], finalUrl: 'https://casino.example.net/' }),
        fact({ forbidden: ['slot online'] }),
      ],
      { kind: 'problem', trigger: 'keyword', detail: { forbidden: ['slot online'], view: 'googlebot' } },
    ],
    ['clean fetches → OK', [fact(), fact({ view: 'google_referer' })], { kind: 'none', status: 'ok' }],
    [
      'a redirect inside the allowlist (www, a subdomain) → OK',
      [
        fact({ finalUrl: 'https://www.fujilinks.example/' }),
        fact({ view: 'google_referer', finalUrl: 'https://shop.fujilinks.example/' }),
      ],
      { kind: 'none', status: 'ok' },
    ],
    ['no crawler fetch in the window → OK', [], { kind: 'none', status: 'ok' }],
  ])('%s', (_name, crawler, expected) => {
    expect(decideSite(site([monitor('home', clean, { crawler })]))).toMatchObject(expected);
  });

  it('the round’s own hit wins and carries no view', () => {
    const d = decideSite(
      site([
        monitor('home', all('pass', { keywordForbidden: ['บาคาร่า'] }), {
          crawler: [fact({ forbidden: ['บาคาร่า'] })],
        }),
      ]),
    );
    expect(d).toMatchObject({ trigger: 'keyword', startedAt: at(1) });
    expect(d.kind === 'problem' && 'view' in d.detail).toBe(false);
  });

  it('a fetch made after the round ended doesn’t count for that round', () => {
    const late = fact({ forbidden: ['บาคาร่า'], checkedAt: at(200) });
    expect(decideSite(site([monitor('home', clean, { crawler: [late] })]))).toMatchObject({
      kind: 'none',
      status: 'ok',
    });
  });

  it('stays open while the latest usable fetch is bad, and recovers once a clean one replaces it', () => {
    const bad = [fact({ forbidden: ['บาคาร่า'] })];
    expect(decideSite(site([monitor('home', clean, { carry: held, crawler: bad })], { open }))).toMatchObject(
      {
        kind: 'none',
        status: 'problem',
      },
    );
    expect(
      decideSite(site([monitor('home', clean, { carry: held, crawler: [fact()] })], { open })),
    ).toMatchObject({ kind: 'recover', from: 'unacked' });
  });

  it('a fetch from before a recovery starts the PROBLEM AGAIN at the round after it, never before', () => {
    // 09:41 fetch while the site was down; it recovered at the 09:48 round; this 09:51 round raises it.
    const recovered: OpenIncident = {
      ...open,
      state: 'monitoring',
      severity: 'down',
      episodeSeverity: 'down',
    };
    const d = decideSite(
      site([monitor('home', clean, { crawler: [fact({ forbidden: ['บาคาร่า'] })] })], {
        open: recovered,
        lastRoundAt: at(-180),
        okRounds: 1,
      }),
    );
    expect(d).toMatchObject({ kind: 'relapse', severity: 'problem', startedAt: at(0) });
  });

  it('a first PROBLEM starts at the fetch when the rounds since were judged without it', () => {
    const d = decideSite(
      site([monitor('home', clean, { crawler: [fact({ forbidden: ['บาคาร่า'] })] })], {
        lastRoundAt: at(-900),
      }),
    );
    expect(d).toMatchObject({ kind: 'problem', startedAt: at(-600) });
  });

  it('a DOWN round still wins over a crawler hit', () => {
    const d = decideSite(site([monitor('home', failed(), { crawler: [fact({ forbidden: ['บาคาร่า'] })] })]));
    expect(d).toMatchObject({ kind: 'open', status: 'down' });
  });

  it('a key page ignores crawler facts (the crawler fetches the home page only)', () => {
    const d = decideSite(
      site([
        monitor('home', clean),
        monitor('booking', clean, { crawler: [fact({ forbidden: ['บาคาร่า'] })] }),
      ]),
    );
    expect(d).toMatchObject({ kind: 'none', status: 'ok' });
  });
});

describe('crawlerIssue', () => {
  it('dedupes the words and ignores a fetch without a final URL', () => {
    expect(
      crawlerIssue([fact({ forbidden: ['a b', 'a b'] })], 'https://fujilinks.example/', [])?.detail,
    ).toMatchObject({ forbidden: ['a b'] });
    expect(crawlerIssue([fact({ finalUrl: null })], 'https://fujilinks.example/', [])).toBeNull();
  });

  it('honours the site’s redirect allowlist', () => {
    const f = fact({ finalUrl: 'https://booking.partner.example/' });
    expect(crawlerIssue([f], 'https://fujilinks.example/', ['partner.example'])).toBeNull();
    expect(crawlerIssue([f], 'https://fujilinks.example/', [])?.detail).toMatchObject({
      kind: 'redirect',
      host: 'booking.partner.example',
    });
  });
});
