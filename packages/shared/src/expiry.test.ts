import { describe, expect, it } from 'vitest';
import { certificateKind, daysLeft, expiryCounts, isDueSoon, isExpiryAlert } from './expiry';

// Spec §15.8 / §14.12: days left computed from Fri 25 Sep 2026 (the Expiry board's snapshot date).
const FRI = new Date('2026-09-25T03:07:00Z'); // 10:07 Bangkok
/** A Bangkok date at an arbitrary hour (certificates expire at any time of day). */
const on = (iso: string, hourUtc = 5) => new Date(`${iso}T${String(hourUtc).padStart(2, '0')}:41:12Z`);

describe('daysLeft (Bangkok calendar days, D-066 item 2)', () => {
  it.each([
    ['Cando Asia SSL 19 Nov', on('2026-11-19'), 55],
    ['Cando Asia domain 5 Nov', on('2026-11-05'), 41],
    ['WeCare Studio domain 14 Nov', on('2026-11-14'), 50],
    ['Bangkok Airways SSL 7 Dec', on('2026-12-07'), 73],
    ['Bangkok Airways domain 24 Apr 2027', on('2027-04-24'), 211],
    ['Tubtong SSL 9 Dec', on('2026-12-09'), 75],
    ['VOCA SSL 11 Dec', on('2026-12-11'), 77],
    ['Fuji Links SSL 14 Dec', on('2026-12-14'), 80],
    ['MuvMi SSL 16 Dec', on('2026-12-16'), 82],
    ['ENEOS SSL 18 Dec', on('2026-12-18'), 84],
    ['realme SSL 19 Dec', on('2026-12-19'), 85],
    ['EQHO SSL 20 Dec', on('2026-12-20'), 86],
    ['DxT AI SSL 21 Dec', on('2026-12-21'), 87],
    ['DxT AI domain 3 May 2027', on('2027-05-03'), 220],
    ['WeCare Asia SSL 22 Dec', on('2026-12-22'), 88],
  ])('%s → %i', (_, at, want) => expect(daysLeft(at, FRI)).toBe(want));

  it('counts Bangkok days, not 24-hour spans', () => {
    // 23:30 Bangkok on the 24th → 00:30 Bangkok on the 26th: two calendar days, 25 hours.
    expect(daysLeft(new Date('2026-09-25T17:30:00Z'), new Date('2026-09-24T16:30:00Z'))).toBe(2);
    // Expires later today: 0; yesterday: −1.
    expect(daysLeft(new Date('2026-09-25T16:00:00Z'), FRI)).toBe(0);
    expect(daysLeft(new Date('2026-09-24T10:00:00Z'), FRI)).toBe(-1);
  });
});

describe('thresholds', () => {
  it('alerts under 14 d (SSL) / 30 d (domain): INC-0136 DxT AI at 13 d', () => {
    expect(isExpiryAlert('ssl', 13)).toBe(true);
    expect(isExpiryAlert('ssl', 14)).toBe(false);
    expect(isExpiryAlert('domain', 29)).toBe(true);
    expect(isExpiryAlert('domain', 30)).toBe(false);
  });
  it('§14.12: due within 60 d; an auto-renew certificate within 30 d', () => {
    expect(isDueSoon('domain', 41)).toBe(true); // Cando domain
    expect(isDueSoon('domain', 60)).toBe(false);
    expect(isDueSoon('ssl', 55, true)).toBe(false); // Cando SSL, auto-renew: not listed
    expect(isDueSoon('ssl', 55, false)).toBe(true); // a paid certificate would be
    expect(isDueSoon('ssl', 29, true)).toBe(true);
  });
});

describe('certificateKind (D-066 item 5)', () => {
  const now = new Date('2026-11-17T03:00:00Z'); // Tue 17 Nov
  it('a 90-day certificate renews itself', () => {
    expect(certificateKind(new Date('2026-10-07T11:41:55Z'), new Date('2027-01-05T11:41:54Z'), now)).toEqual({
      autoRenew: true,
      label: 'Auto-renew · 90 d',
    });
  });
  it('a 1-year certificate is paid (Cando Asia, Sectigo 366 d)', () => {
    expect(certificateKind(new Date('2025-12-28T00:00:00Z'), new Date('2026-12-29T23:59:59Z'), now)).toEqual({
      autoRenew: false,
      label: 'Paid · 1 year',
    });
  });
  it('issued in the last 7 days reads "Renewed {weekday}"', () => {
    // Thu 12 Nov 10:00 Bangkok.
    expect(
      certificateKind(new Date('2026-11-12T03:00:00Z'), new Date('2027-02-10T03:00:00Z'), now).label,
    ).toBe('Renewed Thu · 90 d');
    expect(
      certificateKind(new Date('2026-11-09T03:00:00Z'), new Date('2027-02-07T03:00:00Z'), now).label,
    ).toBe('Auto-renew · 90 d');
  });
  it('an odd lifetime under a year is shown in days', () => {
    expect(
      certificateKind(new Date('2026-07-01T00:00:00Z'), new Date('2026-12-28T00:00:00Z'), now).label,
    ).toBe('Paid · 180 d');
  });
});

describe('expiryCounts — one site, both halves (§15.8)', () => {
  it('Cando: an auto-renew certificate at 55 days is plain, its domain at 41 amber', () => {
    const c = expiryCounts(
      {
        ssl_expires_at: '2026-11-19T05:00:00Z',
        ssl_valid_from: '2026-08-21T05:00:00Z',
        domain_expires_at: '2026-11-05T05:00:00Z',
      },
      FRI,
    );
    expect(c).toEqual({
      ssl: { days: 55, tone: 'plain' },
      certificate: { autoRenew: true, label: 'Auto-renew · 90 d' },
      domain: { days: 41, tone: 'soon' },
    });
  });

  it('a half with no date is null; under the alert line is red', () => {
    const c = expiryCounts(
      { ssl_expires_at: '2026-10-06T05:00:00Z', ssl_valid_from: null, domain_expires_at: null },
      FRI,
    );
    expect(c).toEqual({ ssl: { days: 11, tone: 'alert' }, certificate: null, domain: null });
  });
});
