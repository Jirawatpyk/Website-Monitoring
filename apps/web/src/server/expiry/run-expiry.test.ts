// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ExpiryReadError } from '@dxt/probe';
import { fakeDb } from '../../../test/fake-db';
import { isFullRun, needsRead, runExpiry, type ExpirySite } from './run-expiry';

// S13 (D-066). 17 Nov 2026 10:00 Bangkok = 03:00 UTC; 06:00 Bangkok = 23:00 UTC the day before.
const NOW = Date.parse('2026-11-17T03:00:00Z');
const AT_SIX = Date.parse('2026-11-16T23:00:00Z');

const monitor = (site: string, url: string) => ({
  url,
  site_id: site,
  sites: { name: site, is_active: true },
});
const goodRow = (site: string, host: string, domain: string | null = host.replace(/^www\./, '')) => ({
  site_id: site,
  host,
  domain,
  ssl_read_at: '2026-11-16T23:00:00Z',
  ssl_error: null,
  domain_read_at: '2026-11-16T23:00:00Z',
  domain_error: null,
});
const cert = {
  expiresAt: new Date('2027-01-05T00:00:00Z'),
  validFrom: new Date('2026-10-07T00:00:00Z'),
  issuer: "Let's Encrypt",
};
const domain = { expiresAt: new Date('2027-07-26T09:08:05Z'), source: 'rdap' as const };

function setup(over: { rows?: unknown[]; open?: unknown[]; monitors?: unknown[] } = {}) {
  return fakeDb({
    'monitors.select': {
      data: over.monitors ?? [
        monitor('ba-tw', 'https://www.bangkokair.com/tw'),
        monitor('ba-cn', 'https://www.bangkokair.com/cn'),
        monitor('voca', 'https://www.voca.co.th/'),
      ],
    },
    'site_expiry.select': { data: over.rows ?? [] },
    'incidents.select': { data: over.open ?? [] },
    'site_expiry.upsert': { data: null },
  });
}

describe('isFullRun', () => {
  it('only the 06:00 Bangkok hour reads every site', () => {
    expect(isFullRun(AT_SIX)).toBe(true);
    expect(isFullRun(AT_SIX + 59 * 60_000)).toBe(true);
    expect(isFullRun(AT_SIX + 60 * 60_000)).toBe(false);
    expect(isFullRun(NOW)).toBe(false);
  });
});

describe('needsRead (between full reads)', () => {
  const site = (over: Partial<ExpirySite> = {}): ExpirySite => ({
    siteId: 's',
    siteName: 'S',
    host: 'www.voca.co.th',
    domain: 'voca.co.th',
    row: goodRow('s', 'www.voca.co.th'),
    openExpiry: false,
    ...over,
  });
  it.each([
    ['a good read from this morning', site(), false],
    ['no row yet', site({ row: null }), true],
    ['the host changed', site({ host: 'voca.co.th' }), true],
    ['an expiry PROBLEM is open (a renewal recovers within the hour)', site({ openExpiry: true }), true],
    [
      'a domain no registry here can read (an IP host) is not retried hourly',
      site({
        host: '203.0.113.9',
        domain: '203.0.113.9',
        row: {
          ...goodRow('s', '203.0.113.9'),
          domain_error: 'No registry lookup for .9',
          domain_read_at: null,
        },
      }),
      false,
    ],
    [
      'the last SSL read failed',
      site({ row: { ...goodRow('s', 'www.voca.co.th'), ssl_error: 'Timeout' } }),
      true,
    ],
    [
      'the last good read is a day old',
      site({ row: { ...goodRow('s', 'www.voca.co.th'), domain_read_at: '2026-11-16T02:59:00Z' } }),
      true,
    ],
  ])('%s → %s', (_, s, want) => expect(needsRead(s, NOW)).toBe(want));
});

