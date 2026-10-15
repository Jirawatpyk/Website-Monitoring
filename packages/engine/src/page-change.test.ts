import { describe, expect, it } from 'vitest';
import type { CheckOutcome, PageFingerprint, ProbeLocation } from '@dxt/shared';
import type { OpenIncident, StoredCheck } from './monitor';
import { diffFingerprint, pageChangeState, type PageChangeInput, type PageFact } from './page-change';
import { decideSite, NEW_MONITOR, type MonitorCarry, type SiteMonitor, type SiteSnapshot } from './site';

// S09d (D-041, D-046, spec §26): the home page's fingerprint against its accepted baseline. The plain
// crawler fetch runs every 30 min; Tier 2 rounds as crawler.test.ts (Fuji Links, 3 minutes). Made-up
// INC-0157 values (spec §26: not in the sample ledger).
const R = Date.parse('2026-09-25T02:51:00Z');
const at = (sec: number) => new Date(R + sec * 1000);
const NOW = at(260);
const minAgo = (min: number) => new Date(NOW.getTime() - min * 60_000);
const LOCATIONS: ProbeLocation[] = ['BKK', 'SIN', 'TYO'];
const URL = 'https://fujilinks.example/';

const BASE: PageFingerprint = {
  title: 'Fuji Links',
  description: 'Golf in Japan',
  robots: 'index, follow',
  canonical: URL,
  h1: 'Welcome',
  scripts: ['static-cdn.example', 'googletagmanager.com'],
  links: ['fujilinks.example', 'booking.example', 'old-promo.example'],
};
const hash = (fp: PageFingerprint) => JSON.stringify(fp);
const fact = (min: number, over: Partial<PageFingerprint> = {}, id = `f${min}`): PageFact => {
  const fp = { ...BASE, ...over };
  const same = hash(fp) === hash(BASE);
  return { id, checkedAt: minAgo(min), hash: hash(fp), fingerprint: same ? null : fp };
};
const input = (facts: PageFact[], over: Partial<PageChangeInput> = {}): PageChangeInput => ({
  baselineHash: hash(BASE),
  baseline: BASE,
  pendingUntil: null,
  firstSetAt: new Date(NOW.getTime() - 30 * 86_400_000),
  facts,
  ...over,
});
const own = ['fujilinks.example'];
const state = (facts: PageFact[], over: Partial<PageChangeInput> = {}, open = false) =>
  pageChangeState(input(facts, over), { now: NOW, own, open });

const injected = { scripts: [...BASE.scripts, 'evil-cdn.example'] };
const retitled = { title: 'Fuji Links | สล็อตออนไลน์' };

describe('pageChangeState (D-046 items 3–6)', () => {
  it.each<[string, PageFact[], object]>([
    [
      'an injected <script src="evil-cdn.example"> → PROBLEM on that fetch',
      [fact(10, injected)],
      { kind: 'differs', alert: true, held: 1, diff: { newScriptDomains: ['evil-cdn.example'] } },
    ],
    [
      'a title change on the 1st fetch → waits',
      [fact(10, retitled)],
      { kind: 'differs', alert: false, held: 1 },
    ],
    [
      'a title change on the 2nd fetch → still waits',
      [fact(10, retitled), fact(40, retitled), fact(70)],
      { kind: 'differs', alert: false, held: 2, firstSeenAt: minAgo(40) },
    ],
    [
      'a title change on the 3rd fetch → PROBLEM, first seen at the 1st',
      [fact(10, retitled), fact(40, retitled), fact(70, retitled), fact(100)],
      { kind: 'differs', alert: true, held: 3, firstSeenAt: minAgo(70) },
    ],
    [
      'a different change each fetch still holds (it differs every time)',
      [
        fact(10, retitled),
        fact(40, { h1: 'บาคาร่า' }),
        fact(70, { links: [...BASE.links, 'casino.example'] }),
      ],
      { kind: 'differs', alert: true, held: 3 },
    ],
    [
      'a rotating banner, prices or a news list (outside the fingerprint) → the same fingerprint, matches',
      [fact(10), fact(40), fact(70)],
      { kind: 'matches', at: minAgo(10) },
    ],
    [
      'tracking domains added (Tag Manager, Meta pixel, Analytics) → matches',
      [fact(10, { scripts: [...BASE.scripts, 'facebook.net', 'google-analytics.com'] })],
      { kind: 'matches' },
    ],
    [
      'a script from the site’s own domain → matches',
      [fact(10, { scripts: [...BASE.scripts, 'fujilinks.example'] })],
      { kind: 'matches' },
    ],
    [
      'a removed link or script domain alone → matches (shown, never alerted on)',
      [fact(10, { links: ['fujilinks.example', 'booking.example'], scripts: ['static-cdn.example'] })],
      { kind: 'matches' },
    ],
    [
      'the title back on the newest fetch → matches',
      [fact(10), fact(40, retitled), fact(70, retitled)],
      { kind: 'matches', at: minAgo(10) },
    ],
    ['the newest usable fetch older than 65 min → no data', [fact(70, injected)], { kind: 'no_data' }],
    ['no usable fetch at all → no data', [], { kind: 'no_data' }],
  ])('%s', (_name, facts, expected) => {
    expect(state(facts)).toMatchObject(expected);
  });

  it('an open Page change PROBLEM stays while the page differs at all', () => {
    expect(state([fact(10, retitled)], {}, true)).toMatchObject({ kind: 'differs', alert: true, held: 1 });
  });

  it('an accept waiting for its Undo: nothing is judged until it closes', () => {
    expect(state([fact(10, injected)], { pendingUntil: new Date(NOW.getTime() + 5_000) })).toEqual({
      kind: 'pending',
      until: new Date(NOW.getTime() + 5_000),
    });
    expect(state([fact(10, injected)], { pendingUntil: new Date(NOW.getTime() - 1) })).toMatchObject({
      kind: 'differs',
    });
  });
});

