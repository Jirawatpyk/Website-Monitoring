// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { HttpCheckRequest, HttpCheckResult } from '@dxt/probe';
import { CRAWLER_CLIENTS } from '@dxt/shared';
import { fakeDb } from '../../../test/fake-db';
import { crawlerConcurrency, isUsable, isUsablePlain, runCrawler } from './run-crawler';

const result = (over: Partial<HttpCheckResult> = {}): HttpCheckResult => ({
  outcome: 'pass',
  statusCode: 200,
  responseMs: 300,
  ttfbMs: 100,
  error: null,
  bodySample: '',
  finalUrl: 'https://a.example.test/',
  keywordMissing: [],
  keywordForbidden: [],
  waf: null,
  scanComplete: true,
  ...over,
});

const monitor = {
  id: 'm1',
  url: 'https://a.example.test/',
  must_not_contain: ['Index of /'],
  allowed_redirect_domains: [],
  headers: [{ name: 'Accept-Language', value: 'th' }],
  sites: { name: 'Site A', is_active: true },
};

const FP = {
  title: 'Site A',
  description: null,
  robots: null,
  canonical: null,
  h1: 'Welcome',
  scripts: [],
  links: ['example.test'],
};
/** The plain view (S09d) answers with a fingerprint; the crawler views don't ask for one. */
const plain = (req: HttpCheckRequest, over: Partial<HttpCheckResult> = {}) =>
  req.fingerprint ? result({ fingerprint: FP, keywordForbidden: [], ...over }) : null;

function setup(answer: (req: HttpCheckRequest) => HttpCheckResult) {
  const fake = fakeDb({
    'monitors.select': { data: [monitor] },
    'crawler_checks.insert': { data: { id: 'c1' } },
    'rpc.crawler_set_baseline': { data: false },
  });
  const check = vi.fn(async (req: HttpCheckRequest) => answer(req));
  return { fake, check };
}

describe('isUsable (D-041, D-042: not a 2xx / 3xx answer read to the end → no data)', () => {
  const offSite = { finalUrl: 'https://casino.example.net/' };
  it.each([
    ['a 200', result(), true],
    ['a tail that broke off clean (never says the page is clean)', result({ scanComplete: false }), false],
    [
      'a tail that broke off after a hit (the hit stands)',
      result({ scanComplete: false, keywordForbidden: ['บาคาร่า'] }),
      true,
    ],
    [
      'sent off-site to a host that refuses the bot (the redirect is the evidence)',
      result({ ...offSite, outcome: 'blocked', statusCode: 403 }),
      true,
    ],
    ['sent off-site to a host that fails', result({ ...offSite, outcome: 'fail', statusCode: 503 }), true],
    [
      'the www host is the same site',
      result({ finalUrl: 'https://www.a.example.test/', statusCode: 403 }),
      false,
    ],
    [
      'a subdomain (m.) refusing the bot is the site, so no data',
      result({ finalUrl: 'https://m.a.example.test/', outcome: 'blocked', statusCode: 403 }),
      false,
    ],
    [
      'an allowlisted host failing is no data',
      result({ finalUrl: 'https://pay.partner.example/', outcome: 'fail', statusCode: 503 }),
      false,
    ],
    [
      'a timeout after an off-site hop never answered',
      result({ ...offSite, outcome: 'fail', statusCode: null }),
      false,
    ],
    ['a 301 that ended there', result({ statusCode: 301 }), true],
    ['a plain 403 (a refused fake Googlebot)', result({ statusCode: 403 }), false],
    ['a 404', result({ statusCode: 404 }), false],
    ['a challenge', result({ outcome: 'blocked', statusCode: 403 }), false],
    ['a timeout', result({ outcome: 'fail', statusCode: null, error: 'Timeout' }), false],
    ['a 5xx', result({ outcome: 'fail', statusCode: 503 }), false],
  ])('%s', (_name, r, usable) => {
    expect(isUsable(r, 'https://a.example.test/', ['partner.example'])).toBe(usable);
  });
});

