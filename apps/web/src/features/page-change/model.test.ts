import { describe, expect, it } from 'vitest';
import type { PageFingerprint } from '@dxt/shared';
import {
  buildPageChange,
  changeRows,
  type BaselineRow,
  type PageChangeInput,
  type PlainFetch,
} from './model';
import { footerWords, headerCause, pendingWords, statusWords } from './words';

// Spec §26.8 FINGERPRINT states, with the boards' sample shape (made-up values, never product data).
const NOW = new Date('2026-10-15T03:07:00Z'); // 10:07 Bangkok
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const BASE: PageFingerprint = {
  title: 'Site A',
  description: 'Fly to Taipei',
  robots: 'index, follow',
  canonical: 'https://a.example/',
  h1: 'Welcome',
  scripts: ['static-cdn.example', 'tag-manager.example'],
  links: ['a.example', 'booking.example', 'old-promo.example'],
};
const baseline = (over: Partial<BaselineRow> = {}): BaselineRow => ({
  monitor_id: 'm1',
  fingerprint: BASE,
  first_set_at: ago(30 * 24 * 60),
  accepted_at: ago(30 * 24 * 60),
  accepted_by: null,
  reason: null,
  undo_before: null,
  undo_until: null,
  undo_by: null,
  ...over,
});
const fetch = (min: number, over: Partial<PageFingerprint> | null = {}, usable = true): PlainFetch => ({
  id: `f${min}`,
  checked_at: ago(min),
  usable,
  fingerprint: usable && over ? { ...BASE, ...over } : null,
  // an unusable fetch here is a bot-protection block (403)
  ...(usable ? {} : { outcome: 'blocked', status_code: 403 }),
});
const input = (over: Partial<PageChangeInput> = {}): PageChangeInput => ({
  monitorId: 'm1',
  baseline: baseline(),
  fetches: [fetch(7), fetch(37)],
  own: ['a.example'],
  incident: null,
  viewerId: 'u-tao',
  nameOf: (id) => (id === 'u-tao' ? 'Tao' : 'someone'),
  now: NOW,
  ...over,
});
const retitled = { title: 'Site A · Fly from 2,990 THB' };
const injected = { scripts: [...BASE.scripts, 'evil-cdn.example'], title: 'Site A | สล็อตออนไลน์' };

