// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { HttpCheckRequest, HttpCheckResult } from '@dxt/probe';
import { CRAWLER_CLIENTS } from '@dxt/shared';
import { fakeDb } from '../../../test/fake-db';
import { crawlerConcurrency, isUsable, runCrawler } from './run-crawler';

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

function setup(answer: (req: HttpCheckRequest) => HttpCheckResult) {
  const fake = fakeDb({ 'monitors.select': { data: [monitor] } });
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

describe('runCrawler', () => {
  it('fetches each live home page in both views, whole body, and stores one row per view', async () => {
    const { fake, check } = setup((req) =>
      req.client === CRAWLER_CLIENTS.googlebot ? result({ keywordForbidden: ['บาคาร่า'] }) : result(),
    );
    const summary = await runCrawler({
      db: fake.db,
      check,
      secretHeader: { name: 'X-DxT-Monitor', value: 's' },
      clock: () => Date.parse('2026-10-13T10:00:00Z'),
    });

    expect(check).toHaveBeenCalledTimes(2);
    expect(check.mock.calls[0]?.[0]).toMatchObject({
      url: 'https://a.example.test/',
      method: 'GET',
      scanWholeBody: true,
      mustNotContain: ['Index of /'],
      client: CRAWLER_CLIENTS.googlebot,
      headers: { 'Accept-Language': 'th', 'X-DxT-Monitor': 's' },
    });
    expect(check.mock.calls[1]?.[0].client).toBe(CRAWLER_CLIENTS.google_referer);

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
        checked_at: '2026-10-13T10:00:00.000Z',
        usable: true,
        forbidden: ['บาคาร่า'],
        scan_complete: true,
      }),
      expect.objectContaining({ view: 'google_referer', usable: true, forbidden: [] }),
    ]);
    expect(summary).toEqual({
      ok: true,
      fetched: 2,
      unusable: 0,
      hits: [{ site: 'Site A', view: 'googlebot', forbidden: ['บาคาร่า'] }],
    });
  });

  it('stores a refused, challenged or timed-out fetch as not usable, and reports no hit for it', async () => {
    const { fake, check } = setup((req) =>
      req.client === CRAWLER_CLIENTS.googlebot
        ? result({ outcome: 'blocked', statusCode: 403, keywordForbidden: null })
        : result({ outcome: 'fail', statusCode: null, error: 'Timeout', keywordForbidden: null }),
    );
    const summary = await runCrawler({ db: fake.db, check, clock: () => 0 });
    const inserts = fake.calls.filter((c) => c.table === 'crawler_checks');
    expect(inserts.map((c) => c.values)).toEqual([
      expect.objectContaining({ usable: false, outcome: 'blocked', status_code: 403 }),
      expect.objectContaining({ usable: false, outcome: 'fail', error: 'Timeout' }),
    ]);
    expect(summary).toEqual({ ok: true, fetched: 2, unusable: 2 });
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
    expect(summary).toMatchObject({ fetched: 1, skipped: 1 });
  });

  it('starts each run further down the list, so a cut run never skips the same sites twice', async () => {
    const order = async (at: number) => {
      const { fake, check } = setup(() => result());
      await runCrawler({ db: fake.db, check, clock: () => at });
      return check.mock.calls.map((c) => c[0].client);
    };
    expect(await order(0)).toEqual([CRAWLER_CLIENTS.googlebot, CRAWLER_CLIENTS.google_referer]);
    expect(await order(30 * 60_000)).toEqual([CRAWLER_CLIENTS.google_referer, CRAWLER_CLIENTS.googlebot]);
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