describe('isUsablePlain (S09d, D-046 item 4: a fingerprint of the page itself, read to its end)', () => {
  it.each([
    ['a 200 with a fingerprint', result({ fingerprint: FP }), true],
    ['no fingerprint (not asked, or not passing)', result(), false],
    ['a tail that broke off', result({ fingerprint: FP, scanComplete: false }), false],
    [
      'sent off-site (another host’s page)',
      result({ fingerprint: FP, finalUrl: 'https://casino.example.net/' }),
      false,
    ],
    [
      'the www host is the same site',
      result({ fingerprint: FP, finalUrl: 'https://www.a.example.test/' }),
      true,
    ],
    ['a 403', result({ fingerprint: FP, statusCode: 403 }), false],
    ['a challenge', result({ fingerprint: FP, outcome: 'blocked', statusCode: 403 }), false],
  ])('%s', (_name, r, usable) => {
    expect(isUsablePlain(r, 'https://a.example.test/')).toBe(usable);
  });
});

describe('runCrawler', () => {
  it('fails loudly when the first baseline can’t be written', async () => {
    const broken = fakeDb({
      'monitors.select': { data: [monitor] },
      'crawler_checks.insert': { data: { id: 'c1' } },
      'rpc.crawler_set_baseline': { error: { message: 'nope' } },
    });
    await expect(
      runCrawler({ db: broken.db, check: async (req) => plain(req) ?? result(), clock: () => 0 }),
    ).rejects.toThrow('crawler_set_baseline: nope');
  });

  it('names the sites that got their first baseline', async () => {
    const fake = fakeDb({
      'monitors.select': { data: [monitor] },
      'crawler_checks.insert': { data: { id: 'c1' } },
      'rpc.crawler_set_baseline': { data: true },
    });
    const summary = await runCrawler({
      db: fake.db,
      check: async (req) => plain(req) ?? result(),
      clock: () => 0,
    });
    expect(summary).toMatchObject({ baselinesSet: ['Site A'] });
  });

  it('fetches each live home page in the three views, whole body, and stores one row per view', async () => {
    const { fake, check } = setup(
      (req) =>
        plain(req) ??
        (req.client === CRAWLER_CLIENTS.googlebot ? result({ keywordForbidden: ['บาคาร่า'] }) : result()),
    );
    const summary = await runCrawler({
      db: fake.db,
      check,
      secretHeader: { name: 'X-DxT-Monitor', value: 's' },
      // a run whose rotation starts at the top of the list
      clock: () => Date.parse('2026-10-13T10:30:00Z'),
    });

    expect(check).toHaveBeenCalledTimes(3);
    expect(check.mock.calls[0]?.[0]).toMatchObject({
      url: 'https://a.example.test/',
      method: 'GET',
      scanWholeBody: true,
      mustNotContain: ['Index of /'],
      client: CRAWLER_CLIENTS.googlebot,
      headers: { 'Accept-Language': 'th', 'X-DxT-Monitor': 's' },
    });
    expect(check.mock.calls[1]?.[0].client).toBe(CRAWLER_CLIENTS.google_referer);
    // S09d: the plain view goes as the monitor itself, with no forbidden words, and fingerprints.
    expect(check.mock.calls[2]?.[0]).toMatchObject({ fingerprint: true, scanWholeBody: true });
    expect(check.mock.calls[2]?.[0].client).toBeUndefined();
    expect(check.mock.calls[2]?.[0].mustNotContain).toBeUndefined();

    // Only primary monitors of active sites.
    const load = fake.calls.find((c) => c.table === 'monitors');
    expect(load?.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'sites.is_active', true],
        ['eq', 'is_primary', true],
        ['eq', 'enabled', true],
      ]),
    );

    // One row per fetch, stored as it ends.
    const inserts = fake.calls.filter((c) => c.table === 'crawler_checks' && c.op === 'insert');
    expect(inserts.map((c) => c.values)).toEqual([
      expect.objectContaining({
        monitor_id: 'm1',
        view: 'googlebot',
        checked_at: '2026-10-13T10:30:00.000Z',
        usable: true,
        forbidden: ['บาคาร่า'],
        scan_complete: true,
      }),
      expect.objectContaining({ view: 'google_referer', usable: true, forbidden: [], fingerprint: null }),
      expect.objectContaining({ view: 'plain', usable: true, forbidden: null, fingerprint: FP }),
    ]);
    // The usable plain fetch is offered as the first baseline.
    expect(fake.rpcCalls).toEqual([{ name: 'crawler_set_baseline', args: { p_check_id: 'c1' } }]);
    expect(summary).toEqual({
      ok: true,
      fetched: 3,
      unusable: 0,
      hits: [{ site: 'Site A', view: 'googlebot', forbidden: ['บาคาร่า'] }],
    });
  });

  it('stores a refused, challenged or timed-out fetch as not usable, and reports no hit for it', async () => {
    const { fake, check } = setup((req) =>
      req.client === CRAWLER_CLIENTS.google_referer
        ? result({ outcome: 'fail', statusCode: null, error: 'Timeout', keywordForbidden: null })
        : result({ outcome: 'blocked', statusCode: 403, keywordForbidden: null }),
    );
    const summary = await runCrawler({ db: fake.db, check, clock: () => 0 });
    const inserts = fake.calls.filter((c) => c.table === 'crawler_checks');
    expect(inserts.map((c) => c.values)).toEqual([
      expect.objectContaining({ usable: false, outcome: 'blocked', status_code: 403 }),
      expect.objectContaining({ usable: false, outcome: 'fail', error: 'Timeout' }),
      expect.objectContaining({ view: 'plain', usable: false, fingerprint: null }),
    ]);
    // No baseline from a page that wasn't read.
    expect(fake.rpcCalls).toEqual([]);
    expect(summary).toEqual({ ok: true, fetched: 3, unusable: 3 });
  });

  it('starts no fetch past its budget, keeping the rows it stored', async () => {
    let t = 0;
    const { fake, check } = setup(() => {
      t += 100_000; // the first fetch takes 100 s
      return result();
    });
    const summary = await runCrawler({ db: fake.db, check, clock: () => t });
    expect(check).toHaveBeenCalledTimes(1);
    expect(fake.calls.filter((c) => c.table === 'crawler_checks')).toHaveLength(1);
    expect(summary).toMatchObject({ fetched: 1, skipped: 2 });
  });

  it('starts each run further down the list, so a cut run never skips the same sites twice', async () => {
    const order = async (at: number) => {
      const { fake, check } = setup(() => result());
      await runCrawler({ db: fake.db, check, clock: () => at });
      return check.mock.calls.map((c) => (c[0].fingerprint ? 'plain' : c[0].client));
    };
    expect(await order(0)).toEqual([CRAWLER_CLIENTS.googlebot, CRAWLER_CLIENTS.google_referer, 'plain']);
    expect(await order(30 * 60_000)).toEqual([
      CRAWLER_CLIENTS.google_referer,
      'plain',
      CRAWLER_CLIENTS.googlebot,
    ]);
  });

  it('adds lanes as sites are added', () => {
    expect(crawlerConcurrency(34)).toBe(6);
    expect(crawlerConcurrency(120)).toBe(20);
    expect(crawlerConcurrency(400)).toBe(24);
  });

  it('runs only in sin1', async () => {
    const { fake, check } = setup(() => result());
    expect(await runCrawler({ db: fake.db, check, vercel: { region: 'hnd1' } })).toEqual({
      ok: false,
      skipped: 'wrong_region',
      expected: 'sin1',
    });
    expect(check).not.toHaveBeenCalled();
  });

  it('writes nothing when no site is live, and fails loudly on a write error', async () => {
    const empty = fakeDb({ 'monitors.select': { data: [] } });
    expect(await runCrawler({ db: empty.db, check: vi.fn() })).toEqual({ ok: true, fetched: 0, unusable: 0 });
    expect(empty.calls.some((c) => c.table === 'crawler_checks')).toBe(false);

    const broken = fakeDb({
      'monitors.select': { data: [monitor] },
      'crawler_checks.insert': { error: { message: 'nope' } },
    });
    await expect(runCrawler({ db: broken.db, check: async () => result() })).rejects.toThrow(
      'crawler_checks: nope',
    );
  });
});
