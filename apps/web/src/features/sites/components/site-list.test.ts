import { describe, expect, it } from 'vitest';
import type { SiteListRow } from '../types';
import {
  filterSites,
  listMeta,
  locationGlyph,
  needsAttention,
  NO_FILTERS,
  sortSites,
  statusCounts,
  type SiteListFilters,
} from './site-list';

// Sample data in the shape of the Sites board at Fri 25 Sep 10:07 (mock data — tests only).
const NOW = new Date('2026-09-25T03:07:00Z');
const ME = 'tao';
const person = (id: string) => ({ id, name: id[0]!.toUpperCase() + id.slice(1) });

function site(name: string, over: Partial<SiteListRow> = {}): SiteListRow {
  return {
    id: name,
    name,
    tier: 2,
    live: true,
    client: { id: 'internal', name: 'Internal', internal: true, amName: null },
    owner: person('tao'),
    backup: person('nok'),
    status: 'ok',
    checkedAt: '2026-09-25T03:06:02Z',
    url: `https://${name.toLowerCase().replace(/\W+/g, '')}.example.com/`,
    mutedUntil: null,
    openIncident: null,
    locations: { BKK: 'pass', SIN: 'pass', TYO: 'pass' },
    p50Ms: null,
    uptime30d: null,
    expiryDays: null,
    ...over,
  };
}

const muvmi = { id: 'muvmi', name: 'MuvMi', internal: false, amName: 'Bua' };
const ROWS: SiteListRow[] = [
  site('MuvMi', {
    tier: 1,
    status: 'down',
    client: muvmi,
    owner: person('arm'),
    backup: person('ploy'),
    uptime30d: 0.9977,
    openIncident: {
      id: 'i142',
      number: 142,
      state: 'escalated',
      level: 1,
      detectedAt: '2026-09-25T02:49:00Z',
      ackedBy: null,
    },
  }),
  site('Fuji Links', {
    status: 'problem',
    owner: person('ploy'),
    uptime30d: 1,
    client: { id: 'fuji', name: 'Fuji Links', internal: false, amName: 'Thee' },
    openIncident: {
      id: 'i141',
      number: 141,
      state: 'acknowledged',
      level: 0,
      detectedAt: '2026-09-25T02:30:00Z',
      ackedBy: 'Ploy',
    },
  }),
  site('WeCare Studio', {
    status: 'maintenance',
    owner: person('nok'),
    backup: person('ploy'),
    expiryDays: 50,
  }),
  site('Bangkok Airways – Taiwan', {
    tier: 1,
    owner: person('arm'),
    backup: person('ploy'),
    uptime30d: 0.9997,
  }),
  site('Cando Asia', { owner: person('nok'), backup: null, uptime30d: 0.9997, expiryDays: 55 }),
  site('DxT Games', { tier: 3, mutedUntil: '2026-09-25T11:00:00Z', uptime30d: 1 }),
  site('DxT', { mutedUntil: '2026-09-25T01:00:00Z' }), // a mute that has ended
  site('EQHO Academy', {
    live: false,
    status: null,
    checkedAt: null,
    owner: person('nok'),
    backup: person('ploy'),
  }),
  site('ENEOS Industrial', { tier: 1, status: null, owner: person('ploy'), backup: person('tao') }), // live, no round yet
];

const ctx = { meId: ME, now: NOW };
const names = (rows: SiteListRow[]) => rows.map((r) => r.name);
const only = (f: Partial<SiteListFilters>) => names(filterSites(ROWS, { ...NO_FILTERS, ...f }, ctx));

