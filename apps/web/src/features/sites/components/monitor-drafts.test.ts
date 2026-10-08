import { describe, expect, it } from 'vitest';
import type { MonitorRecord } from '../types';
import { describeChanges, isEdited, monitorTitle, pathOf, toDrafts, toSaveInput } from './monitor-drafts';
import { describeResult, formatResponse, testVerdict } from './test-verdict';

const SITE = '00000000-0000-4000-8000-0000000000a1';
const base = (over: Partial<MonitorRecord>): MonitorRecord => ({
  id: 'm1',
  isPrimary: true,
  url: 'https://a.example.com/',
  method: 'GET',
  timeoutSec: 30,
  mustContain: ['A'],
  mustNotContain: [],
  allowedRedirectDomains: [],
  slowMs: null,
  headers: [],
  enabled: true,
  ...over,
});
const originals = [
  base({}),
  base({ id: 'm2', isPrimary: false, url: 'https://a.example.com/booking', mustContain: [] }),
];

describe('monitor drafts (EditMonitors)', () => {
  it('titles and paths', () => {
    expect(monitorTitle({ isPrimary: true, url: 'https://a.example.com/', id: 'm1' })).toBe(
      'HTTP · home page',
    );
    expect(monitorTitle({ isPrimary: false, url: 'https://a.example.com/booking', id: 'm2' })).toBe(
      'Key page · /booking',
    );
    expect(monitorTitle({ isPrimary: false, url: 'https://a.example.com/', id: null })).toBe(
      'Key page · new',
    );
    expect(pathOf('https://a.example.com/x?y=1')).toBe('/x?y=1');
    expect(pathOf('not a url')).toBe('not a url');
  });

  it('only edited, new and removed monitors count as changes, in the discard dialog’s words', () => {
    const drafts = toDrafts(originals);
    expect(describeChanges(drafts, originals)).toEqual([]);
    drafts[0] = { ...drafts[0]!, timeoutSec: 20 };
    drafts[1] = { ...drafts[1]!, removed: true };
    drafts.push({ ...drafts[1]!, key: 'n', id: null, removed: false, url: 'https://a.example.com/' });
    expect(isEdited(drafts[0]!, originals)).toBe(true);
    expect(describeChanges(drafts, originals)).toEqual([
      'edits to HTTP · home page',
      'removing Key page · /booking',
      'adding Key page · new',
    ]);
  });

  it('builds the save input with the draft order for field errors', () => {
    const drafts = toDrafts(originals);
    drafts[1] = { ...drafts[1]!, removed: true };
    drafts.push({
      ...drafts[0]!,
      key: 'n',
      id: null,
      isPrimary: false,
      url: 'https://a.example.com/x',
      slowMs: 4000,
    });
    const { input, keys } = toSaveInput(SITE, drafts, originals);
    expect(keys).toEqual(['n']);
    expect(input).toEqual({
      siteId: SITE,
      upserts: [expect.objectContaining({ isPrimary: false, url: 'https://a.example.com/x', slowMs: 4000 })],
      removals: ['m2'],
    });
    expect(input.upserts[0]).not.toHaveProperty('id');
  });
});

describe('Test check words', () => {
  const r = (over: object) => ({
    location: 'SIN' as const,
    outcome: 'pass' as const,
    statusCode: 200,
    responseMs: 412,
    keywordMissing: [],
    keywordForbidden: [],
    error: null,
    ...over,
  });

  it.each([
    [r({}), 1, 'HTTP 200 · keyword found', 'pass'],
    [r({}), 0, 'HTTP 200 · no keyword set', 'pass'],
    [r({ keywordMissing: ['A'] }), 1, 'HTTP 200 · keyword missing', 'fail'],
    [r({ keywordForbidden: ['Index of /'] }), 0, 'HTTP 200 · forbidden text found', 'fail'],
    [r({ outcome: 'blocked', statusCode: 403 }), 1, '403 · bot challenge', 'blocked'],
    [r({ outcome: 'fail', statusCode: 503 }), 1, 'Hard fail · HTTP 503', 'fail'],
    [r({ outcome: 'fail', statusCode: null, error: 'Timeout' }), 1, 'Hard fail · Timeout', 'fail'],
    [r({ outcome: 'refused', statusCode: null }), 1, 'Not allowed · private address', 'fail'],
  ])('%j → %s', (result, keywords, text, look) => {
    expect(describeResult(result, keywords as number)).toEqual({ text, look });
  });

  it('a key page that fails everywhere is a PROBLEM, never DOWN (spec §6)', () => {
    const fail = [r({ outcome: 'fail' }), r({ outcome: 'fail', location: 'TYO' })];
    expect(testVerdict(fail, '', { isPrimary: false }).title).toBe('Would be: PROBLEM (Key page).');
    expect(testVerdict(fail, '').note).toBe(
      'Every location tested got a hard fail. Nothing is stored or alerted.',
    );
    expect(testVerdict([r({})], '', { beforeStart: true }).note).toContain('until monitoring starts');
  });

  it('formats response time', () => {
    expect([formatResponse(412), formatResponse(1234), formatResponse(null)]).toEqual([
      '412 ms',
      '1.2 s',
      '—',
    ]);
  });

  it.each([
    [[r({}), r({ location: 'TYO' })], 'Would be: OK.', '2 of 2 locations pass and “EQHO” is on the page.'],
    [[r({ outcome: 'refused' }), r({})], 'Not allowed.', 'private network'],
    [[r({ outcome: 'fail' }), r({ outcome: 'fail' })], 'Would be: DOWN.', 'hard fail'],
    [
      [
        r({ outcome: 'fail', error: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }),
        r({ outcome: 'fail', error: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }),
      ],
      'Would be: PROBLEM (TLS chain).',
      'most browsers still open the site',
    ],
    [
      [r({ outcome: 'fail', error: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }), r({})],
      'Would be: OK for now.',
      'misconfigured certificate chain',
    ],
    [
      [r({ outcome: 'fail', error: 'CERT_HAS_EXPIRED' }), r({ outcome: 'fail', error: 'CERT_HAS_EXPIRED' })],
      'Would be: DOWN.',
      'hard fail',
    ],
    [[r({ outcome: 'blocked' }), r({})], 'Would be: checked in the browser.', 'browser verifier'],
    [[r({ outcome: 'fail' }), r({})], 'Would be: OK for now.', 'never makes the site DOWN'],
    [[r({ keywordMissing: ['EQHO'] }), r({})], 'Would be: PROBLEM (Keyword).', '“EQHO” isn’t on the page.'],
    [[r({ keywordForbidden: ['Index of /'] }), r({})], 'Would be: PROBLEM (Keyword).', 'Index of /'],
  ])('verdict for %j', (results, title, note) => {
    const v = testVerdict(results, 'EQHO');
    expect(v.title).toBe(title);
    expect(v.note).toContain(note);
  });
});
