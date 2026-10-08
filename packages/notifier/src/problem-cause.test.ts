import { describe, expect, it } from 'vitest';
import type { ProblemDetail } from '@dxt/shared';
import { formatProblemCause, formatProblemSummary, type ProblemCauseContext } from './problem-cause';

// ChatAlert board, "PROBLEM cause wording · one example per trigger" (spec §10 template).
const home: ProblemCauseContext = {
  monitorUrl: 'https://fujilinks.example/',
  isPrimary: true,
  tier: 2,
  timeoutMs: 30_000,
};
const booking: ProblemCauseContext = {
  ...home,
  monitorUrl: 'https://fujilinks.example/booking',
  isPrimary: false,
};
const ALL = ['BKK', 'SIN', 'TYO'] as const;

describe('formatProblemCause / formatProblemSummary (D-022)', () => {
  it.each<[string, ProblemDetail, ProblemCauseContext, string, string]>([
    [
      'INC-0141 Fuji Links slow',
      { kind: 'slow', p50Ms: 5_800, thresholdMs: 5_000, locations: [...ALL] },
      home,
      'p50 5.8 s (BKK, SIN, TYO) · over the Tier 2 limit of 5 s for 3 checks in a row',
      'slow, p50 5.8 s',
    ],
    [
      'a site’s own slow limit',
      { kind: 'slow', p50Ms: 4_250, thresholdMs: 4_000, locations: ['SIN', 'BKK'] },
      home,
      'p50 4.3 s (BKK, SIN) · over its limit of 4 s for 3 checks in a row',
      'slow, p50 4.3 s',
    ],
    [
      'INC-0129 WeCare Asia keyword missing',
      { kind: 'keyword', missing: ['Book a session'], forbidden: [], locations: [...ALL] },
      home,
      'Missing “Book a session” on / (BKK, SIN, TYO)',
      '“Book a session” missing',
    ],
    [
      'forbidden text found',
      { kind: 'keyword', missing: [], forbidden: ['Database error'], locations: [...ALL] },
      home,
      'Found “Database error” on / (BKK, SIN, TYO)',
      '“Database error” found on the page',
    ],
    [
      'INC-0131 BA – Taiwan regional SIN',
      {
        kind: 'regional',
        location: 'SIN',
        minutes: 6,
        failure: { statusCode: null, error: 'Timeout' },
        okLocations: ['TYO', 'BKK'],
        since: '2026-09-14T14:06:00Z',
      },
      home,
      'SIN failing 6 min (timeout > 30 s) · BKK, TYO OK',
      'SIN failing 6 min',
    ],
    [
      'redirect off the allowlist',
      { kind: 'redirect', host: 'casino.example.net', locations: [...ALL] },
      home,
      '/ → casino.example.net · not in this site’s allowlist',
      'redirects to casino.example.net',
    ],
    [
      'INC-0138 Tubtong blocked, verifier unavailable',
      { kind: 'blocked', reason: 'not_picked_up', locations: [...ALL], statusCode: 403 },
      home,
      'HTTP 403 bot challenge (BKK, SIN, TYO) · browser verifier unavailable',
      'blocked by bot protection, not verified',
    ],
    [
      'blocked in the browser too (D-020)',
      { kind: 'blocked', reason: 'browser_blocked', locations: ['BKK', 'SIN'], statusCode: null },
      home,
      'Bot challenge (BKK, SIN) · blocked in the browser too',
      'blocked by bot protection, in the browser too',
    ],
    [
      'behind a WAF, the VPS’s control check down (D-027)',
      { kind: 'blocked', reason: 'control_failed', locations: ['SIN', 'TYO'], statusCode: 403 },
      home,
      'HTTP 403 bot challenge (SIN, TYO) · BKK network check failed, not verified',
      'blocked by bot protection, not verified (BKK network check failed)',
    ],
    [
      'key page 500 while home is OK',
      {
        kind: 'hard_fail',
        failing: ALL.map((location) => ({ location, statusCode: 500, error: null })),
      },
      booking,
      'Home OK · /booking → HTTP 500 (BKK, SIN, TYO)',
      'key page /booking, HTTP 500',
    ],
    [
      'key page 404',
      { kind: 'status', statusCode: 404, locations: ['BKK', 'SIN'] },
      booking,
      'Home OK · /booking → HTTP 404 (BKK, SIN)',
      'key page /booking, HTTP 404',
    ],
    [
      'key page failing in the browser',
      { kind: 'browser', detail: 'HTTP 502' },
      booking,
      'Home OK · /booking → Browser: page didn’t load (HTTP 502)',
      'key page /booking, page didn’t load in the browser',
    ],
  ])('%s', (_name, detail, ctx, cause, summary) => {
    expect(formatProblemCause(detail, ctx)).toBe(cause);
    expect(formatProblemSummary(detail, ctx)).toBe(summary);
  });

  it('never carries markup from page text, and words a browser failure without detail', () => {
    expect(
      formatProblemCause(
        { kind: 'keyword', missing: ['<b>Hi</b>'], forbidden: ['x'], locations: ['SIN'] },
        home,
      ),
    ).toBe('Missing “bHi/b” on / (SIN) · Found “x” on / (SIN)');
    expect(formatProblemCause({ kind: 'browser', detail: null }, booking)).toBe(
      'Home OK · /booking → Browser: page didn’t load',
    );
  });

  it('cuts a cause to what monitor_status holds, and strips Chat markup from a redirect host', () => {
    const long = formatProblemCause(
      {
        kind: 'keyword',
        missing: Array.from({ length: 20 }, (_, i) => `k${i}-${'x'.repeat(40)}`),
        forbidden: [],
        locations: ['SIN'],
      },
      home,
    );
    expect(long).toHaveLength(500);
    expect(long.endsWith('…')).toBe(true);
    const host = { kind: 'redirect' as const, host: 'evil<users/all>|x', locations: ['SIN' as const] };
    expect(formatProblemSummary(host, home)).toBe('redirects to evilusers/allx');
    expect(formatProblemCause(host, home)).not.toMatch(/[<>|]/);
  });
});
