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
/** A Page change detail (S09d): made-up INC-0157 values, spec §26. */
const pageChange = (
  d: Partial<Extract<ProblemDetail, { kind: 'content_change' }>>,
): Extract<ProblemDetail, { kind: 'content_change' }> => ({
  kind: 'content_change',
  path: '/',
  changes: [],
  newScriptDomains: [],
  newLinkDomains: [],
  firstSeenAt: '2026-09-25T02:30:14Z',
  held: 3,
  checkId: 'c1',
  checkedAt: '2026-09-25T03:00:14Z',
  ...d,
});

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
      // S09c (D-041): what only a crawler view saw names the view instead of the locations.
      'a phrase only Googlebot was served',
      {
        kind: 'keyword',
        missing: [],
        forbidden: ['บาคาร่า', 'slot online'],
        locations: [],
        view: 'googlebot',
      },
      home,
      'Found “บาคาร่า”, “slot online” on / (as Googlebot)',
      '“บาคาร่า”, “slot online” found on the page (as Googlebot)',
    ],
    [
      'a redirect only for visitors from Google search',
      { kind: 'redirect', host: 'casino.example.net', locations: [], view: 'google_referer' },
      home,
      '/ → casino.example.net · not in this site’s allowlist (from Google search)',
      'redirects to casino.example.net (from Google search)',
    ],
    [
      'INC-0157 page change: a new script domain (spec §26.9)',
      pageChange({
        changes: [
          { field: 'title', was: 'Bangkok Airways – Taiwan', now: 'Bangkok Airways – Taiwan | สล็อตออนไลน์' },
          { field: 'scripts', added: ['evil-cdn.example'], removed: [] },
        ],
        newScriptDomains: ['evil-cdn.example'],
      }),
      home,
      '/ · new script domain evil-cdn.example',
      '2 changes · new script domain evil-cdn.example',
    ],
    [
      'a page change: only a new script domain',
      pageChange({
        changes: [{ field: 'scripts', added: ['evil-cdn.example', 'x.example'], removed: [] }],
        newScriptDomains: ['evil-cdn.example', 'x.example'],
      }),
      home,
      '/ · new script domain evil-cdn.example (+1 more)',
      'new script domain evil-cdn.example (+1 more)',
    ],
    [
      'INC-0157 page change: the title, a shared start shortened (spec §26.9)',
      pageChange({
        changes: [
          { field: 'title', was: 'Bangkok Airways – Taiwan', now: 'Bangkok Airways – Taiwan | สล็อตออนไลน์' },
        ],
      }),
      home,
      '/ · title “Bangkok Airways – Taiwan” → “… | สล็อตออนไลน์”',
      'title changed',
    ],
    [
      'a page change: a shared start mid-word stays whole',
      pageChange({ changes: [{ field: 'h1', was: 'Shop', now: 'Shopping' }] }),
      home,
      '/ · main heading “Shop” → “Shopping”',
      'main heading changed',
    ],
    [
      'a page change: new link domains only',
      pageChange({
        changes: [
          {
            field: 'links',
            added: ['facebook.com', 'casino.example', 'slotxo.example'],
            removed: ['old.example'],
          },
        ],
        newLinkDomains: ['casino.example', 'slotxo.example'],
      }),
      home,
      '/ · new link domains casino.example, slotxo.example',
      'new link domains',
    ],
    [
      'a page change: a robots tag added, markup stripped',
      pageChange({ changes: [{ field: 'robots', was: null, now: 'noindex <b>' }] }),
      home,
      '/ · robots (none) → “noindex b”',
      'robots changed',
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
      'a misconfigured certificate chain (D-029)',
      { kind: 'tls_chain', code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', locations: ['SIN', 'TYO', 'BKK'] },
      home,
      'TLS chain misconfigured (BKK, SIN, TYO) · most browsers open it, apps and API clients fail',
      'TLS chain misconfigured',
    ],
    [
      'a home page timing out on and off (D-050)',
      { kind: 'intermittent', blips: 3, windowMin: 30, locations: ['TYO', 'BKK'] },
      home,
      'Timing out on and off (BKK, TYO) · 3 times in 30 min',
      'timing out on and off',
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