describe('buildPageChange (spec §26.8)', () => {
  it('No fingerprint yet: no baseline and no fetch', () => {
    const v = buildPageChange(input({ baseline: null, fetches: [] }));
    expect(v.status).toBe('no_fingerprint');
    expect(statusWords(v).line).toBe('No fingerprint yet — the first check runs within 30 min');
  });

  it('Recording: its first 14 days, the date per site, the current fingerprint shown', () => {
    const v = buildPageChange(input({ baseline: baseline({ first_set_at: ago(3 * 24 * 60) }) }));
    expect(v.status).toBe('recording');
    expect(statusWords(v)).toEqual({
      line: 'Recording — alerts start after 2 weeks of clean checks (from Mon 26 Oct)',
      sub: 'Until then it only records — no alerts.',
    });
    expect(v.fingerprint.map((r) => r.label)).toEqual([
      'Page title',
      'Meta description',
      'Robots',
      'Canonical URL',
      'Main heading (first h1)',
      'Script / iframe domains',
      'Link domains',
    ]);
  });

  it('Matches: one line, with who set the baseline', () => {
    expect(statusWords(buildPageChange(input())).line).toBe(
      'Matches baseline · checked 10:00 · baseline set Tue 15 Sep',
    );
    const byTao = buildPageChange(
      input({ baseline: baseline({ accepted_by: 'u-tao', accepted_at: ago(9000) }) }),
    );
    expect(statusWords(byTao).line).toBe(
      'Matches baseline · checked 10:00 · baseline accepted Fri 9 Oct by Tao',
    );
  });

  it('Change waiting: held 2 of 3, a PROBLEM at the 3rd fetch', () => {
    const v = buildPageChange(input({ fetches: [fetch(7, retitled), fetch(37, retitled), fetch(67)] }));
    expect(v).toMatchObject({ status: 'waiting', held: 2, firstSeenAt: ago(37), checkId: 'f7' });
    expect(statusWords(v).line).toBe(
      'Differs from the baseline · held 2 of 3 checks — a PROBLEM opens at 10:30 if it still differs',
    );
    expect(footerWords(v, true)).toEqual([
      'First seen 09:30 · held 2 of 3 checks (30 min)',
      'From the 10:00:00 fetch · next fetch 10:30',
    ]);
    expect(v.rows).toEqual([
      {
        field: 'title',
        label: 'Page title',
        kind: 'text',
        was: 'Site A',
        now: 'Site A · Fly from 2,990 THB',
      },
    ]);
  });

  it('PROBLEM open: the rows with domain chips, unchanged ones folded', () => {
    const v = buildPageChange(
      input({ fetches: [fetch(7, injected)], incident: { id: 'i1', number: 157, since: ago(37) } }),
    );
    expect(v).toMatchObject({ status: 'problem', newScript: ['evil-cdn.example'] });
    expect(statusWords(v).line).toBe('Differs from the baseline · PROBLEM open since 09:30');
    expect(v.rows).toEqual([
      { field: 'title', label: 'Page title', kind: 'text', was: 'Site A', now: 'Site A | สล็อตออนไลน์' },
      {
        field: 'scripts',
        label: 'Script / iframe domains',
        kind: 'domains',
        added: ['evil-cdn.example'],
        removed: [],
        unchanged: ['static-cdn.example', 'tag-manager.example'],
      },
    ]);
  });

  it('No data: the newest read was blocked; the last fingerprint read is kept', () => {
    const v = buildPageChange(input({ fetches: [fetch(7, null, false), fetch(37)] }));
    expect(v.status).toBe('no_data');
    expect(statusWords(v).line).toBe('Couldn’t read the page (blocked by bot protection) · last read 09:30');
    expect(buildPageChange(input({ fetches: [fetch(70)] })).status).toBe('no_data');
  });

  it('An accept inside its Undo: still compared with the previous baseline, Undo open', () => {
    const v = buildPageChange(
      input({
        baseline: baseline({
          fingerprint: { ...BASE, ...retitled },
          accepted_by: 'u-tao',
          accepted_at: ago(0),
          reason: 'Client redesign',
          undo_before: { fingerprint: BASE },
          undo_until: new Date(NOW.getTime() + 8_000).toISOString(),
          undo_by: 'u-tao',
        }),
        fetches: [fetch(7, retitled)],
      }),
    );
    expect(v).toMatchObject({ status: 'waiting', pending: { byViewer: true, reason: 'Client redesign' } });
    expect(pendingWords(v.pending!.until)).toBe(
      'Accepting as the new baseline — Undo is open until 10:07:08.',
    );
  });

  it('Accepted: the newest fetch is the accepted one — the next fetch compares against it', () => {
    const v = buildPageChange(
      input({
        baseline: baseline({
          fingerprint: { ...BASE, ...retitled },
          accepted_by: 'u-tao',
          accepted_at: ago(0),
          reason: 'Client redesign',
        }),
        fetches: [fetch(7, retitled)],
        incident: { id: 'i1', number: 157, since: ago(97) },
      }),
    );
    expect(v.status).toBe('accepted');
    expect(statusWords(v)).toEqual({
      line: 'Baseline accepted 10:07 by Tao · INC-0157 recovers when the 10:30 fetch matches it',
      sub: '“Client redesign”',
    });
  });
});

describe('the incident header cause (§26.3)', () => {
  it('one change, several, the domain only when there is one', () => {
    expect(headerCause([{ label: 'Page title' }], [])).toBe('Page title changed on /');
    expect(headerCause([{ label: 'a' }, { label: 'b' }, { label: 'c' }], ['evil-cdn.example'])).toBe(
      '3 changes on / · new script domain evil-cdn.example',
    );
    expect(headerCause([{ label: 'a' }, { label: 'b' }], [])).toBe('2 changes on /');
  });

  it('changeRows reads an opened incident’s detail in the card order', () => {
    expect(
      changeRows(
        [
          { field: 'links', added: ['casino.example'], removed: ['old-promo.example'] },
          { field: 'h1', was: 'Welcome', now: 'บาคาร่า' },
        ],
        BASE,
      ).map((r) => r.field),
    ).toEqual(['h1', 'links']);
  });
});
