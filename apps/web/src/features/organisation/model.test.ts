import { describe, expect, it } from 'vitest';
import {
  changedFields,
  clientRows,
  daySetOf,
  gigabytes,
  hoursDiff,
  hoursError,
  hoursText,
  sameHours,
  tierCards,
  TIME_OPTIONS,
  type Hours,
  type OrgSite,
} from './model';

// The 17 sites of spec §3 by tier: 5 · 9 · 3.
const SITES: OrgSite[] = [
  ...['Bangkok Airways – Taiwan', 'Bangkok Airways – China', 'ENEOS Industrial', 'MuvMi', 'realme.link'].map(
    (name) => ({ name, tier: 1 as const }),
  ),
  ...[
    'Fuji Links',
    'WeCare Studio',
    'Tubtong',
    'Cando Asia',
    'ORCA Thailand',
    'WeCare Asia',
    'VOCA',
    'EQHO',
    'DxT',
  ].map((name) => ({ name, tier: 2 as const })),
  ...['DxT Solutions', 'DxT AI', 'DxT Games'].map((name) => ({ name, tier: 3 as const })),
];
const SAVED: Hours = { days: 'Mon–Fri', from: '09:00', to: '18:00' };

describe('the hours editor (Organisation board)', () => {
  it('offers 06:00–22:00 every 30 min', () => {
    expect(TIME_OPTIONS[0]).toBe('06:00');
    expect(TIME_OPTIONS[1]).toBe('06:30');
    expect(TIME_OPTIONS.at(-1)).toBe('22:00');
    expect(TIME_OPTIONS).toHaveLength(33);
  });

  it('reads the stored days as one of the board’s sets', () => {
    expect(daySetOf([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(daySetOf([6, 1, 2, 3, 4, 5])).toBe('Mon–Sat');
    expect(daySetOf([1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
    // Days written by SQL before S17 aren't silently read as Mon–Fri.
    expect(daySetOf([1, 3, 5])).toBeNull();
  });

  it('says “Must be after From” when the hours run backwards or are empty', () => {
    expect(hoursError({ ...SAVED, to: '09:00' })).toBe('Must be after From');
    expect(hoursError({ ...SAVED, from: '18:30' })).toBe('Must be after From');
    expect(hoursError(SAVED)).toBeNull();
  });

  it('words the hours as every other page does', () => {
    expect(hoursText(SAVED)).toBe('Mon–Fri 09:00–18:00');
    expect(hoursText({ days: 'Every day', from: '08:30', to: '20:00' })).toBe('Mon–Sun 08:30–20:00');
    expect(sameHours(SAVED, { ...SAVED })).toBe(true);
    expect(sameHours(SAVED, { ...SAVED, days: 'Mon–Sat' })).toBe(false);
  });
});

describe('tier cards', () => {
  it('count the live sites per tier and name them, with what each tier means', () => {
    const [t1, t2, t3] = tierCards(SITES);
    expect([t1!.count, t2!.count, t3!.count]).toEqual([5, 9, 3]);
    expect(t1!.names).toBe(
      'Bangkok Airways – Taiwan, Bangkok Airways – China, ENEOS Industrial, MuvMi, realme.link',
    );
    expect(t1!.facts).toEqual([
      { k: 'Checked every', v: '1 min' },
      { k: 'Covered', v: '24/7' },
      { k: 'Client update after', v: '15 min down' },
      { k: 'Uptime target', v: '99.95%' },
    ]);
    expect(t2!.facts.map((f) => f.v)).toEqual([
      '3 min',
      'Response hours only',
      '60 min down, in hours',
      '99.90%',
    ]);
    expect(t3!.facts).toContainEqual({ k: 'Client update', v: 'Report only' });
    expect(tierCards([])[0]!.names).toBe('No live sites');
  });
});

describe('the save dialog (Change response hours?)', () => {
  it('lists nothing while the hours are unchanged', () => {
    expect(hoursDiff(SAVED, { ...SAVED }, SITES)).toEqual([]);
  });

  it('shows before → after, “Affects 12 sites” for Tier 2–3 and Tier 1’s hand-over (D-048 item 10)', () => {
    const [t23, t1] = hoursDiff(SAVED, { days: 'Mon–Sat', from: '08:30', to: '17:30' }, SITES);
    expect(t23).toMatchObject({
      where: 'Tier 2–3 · response hours',
      before: 'Mon–Fri 09:00–18:00',
      after: 'Mon–Sat 08:30–17:30',
      affects: 'Affects 12 sites · 9 in Tier 2, 3 in Tier 3',
    });
    expect(t23!.covers).toContain('timers wait until 08:30; PROBLEM is held until 08:30');
    expect(t1).toMatchObject({
      where: 'Tier 1 · owner hours',
      affects:
        'Affects 5 sites · Bangkok Airways – Taiwan, Bangkok Airways – China, ENEOS Industrial, MuvMi, realme.link',
    });
    expect(t1!.covers).toBe(
      'Owners cover Mon–Sat 08:30–17:30; the person on call covers the rest. The on-call week still changes over on Monday at 09:00.',
    );
  });

  it('hours SQL wrote outside the choices: listed as “Was” even with the editor unchanged', () => {
    const [t23] = hoursDiff(SAVED, { ...SAVED }, SITES, 'Mon, Wed, Fri 09:00–18:00');
    expect(t23).toMatchObject({ before: 'Mon, Wed, Fri 09:00–18:00', after: 'Mon–Fri 09:00–18:00' });
    expect(changedFields(SAVED, { days: 'Mon–Sat', from: '08:30', to: '18:00' })).toBe(2);
  });

  it('words one site and no Tier 1 site', () => {
    const [t23, t1] = hoursDiff(SAVED, { ...SAVED, to: '17:00' }, [{ name: 'DxT AI', tier: 3 }]);
    expect(t23!.affects).toBe('Affects 1 site · 0 in Tier 2, 1 in Tier 3');
    expect(t1!.affects).toBe('No live Tier 1 sites');
  });
});

describe('clients', () => {
  it('client sites first by name, internal last, with AM and language', () => {
    const rows = clientRows([
      { name: 'Internal', internal: true, amName: null, language: 'en', sites: ['DxT', 'DxT AI'] },
      { name: 'MuvMi', internal: false, amName: 'Bua', language: 'th', sites: ['MuvMi'] },
      { name: 'Bangkok Airways', internal: false, amName: 'Bua', language: 'en', sites: ['Taiwan', 'China'] },
      { name: 'New client', internal: false, amName: null, language: 'en', sites: [] },
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Bangkok Airways', 'MuvMi', 'New client', 'Internal']);
    expect(rows[0]).toEqual({
      name: 'Bangkok Airways',
      sitesLine: 'Taiwan, China',
      count: 2,
      am: 'Bua',
      language: 'EN',
    });
    expect(rows[1]!.sitesLine).toBe('1 site');
    expect(rows[2]).toMatchObject({ sitesLine: 'No sites yet', am: 'No AM' });
    expect(rows[3]).toMatchObject({ am: '—', language: '—' });
  });
});

describe('data kept', () => {
  it('words the database size in GB', () => {
    expect(gigabytes(1.4 * 1024 ** 3)).toBe('1.4 GB');
    expect(gigabytes(8 * 1024 ** 3)).toBe('8 GB');
    expect(gigabytes(45 * 1024 ** 2)).toBe('45 MB');
    expect(gigabytes(1000)).toBe('1 MB');
    expect(gigabytes(12 * 1024 ** 3)).toBe('12 GB');
  });
});
