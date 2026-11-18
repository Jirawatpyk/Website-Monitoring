import { describe, expect, it } from 'vitest';
import { expiryView, type ExpiryRecord } from './model';

// Board Expiry / spec §15.8 sample (test data only): today is Fri 25 Sep 2026 (Bangkok).
const NOW = new Date('2026-09-25T03:00:00Z');
const day = (d: string) => `${d}T05:00:00Z`; // 12:00 Bangkok that day
const minus = (d: string, days: number) => new Date(Date.parse(day(d)) - days * 86_400_000).toISOString();
const READ = '2026-09-24T23:00:00Z'; // the 06:00 run

const rec = (
  site_id: string,
  ssl: string | null,
  lifetime: number,
  domain: string | null,
  over: Partial<ExpiryRecord> = {},
): ExpiryRecord => ({
  site_id,
  ssl_expires_at: ssl ? day(ssl) : null,
  ssl_valid_from: ssl ? minus(ssl, lifetime) : null,
  ssl_read_at: ssl ? READ : null,
  ssl_checked_at: READ,
  ssl_error: null,
  domain_expires_at: domain ? day(domain) : null,
  domain_read_at: domain ? READ : null,
  domain_checked_at: READ,
  domain_error: null,
  ...over,
});

const sites = [
  { id: 'cando', name: 'Cando Asia' },
  { id: 'wecare', name: 'WeCare Studio' },
  { id: 'ba-tw', name: 'Bangkok Airways – Taiwan' },
  { id: 'dxt-ai', name: 'DxT AI' },
];
const records = [
  rec('cando', '2026-11-19', 90, '2026-11-05'),
  rec('wecare', '2026-12-02', 90, '2026-11-14'),
  rec('ba-tw', '2026-12-07', 365, '2027-04-24'),
  // Renewed on Tue 22 Sep: a 90-day certificate issued within the week.
  rec('dxt-ai', '2026-12-21', 90, '2027-05-03'),
];

describe('expiryView — the §15.8 figures on Fri 25 Sep 2026 (Done-when 2)', () => {
  const v = expiryView(records, sites, NOW);
  const row = (id: string) => v.rows.find((r) => r.siteId === id)!;

  it.each([
    ['cando', 55, 41],
    ['wecare', 68, 50],
    ['ba-tw', 73, 211],
    ['dxt-ai', 87, 220],
  ])('%s: SSL %i days, domain %i days', (id, ssl, domain) => {
    expect(row(id).ssl.days).toBe(ssl);
    expect(row(id).domain.days).toBe(domain);
  });

  it('dates read as the board writes them', () => {
    expect(row('cando').ssl.date).toBe('19 Nov 2026');
    expect(row('ba-tw').domain.date).toBe('24 Apr 2027');
  });

  it('the certificate column comes from the certificate (D-066 item 5)', () => {
    expect(row('cando').certificate).toBe('Auto-renew · 90 d');
    expect(row('ba-tw').certificate).toBe('Paid · 1 year');
    expect(row('dxt-ai').certificate).toBe('Renewed Tue · 90 d');
  });

  it('tone: amber under 60 days, an auto-renew certificate only under 30', () => {
    expect(row('cando').ssl.tone).toBe('plain'); // auto-renew: amber only under 30
    expect(row('cando').domain.tone).toBe('soon'); // domains: under 60
    expect(row('ba-tw').ssl.tone).toBe('plain'); // paid, 73 ≥ 60
    expect(row('wecare').domain.tone).toBe('soon');
  });

  it('soonest expiry first, and Due soon / OK per row', () => {
    expect(v.rows.map((r) => r.siteId)).toEqual(['cando', 'wecare', 'ba-tw', 'dxt-ai']);
    expect(v.rows.map((r) => r.soon)).toEqual([true, true, false, false]);
    expect(v.rows.map((r) => r.status)).toEqual(['soon', 'soon', 'ok', 'ok']);
  });

  it('KPIs count the same rows', () => {
    expect(v.kpis).toEqual([
      { label: 'SSL under 14 days', value: '0', caption: 'Would open a PROBLEM' },
      { label: 'Domains under 30 days', value: '0', caption: 'Would open a PROBLEM' },
      {
        label: 'Due within 60 days',
        value: '2',
        unit: 'items',
        caption: 'Cando Asia 41 d · WeCare Studio 50 d',
      },
    ]);
  });

  it('the meta line: the last check and how many halves read', () => {
    expect(v.meta).toBe('Checked daily 06:00 · last check Fri 25 Sep 06:00 · 8 of 8 read');
  });
});

describe('expiryView — alerts, failures and sites with no read', () => {
  it('SSL under 14 days and a domain under 30 days are red and counted', () => {
    const v = expiryView(
      [rec('cando', '2026-10-06', 90, '2026-10-15')],
      [{ id: 'cando', name: 'Cando Asia' }],
      NOW,
    );
    expect(v.rows[0]!.ssl).toMatchObject({ days: 11, tone: 'alert' });
    expect(v.rows[0]!.domain).toMatchObject({ days: 20, tone: 'alert' });
    expect(v.kpis.map((k) => k.value)).toEqual(['1', '1', '2']);
  });

  it('a failed read keeps its last date and carries the error; it counts as not read', () => {
    const v = expiryView(
      [rec('cando', '2026-11-19', 90, null, { domain_error: 'No registry lookup for .app' })],
      [{ id: 'cando', name: 'Cando Asia' }],
      NOW,
    );
    expect(v.rows[0]!.domain).toEqual({
      date: null,
      days: null,
      tone: 'none',
      error: 'No registry lookup for .app',
    });
    expect(v.meta).toMatch(/· 1 of 2 read$/);
    expect(v.rows[0]!.status).toBe('failed');
  });

  it('a site with no row yet: dashes, listed last, "not checked yet"', () => {
    const v = expiryView([], [{ id: 'new', name: 'New site' }], NOW);
    expect(v.rows[0]).toMatchObject({
      ssl: { date: null },
      domain: { date: null },
      soonest: null,
      soon: false,
      status: 'unchecked',
    });
    expect(v.meta).toBe('Checked daily 06:00 · not checked yet · 0 of 2 read');
    expect(v.kpis[2]!.caption).toBe('Nothing due');
  });
});
