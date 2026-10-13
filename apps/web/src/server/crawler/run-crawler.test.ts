// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { HttpCheckRequest, HttpCheckResult } from '@dxt/probe';
import { CRAWLER_CLIENTS } from '@dxt/shared';
import { fakeDb } from '../../../test/fake-db';
import { isUsable, runCrawler } from './run-crawler';

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
  headers: [{ name: 'Accept-Language', value: 'th' }],
  sites: { name: 'Site A', is_active: true },
};

function setup(answer: (req: HttpCheckRequest) => HttpCheckResult) {
  const fake = fakeDb({ 'monitors.select': { data: [monitor] } });
  const check = vi.fn(async (req: HttpCheckRequest) => answer(req));
  return { fake, check };
}

describe('isUsable (D-041: not a 2xx / 3xx answer → no data)', () => {
  it.each([
    ['a 200', result(), true],
    ['a 301 that ended there', result({ statusCode: 301 }), true],
    ['a plain 403 (a refused fake Googlebot)', result({ statusCode: 403 }), false],
    ['a 404', result({ statusCode: 404 }), false],
    ['a challenge', result({ outcome: 'blocked', statusCode: 403 }), false],
    ['a timeout', result({ outcome: 'fail', statusCode: null, error: 'Timeout' }), false],
    ['a 5xx', result({ outcome: 'fail', statusCode: 503 }), false],
  ])('%s', (_name, r, usable) => {
    expect(isUsable(r)).toBe(usable);
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

    const insert = fake.calls.find((c) => c.table === 'crawler_checks' && c.op === 'insert');
    expect(insert?.values).toEqual([
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
    const summary = await runCrawler({ db: fake.db, check });
    const insert = fake.calls.find((c) => c.table === 'crawler_checks');
    expect(insert?.values).toEqual([
      expect.objectContaining({ usable: false, outcome: 'blocked', status_code: 403 }),
      expect.objectContaining({ usable: false, outcome: 'fail', error: 'Timeout' }),
    ]);
    expect(summary).toEqual({ ok: true, fetched: 2, unusable: 2 });
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