describe('Sites list filters (spec §20)', () => {
  it.each<[string, Partial<SiteListFilters>, string[]]>([
    ['search by name, any case', { q: 'muv' }, ['MuvMi']],
    ['search by client', { q: 'fuji links' }, ['Fuji Links']],
    ['search by URL', { q: 'bangkokairwaystaiwan.example' }, ['Bangkok Airways – Taiwan']],
    ['status Down', { status: 'down' }, ['MuvMi']],
    ['status Maintenance', { status: 'maintenance' }, ['WeCare Studio']],
    ['Muted = muted whatever the status, ended mutes not', { status: 'muted' }, ['DxT Games']],
    ['Drafts', { status: 'draft' }, ['EQHO Academy']],
    ['Tier 1', { tier: '1' }, ['MuvMi', 'Bangkok Airways – Taiwan', 'ENEOS Industrial']],
    [
      'Owner = a person (primary owner only)',
      { owner: 'nok' },
      ['WeCare Studio', 'Cando Asia', 'EQHO Academy'],
    ],
    ['Mine = owner or backup', { owner: 'mine' }, ['DxT Games', 'DxT', 'ENEOS Industrial']],
    ['Client', { client: 'muvmi' }, ['MuvMi']],
    ['Client Internal', { client: 'internal', tier: '1' }, ['Bangkok Airways – Taiwan', 'ENEOS Industrial']],
    [
      'Needs attention = open incident · draft · expiry < 60 d · no backup',
      { attention: true },
      ['MuvMi', 'Fuji Links', 'WeCare Studio', 'Cando Asia', 'EQHO Academy'],
    ],
    ['filters combine with AND', { attention: true, tier: '1' }, ['MuvMi']],
  ])('%s', (_label, f, expected) => {
    expect(only(f)).toEqual(expected);
  });

  it('search ignores the URL scheme and www', () => {
    expect(only({ q: 'https' })).toEqual([]);
    expect(only({ q: 'www' })).toEqual([]);
    expect(only({ q: 'dxtgames.example' })).toEqual(['DxT Games']);
  });

  it('needsAttention reads each reason on its own', () => {
    expect(needsAttention(site('A'))).toBe(false);
    expect(needsAttention(site('A', { backup: null }))).toBe(true);
    expect(needsAttention(site('A', { expiryDays: 59 }))).toBe(true);
    expect(needsAttention(site('A', { expiryDays: 60 }))).toBe(false);
    expect(needsAttention(site('A', { live: false }))).toBe(true);
  });
});

describe('Sites list sorts (spec §20)', () => {
  it('Status: Down → Problem → Maintenance → OK → no round yet → Not monitored, then tier, then name', () => {
    expect(names(sortSites(ROWS, 'status'))).toEqual([
      'MuvMi',
      'Fuji Links',
      'WeCare Studio',
      'Bangkok Airways – Taiwan',
      'Cando Asia',
      'DxT',
      'DxT Games',
      'ENEOS Industrial',
      'EQHO Academy',
    ]);
  });

  it('Name A–Z keeps drafts last', () => {
    expect(names(sortSites(ROWS, 'name'))).toEqual([
      'Bangkok Airways – Taiwan',
      'Cando Asia',
      'DxT',
      'DxT Games',
      'ENEOS Industrial',
      'Fuji Links',
      'MuvMi',
      'WeCare Studio',
      'EQHO Academy',
    ]);
  });

  it('Uptime 30d lowest first: sites without a figure after, ties by the default order, drafts last', () => {
    expect(names(sortSites(ROWS, 'uptime'))).toEqual([
      'MuvMi', // 99.77%
      'Bangkok Airways – Taiwan', // 99.97%, Tier 1
      'Cando Asia', // 99.97%, Tier 2
      'Fuji Links', // 100%, Problem first
      'DxT Games',
      'WeCare Studio', // no figure: default order
      'DxT',
      'ENEOS Industrial',
      'EQHO Academy',
    ]);
  });

  it('Expiry soonest first', () => {
    expect(names(sortSites(ROWS, 'expiry')).slice(0, 3)).toEqual(['WeCare Studio', 'Cando Asia', 'MuvMi']);
    expect(names(sortSites(ROWS, 'expiry')).at(-1)).toBe('EQHO Academy');
  });
});

describe('counts and meta (spec §20)', () => {
  it('status chips count every site, Muted by its overlay', () => {
    expect(statusCounts(ROWS, NOW)).toEqual({
      all: 9,
      down: 1,
      problem: 1,
      maintenance: 1,
      ok: 4,
      muted: 1,
      draft: 1,
    });
  });

  it('drafts count in "N sites" but not in "monitored"', () => {
    expect(listMeta(ROWS)).toBe('9 sites · 8 monitored · 1 draft');
    expect(listMeta([])).toBe('0 sites · 0 monitored · 0 drafts');
    expect(listMeta([site('A')])).toBe('1 site · 1 monitored · 0 drafts');
  });
});

describe('locationGlyph', () => {
  it.each([
    [undefined, 'none'],
    [{ outcome: 'pass' as const, error: null, responseMs: 400 }, 'pass'],
    [{ outcome: 'pass' as const, error: null, responseMs: 5_001 }, 'slow'],
    [{ outcome: 'pass' as const, error: null, responseMs: null }, 'pass'],
    [{ outcome: 'blocked' as const, error: null, responseMs: 200 }, 'blocked'],
    [{ outcome: 'fail' as const, error: 'ECONNREFUSED', responseMs: 10 }, 'fail'],
    [{ outcome: 'fail' as const, error: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', responseMs: 10 }, 'chain'],
  ])('%o → %s', (check, expected) => {
    expect(locationGlyph(check, 5_000)).toBe(expected);
  });
});