describe('diffFingerprint', () => {
  it('lists every differing row, removed domains included', () => {
    expect(
      diffFingerprint(
        BASE,
        { ...BASE, ...retitled, scripts: ['static-cdn.example', 'evil-cdn.example'], robots: null },
        own,
      ),
    ).toEqual({
      rows: [
        { field: 'title', was: 'Fuji Links', now: 'Fuji Links | สล็อตออนไลน์' },
        { field: 'robots', was: 'index, follow', now: null },
        { field: 'scripts', added: ['evil-cdn.example'], removed: ['googletagmanager.com'] },
      ],
      alerting: true,
      newScriptDomains: ['evil-cdn.example'],
    });
  });
});

// ── In the round (decideSite) ─────────────────────────────────────────────
const check = (location: ProbeLocation, outcome: CheckOutcome, sec: number): StoredCheck => ({
  location,
  outcome,
  checkedAt: at(sec),
  attempt: 1,
  statusCode: 200,
  error: null,
  responseMs: 800,
  keywordMissing: [],
  keywordForbidden: [],
});
const clean = LOCATIONS.map((l, i) => check(l, 'pass', 1 + i));
const home = (pageChange: PageChangeInput, carry: MonitorCarry = NEW_MONITOR): SiteMonitor => ({
  id: 'home',
  isPrimary: true,
  url: URL,
  slowThresholdMs: 5_000,
  allowedRedirectDomains: [],
  checks: clean,
  carry,
  pageChange,
});
const site = (monitors: SiteMonitor[], over: Partial<SiteSnapshot> = {}): SiteSnapshot => ({
  now: NOW,
  intervalSec: 180,
  locations: LOCATIONS,
  lastRoundAt: null,
  okRounds: 0,
  open: null,
  monitors,
  ...over,
});
const open: OpenIncident = { id: 'inc-0157', state: 'unacked', severity: 'problem', hasRootCause: false };
const held: MonitorCarry = { ...NEW_MONITOR, status: 'problem', trigger: 'content_change' };

describe('decideSite — page change (S09d Done-when 1)', () => {
  it('an injected script at the end of a 400 KB page → PROBLEM · Page change on that fetch', () => {
    expect(decideSite(site([home(input([fact(10, injected), fact(40)]))]))).toMatchObject({
      kind: 'problem',
      trigger: 'content_change',
      startedAt: minAgo(10),
      status: 'problem',
      detail: {
        kind: 'content_change',
        path: '/',
        newScriptDomains: ['evil-cdn.example'],
        changes: [{ field: 'scripts', added: ['evil-cdn.example'], removed: [] }],
        held: 1,
        checkId: 'f10',
      },
    });
  });

  it('a title change → nothing on the 2nd fetch, PROBLEM on the 3rd', () => {
    const two = [fact(10, retitled), fact(40, retitled), fact(70)];
    expect(decideSite(site([home(input(two))]))).toMatchObject({ kind: 'none', status: 'ok' });
    const three = [fact(10, retitled), fact(40, retitled), fact(70, retitled)];
    expect(decideSite(site([home(input(three))]))).toMatchObject({
      kind: 'problem',
      trigger: 'content_change',
      detail: { changes: [{ field: 'title', was: 'Fuji Links', now: 'Fuji Links | สล็อตออนไลน์' }], held: 3 },
    });
  });

  it.each<[string, PageFact[]]>([
    ['a rotating banner, prices or a news list', [fact(10), fact(40), fact(70)]],
    ['tracking domains', [fact(10, { scripts: [...BASE.scripts, 'facebook.net'] })]],
  ])('%s → no PROBLEM', (_name, facts) => {
    expect(decideSite(site([home(input(facts))]))).toMatchObject({ kind: 'none', status: 'ok' });
  });

  it('in its 14-day recording it records, never alerts', () => {
    const recording = input([fact(10, injected)], { firstSetAt: new Date(NOW.getTime() - 3 * 86_400_000) });
    expect(decideSite(site([home(recording)]))).toMatchObject({ kind: 'none', status: 'ok' });
  });

  it('a key page never gets one', () => {
    const page = { ...home(input([fact(10, injected)])), id: 'booking', isPrimary: false };
    expect(decideSite(site([home(input([fact(10)])), page]))).toMatchObject({ kind: 'none', status: 'ok' });
  });

  it.each<[string, PageChangeInput]>([
    ['no usable fetch (bot protection)', input([fact(70, injected)])],
    [
      'an accept waiting for its Undo',
      input([fact(10, injected)], { pendingUntil: new Date(NOW.getTime() + 5_000) }),
    ],
  ])('an open Page change PROBLEM holds: %s', (_name, pageChange) => {
    const holding = decideSite(site([home(pageChange, held)], { open }));
    expect(holding).toMatchObject({ kind: 'none', status: null });
    expect(holding.kind === 'none' && holding.monitors[0]).toMatchObject({
      status: 'problem',
      trigger: 'content_change',
    });
  });

  it('an open Page change PROBLEM recovers at the fetch that matches, never before it', () => {
    expect(decideSite(site([home(input([fact(1), fact(31, injected)]), held)], { open }))).toMatchObject({
      kind: 'recover',
      from: 'unacked',
      recoveredAt: minAgo(1),
    });
  });

  it('a page that still differs keeps it open even before 3 fetches', () => {
    expect(decideSite(site([home(input([fact(10, retitled)]), held)], { open }))).toMatchObject({
      kind: 'none',
      status: 'problem',
    });
  });
});