describe('runExpiry', () => {
  it('refuses to run outside sin1', async () => {
    const { db } = setup();
    expect(await runExpiry({ db, vercel: { region: 'hnd1' } })).toEqual({
      ok: false,
      skipped: 'wrong_region',
      expected: 'sin1',
    });
  });

  it('06:00: every live site, each shared domain read once, one row per site', async () => {
    const { db, calls } = setup();
    const readCert = vi.fn(async (_host: string) => cert);
    const readDomain = vi.fn(async (_domain: string) => domain);
    const out = await runExpiry({ db, readCert, readDomain, clock: () => AT_SIX });
    expect(out).toMatchObject({ ok: true, full: true, sites: 3, read: 3, sslRead: 3, domainRead: 3 });
    expect(readCert.mock.calls.map((c) => c[0])).toEqual([
      'www.bangkokair.com',
      'www.bangkokair.com',
      'www.voca.co.th',
    ]);
    expect(readDomain.mock.calls.map((c) => c[0])).toEqual(['bangkokair.com', 'voca.co.th']);
    const rows = calls.filter((c) => c.op === 'upsert').map((c) => c.values);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toEqual({
      site_id: 'voca',
      host: 'www.voca.co.th',
      domain: 'voca.co.th',
      ssl_expires_at: '2027-01-05T00:00:00.000Z',
      ssl_valid_from: '2026-10-07T00:00:00.000Z',
      ssl_issuer: "Let's Encrypt",
      ssl_read_at: '2026-11-16T23:00:00.000Z',
      ssl_checked_at: '2026-11-16T23:00:00.000Z',
      ssl_error: null,
      domain_expires_at: '2027-07-26T09:08:05.000Z',
      domain_source: 'rdap',
      domain_read_at: '2026-11-16T23:00:00.000Z',
      domain_checked_at: '2026-11-16T23:00:00.000Z',
      domain_error: null,
    });
  });

  it('later in the day: only the sites that need it; a failed read keeps the last good dates', async () => {
    const { db, calls } = setup({
      rows: [goodRow('ba-tw', 'www.bangkokair.com'), goodRow('ba-cn', 'www.bangkokair.com')],
      open: [{ site_id: 'ba-cn' }],
    });
    const readCert = vi.fn(async (host: string) => {
      if (host === 'www.voca.co.th') throw new ExpiryReadError('ECONNRESET');
      return cert;
    });
    const out = await runExpiry({ db, readCert, readDomain: async () => domain, clock: () => NOW });
    // ba-tw read at 06:00 is skipped; ba-cn has an expiry PROBLEM open; voca has no row yet.
    expect(out).toMatchObject({ full: false, read: 2, sslRead: 1, domainRead: 2, failed: ['voca'] });
    const voca = calls.find((c) => c.op === 'upsert' && (c.values as { site_id: string }).site_id === 'voca')!
      .values as Record<string, unknown>;
    expect(voca).toMatchObject({ ssl_checked_at: '2026-11-17T03:00:00.000Z', ssl_error: 'ECONNRESET' });
    expect(voca).not.toHaveProperty('ssl_expires_at');
  });

  it('a host that moved drops the certificate dates read from the old one; the same domain keeps its own', async () => {
    const { db, calls } = setup({
      monitors: [monitor('voca', 'https://voca.co.th/')],
      rows: [goodRow('voca', 'www.voca.co.th')],
    });
    await runExpiry({
      db,
      readCert: async () => {
        throw new Error('unexpected');
      },
      readDomain: async () => {
        throw new ExpiryReadError('RDAP 503');
      },
      clock: () => NOW,
    });
    expect(calls.find((c) => c.op === 'upsert')!.values).toMatchObject({
      host: 'voca.co.th',
      ssl_error: 'Read failed',
      ssl_expires_at: null,
      ssl_read_at: null,
      domain_error: 'RDAP 503',
    });
    expect(calls.find((c) => c.op === 'upsert')!.values).not.toHaveProperty('domain_expires_at');
  });

  it('a domain that changed drops its old dates when the new read fails', async () => {
    const { db, calls } = setup({
      monitors: [monitor('voca', 'https://www.voca.com/')],
      rows: [goodRow('voca', 'www.voca.co.th')],
    });
    await runExpiry({
      db,
      readCert: async () => cert,
      readDomain: async () => {
        throw new ExpiryReadError('RDAP 503');
      },
      clock: () => NOW,
    });
    expect(calls.find((c) => c.op === 'upsert')!.values).toMatchObject({
      domain: 'voca.com',
      domain_expires_at: null,
      domain_source: null,
      domain_read_at: null,
    });
  });

  it('an http:// home page has no certificate to read: left out', async () => {
    const { db } = setup({ monitors: [monitor('plain', 'http://plain.example.test/')] });
    const readCert = vi.fn(async (_host: string) => cert);
    expect(await runExpiry({ db, all: true, readCert, readDomain: async () => domain })).toMatchObject({
      sites: 0,
      read: 0,
    });
    expect(readCert).not.toHaveBeenCalled();
  });

  it('no read starts after the budget; those sites wait for the next run', async () => {
    const { db, calls } = setup();
    // The first site's read takes 41 s (its lane starts the moment the run does); the two sites
    // after it start past the 40 s budget.
    let t = AT_SIX;
    const out = await runExpiry({
      db,
      readCert: async () => {
        t += 41_000;
        return cert;
      },
      readDomain: async () => domain,
      clock: () => t,
    });
    expect(out).toMatchObject({ ok: true, read: 1, skipped: 2 });
    expect(calls.filter((c) => c.op === 'upsert')).toHaveLength(1);
  });

  it('a host with no registrable domain still reads its certificate', async () => {
    const { db, calls } = setup({
      monitors: [monitor('ip', 'https://203.0.113.9/'), monitor('bad', 'not a url')],
    });
    const out = await runExpiry({
      db,
      all: true,
      readCert: async () => cert,
      readDomain: async () => domain,
      clock: () => NOW,
    });
    expect(out).toMatchObject({ sites: 1, sslRead: 1 });
    expect(calls.find((c) => c.op === 'upsert')!.values).toMatchObject({ domain: '203.0.113.9' });
  });

  it('a write that fails is named and fails the run, the other sites still written', async () => {
    const fake = fakeDb({
      'monitors.select': {
        data: [monitor('voca', 'https://www.voca.co.th/'), monitor('eqho', 'https://eqho.com/')],
      },
      'site_expiry.upsert': (call) =>
        (call.values as { site_id: string }).site_id === 'voca'
          ? { error: { message: 'boom' } }
          : { data: null },
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await runExpiry({
      db: fake.db,
      all: true,
      readCert: async () => cert,
      readDomain: async () => domain,
    });
    expect(out).toMatchObject({ ok: false, unwritten: ['voca'], sslRead: 2 });
    expect(fake.calls.filter((c) => c.op === 'upsert')).toHaveLength(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('expiry_write_failed'));
    error.mockRestore();
  });

  it.each(['monitors', 'site_expiry', 'incidents'])('a failed %s read fails the run', async (table) => {
    const fake = fakeDb({ [`${table}.select`]: { error: { message: 'down' } } });
    await expect(runExpiry({ db: fake.db })).rejects.toThrow(`${table}: down`);
  });
});
