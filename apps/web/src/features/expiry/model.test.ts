import { describe, expect, it } from 'vitest';
import { cardLabel, expirySummaryLine, expiryView, readWords, type ExpiryRecord } from './model';

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
        caption: 'Cando Asia domain 41 d · WeCare Studio domain 50 d',
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
      evidence: false,
    });
    expect(v.meta).toMatch(/· 1 of 2 read · 1 couldn't be read$/);
    expect(v.rows[0]!.status).toBe('failed');
  });

  it('a failed read 10 days out: greyed, "Couldn\'t read", first, in Within 60 days, counted nowhere (§39.4)', () => {
    const v = expiryView(
      [rec('cando', '2026-10-05', 90, '2027-04-24', { ssl_error: 'TLS handshake timed out' })],
      [{ id: 'cando', name: 'Cando Asia' }],
      NOW,
    );
    expect(v.rows[0]!.ssl).toMatchObject({ days: 10, tone: 'alert', evidence: false, date: '5 Oct 2026' });
    expect(v.rows[0]).toMatchObject({ status: 'failed', attention: true, soon: false });
    expect(v.kpis.map((k) => k.value)).toEqual(['0', '0', '0']);
  });

  it('a good read older than 36 h is not evidence either', () => {
    const stale = '2026-09-23T14:00:00Z'; // 37 h before NOW
    const v = expiryView(
      [rec('cando', '2026-10-05', 90, '2027-04-24', { ssl_read_at: stale })],
      [{ id: 'cando', name: 'Cando Asia' }],
      NOW,
    );
    expect(v.rows[0]!.ssl.evidence).toBe(false);
    expect(v.kpis[0]!.value).toBe('0');
    const fresh = expiryView(
      [rec('cando', '2026-10-05', 90, '2027-04-24')],
      [{ id: 'cando', name: 'Cando Asia' }],
      NOW,
    );
    expect(fresh.kpis[0]!.value).toBe('1');
  });

  it('an expired half: status Expired, named under its alert card, not repeated under Due within 60 days (§39.4)', () => {
    const v = expiryView(
      [rec('cando', '2026-09-24', 90, '2026-11-05')],
      [{ id: 'cando', name: 'Cando Asia' }],
      NOW,
    );
    expect(v.rows[0]!.status).toBe('expired');
    expect(v.kpis[0]).toMatchObject({ value: '1', caption: 'Cando Asia SSL expired' });
    expect(v.kpis[2]).toMatchObject({ value: '1', caption: 'Cando Asia domain 41 d' });
  });

  it("not checked yet and couldn't read sort first; a new site is named in the meta line", () => {
    const v = expiryView(
      [
        rec('cando', '2026-11-19', 90, '2026-11-05'),
        rec('orca', '2026-12-21', 90, '2027-03-15', { domain_error: 'RDAP 503' }),
      ],
      [
        { id: 'cando', name: 'Cando Asia' },
        { id: 'orca', name: 'ORCA Thailand' },
        { id: 'eqho', name: 'EQHO Academy', created_at: '2026-09-25T01:40:00Z' },
      ],
      NOW,
    );
    expect(v.rows.map((r) => r.siteId)).toEqual(['orca', 'eqho', 'cando']);
    expect(v.meta).toBe(
      "Checked daily 06:00 · last check Fri 25 Sep 06:00 · 3 of 6 read · 1 couldn't be read · EQHO Academy not checked yet (added today 08:40)",
    );
  });

  it('a site without TLS has one half to read', () => {
    const v = expiryView(
      [
        rec('plain', null, 0, '2027-04-24', { ssl_checked_at: null }),
        rec('cando', '2026-11-19', 90, '2026-11-05'),
      ],
      [
        { id: 'plain', name: 'Plain' },
        { id: 'cando', name: 'Cando Asia' },
      ],
      NOW,
    );
    expect(v.meta).toMatch(/· 3 of 3 read$/);
    expect(v.certificates).toBe(1);
    expect(v.rows.find((r) => r.siteId === 'plain')!.status).toBe('ok');
  });

  it('a hosting platform subdomain has one half to read: no domain, OK on its certificate', () => {
    const v = expiryView(
      [rec('t', '2027-01-29', 90, null, { domain_checked_at: null })],
      [{ id: 't', name: 'Test target' }],
      NOW,
    );
    expect(v.meta).toMatch(/· 1 of 1 read$/);
    expect(v.domains).toBe(0);
    expect(v.rows[0]!.status).toBe('ok');
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

describe('readWords — a failed read in words (spec §13)', () => {
  it.each([
    ['RDAP 503', 'Registry unavailable'],
    ['WHOIS unreachable', 'Registry unavailable'],
    ['RDAP 429', 'Registry refused the lookup'],
    ['ECONNRESET', "Couldn't connect"],
    ['Read failed', "Couldn't connect"],
    ['Timeout', 'Timeout'],
    ['No registry lookup for .app', 'No registry lookup for .app'],
  ])('%s → %s', (raw, words) => {
    expect(readWords(raw)).toBe(words);
  });
});

describe('cardLabel and the Sites row line (MExpiry, MSites, §39.6)', () => {
  it('names the card as the board does', () => {
    const v = expiryView(
      [
        rec('cando', '2026-11-19', 90, '2026-11-05'),
        rec('orca', '2026-12-21', 90, '2027-03-15', { domain_error: 'RDAP 503' }),
      ],
      [
        { id: 'cando', name: 'Cando Asia' },
        { id: 'orca', name: 'ORCA Thailand' },
        { id: 'new', name: 'EQHO Academy' },
      ],
      NOW,
    );
    const by = (id: string) => cardLabel(v.rows.find((r) => r.siteId === id)!);
    expect(by('cando')).toBe('Cando Asia, Due soon, SSL 19 Nov 2026, 55 days, domain 5 Nov 2026, 41 days');
    expect(by('orca')).toBe(
      "ORCA Thailand, Couldn't read, SSL 21 Dec 2026, 87 days, domain couldn't be read, Registry unavailable, last 15 Mar 2027",
    );
    expect(by('new')).toBe('EQHO Academy, Not checked yet, SSL not checked yet, domain not checked yet');
    expect(v.summary).toEqual({ due: 1, failed: 1, unchecked: 1 });
  });

  it('the Sites row: amber only for what is due', () => {
    expect(expirySummaryLine({ due: 2, failed: 1, unchecked: 0 })).toEqual({
      due: '2 due within 60 days',
      rest: " · 1 couldn't be read",
    });
    expect(expirySummaryLine({ due: 0, failed: 0, unchecked: 2 })).toEqual({
      due: null,
      rest: 'Nothing due within 60 days · 2 not checked yet',
    });
  });
});
