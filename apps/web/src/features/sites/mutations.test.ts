// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Lookup } from '@dxt/probe';
import {
  createSite,
  deleteSite,
  DUPLICATE_URL,
  refusal,
  refusedTargets,
  saveMonitors,
  setMonitoring,
  type SitesDeps,
  updateSite,
} from './mutations';

const SITE_ID = '00000000-0000-4000-8000-0000000000a1';
const CLIENT_ID = '00000000-0000-4000-8000-0000000000c1';
const NOK = '00000000-0000-4000-8000-000000000001';
const PLOY = '00000000-0000-4000-8000-000000000002';

/** Public DNS for every host, except the ones a test points elsewhere. */
const dns =
  (overrides: Record<string, string> = {}): Lookup =>
  async (host) =>
    host in overrides ? [{ address: overrides[host]! }] : [{ address: '93.184.216.34' }];

function deps(result: { data?: unknown; error?: unknown } = { data: SITE_ID, error: null }, lookup = dns()) {
  const rpc = vi.fn(async () => ({ data: null, error: null, ...result }));
  return { rpc, deps: { db: { rpc } as unknown as SitesDeps['db'], lookup } };
}

const site = { name: 'EQHO Academy', clientId: CLIENT_ID, tier: 2, primaryOwnerId: NOK, backupOwnerId: PLOY };
const primary = { isPrimary: true, url: 'https://eqho.example.com', mustContain: ['EQHO Academy'] };

describe('createSite', () => {
  it('sends the site, the primary and key pages on its origin to create_site', async () => {
    const { rpc, deps: d } = deps();
    const r = await createSite({ site, primary, keyPages: ['/contact'], start: true }, d);
    expect(r).toEqual({ ok: true, siteId: SITE_ID });
    expect(rpc).toHaveBeenCalledWith('create_site', {
      p_site: expect.objectContaining({
        name: 'EQHO Academy',
        tier: 2,
        primary_owner_id: NOK,
        backup_owner_id: PLOY,
      }),
      p_monitors: [
        expect.objectContaining({
          is_primary: true,
          url: 'https://eqho.example.com/',
          timeout_ms: 30_000,
          must_contain: ['EQHO Academy'],
        }),
        expect.objectContaining({
          is_primary: false,
          url: 'https://eqho.example.com/contact',
          must_contain: [],
          method: 'GET',
        }),
      ],
      p_start: true,
    });
  });

  // Done-when 2: metadata, private and a hostname resolving to loopback are refused before saving.
  it.each([
    ['http://169.254.169.254/', 'metadata address'],
    ['http://10.0.0.5/', 'private address'],
    ['https://sneaky.example.com/', 'a host resolving to 127.0.0.1'],
  ])('refuses %s (%s) and saves nothing', async (url) => {
    const { rpc, deps: d } = deps(undefined, dns({ 'sneaky.example.com': '127.0.0.1' }));
    const r = await createSite({ site, primary: { ...primary, url } }, d);
    expect(r).toMatchObject({
      ok: false,
      fieldErrors: {
        'primary.url': 'This address points inside a private network — monitors check public sites only',
      },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a key page whose host is private too', async () => {
    // A key page is on the primary's origin, so the same host decides — here it resolves privately.
    const { rpc, deps: d } = deps(undefined, dns({ 'eqho.example.com': '192.168.1.10' }));
    const r = await createSite({ site, primary, keyPages: ['/contact'] }, d);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.fieldErrors).toMatchObject({
      'primary.url': expect.any(String),
      'keyPages.0': expect.any(String),
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('names the field of a form mistake', async () => {
    const { rpc, deps: d } = deps();
    const r = await createSite({ site: { ...site, backupOwnerId: NOK }, primary }, d);
    expect(r).toMatchObject({
      ok: false,
      fieldErrors: { 'site.backupOwnerId': 'Same as primary — pick another' },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  // Done-when 5 (D-015): the database names the people without a Chat id; the form shows them.
  it('shows who needs a Google Chat id', async () => {
    const { deps: d } = deps({
      data: null,
      error: {
        code: 'P0001',
        message: 'Owners need a Google Chat id: Nok',
        hint: 'owners_missing_chat_id',
        details: 'Nok',
      },
    });
    expect(await createSite({ site, primary }, d)).toEqual({
      ok: false,
      message: 'Nok needs a Google Chat id before they can own a site — ask an Admin to add it.',
    });
  });

  it('puts a duplicate URL next to the URL field', async () => {
    const { deps: d } = deps({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "monitors_primary_url_key"',
      },
    });
    expect(await createSite({ site, primary }, d)).toEqual({
      ok: false,
      message: DUPLICATE_URL,
      fieldErrors: { 'primary.url': DUPLICATE_URL },
    });
  });
});

describe('refusal', () => {
  it.each([
    [
      { hint: 'owners_missing_chat_id', details: 'Nok, Ploy' },
      'Nok, Ploy need a Google Chat id before they can own a site — ask an Admin to add it.',
    ],
    [
      { hint: 'owners_not_eligible', details: 'Bua' },
      'Bua can’t own a site — only active Admins and Responders can.',
    ],
    [
      { hint: 'site_not_ready', details: 'Backup owner, Credential reference' },
      'Not ready to monitor: Backup owner, Credential reference.',
    ],
    [{ hint: 'too_many_key_pages' }, 'At most 3 key pages per site.'],
    [{ hint: 'primary_not_removable' }, 'The primary monitor can’t be removed.'],
    [{ hint: 'primary_required' }, 'A site needs its primary monitor.'],
    [{ hint: 'site_is_live' }, 'Stop monitoring before deleting the site.'],
    [
      { hint: 'site_has_history' },
      'This site has monitoring history, so it stays for the record. Stop monitoring instead.',
    ],
    [{ code: '23505', message: 'sites_name_key' }, 'Another site already has this name.'],
    [{ code: '23503' }, 'The client or a person no longer exists — reload and try again.'],
    [{ code: '42501' }, 'Only an Admin can change sites and monitors.'],
    [{ code: 'P0002' }, 'This site or monitor doesn’t exist any more.'],
    [{ code: '08006' }, 'Couldn’t save. Check your connection and try again.'],
  ])('%j → %s', (error, message) => {
    expect(refusal({ message: '', ...error }).message).toBe(message);
  });
});

describe('refusedTargets', () => {
  it('names a non-standard port; a host that does not resolve right now is allowed', async () => {
    const lookup: Lookup = async (host) => {
      if (host === 'nowhere.example.com')
        throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      return [{ address: '93.184.216.34' }];
    };
    expect(
      await refusedTargets(
        [
          { field: 'a', url: 'https://ok.example.com:8443/' },
          { field: 'b', url: 'https://nowhere.example.com/' },
          { field: 'c', url: 'https://ok.example.com/' },
        ],
        lookup,
      ),
    ).toEqual({
      a: 'Use the standard port (80 or 443) — probes only check those',
    });
  });
});

describe('updateSite, setMonitoring, deleteSite', () => {
  it('update_site with the site fields', async () => {
    const { rpc, deps: d } = deps({ data: null, error: null });
    expect(await updateSite({ siteId: SITE_ID, site }, d)).toEqual({ ok: true, siteId: SITE_ID });
    expect(rpc).toHaveBeenCalledWith('update_site', {
      p_site_id: SITE_ID,
      p_site: expect.objectContaining({ hosting: '' }),
    });
  });

  it('start and stop', async () => {
    const { rpc, deps: d } = deps({ data: null, error: null });
    await setMonitoring(SITE_ID, true, d);
    await setMonitoring(SITE_ID, false, d);
    expect(rpc.mock.calls).toEqual([
      ['set_site_monitoring', { p_site_id: SITE_ID, p_on: true }],
      ['set_site_monitoring', { p_site_id: SITE_ID, p_on: false }],
    ]);
  });

  it('a bad id is "doesn’t exist" without a call', async () => {
    const { rpc, deps: d } = deps();
    expect(await setMonitoring('nope', true, d)).toMatchObject({
      ok: false,
      message: 'This site or monitor doesn’t exist any more.',
    });
    expect(await deleteSite('nope', d)).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('delete passes the refusal on', async () => {
    const { deps: d } = deps({ data: null, error: { code: 'P0001', message: '', hint: 'site_has_history' } });
    expect(await deleteSite(SITE_ID, d)).toMatchObject({
      ok: false,
      message: expect.stringContaining('history'),
    });
    const ok = deps({ data: null, error: null });
    expect(await deleteSite(SITE_ID, ok.deps)).toEqual({ ok: true, siteId: SITE_ID });
  });
});

describe('saveMonitors', () => {
  it('sends edits, new key pages and removals; thresholds keep only an explicit slow value', async () => {
    const { rpc, deps: d } = deps({ data: null, error: null });
    const id = '00000000-0000-4000-8000-0000000000e1';
    const r = await saveMonitors(
      {
        siteId: SITE_ID,
        upserts: [
          { id, isPrimary: true, url: 'https://eqho.example.com/', mustContain: ['EQHO'], slowMs: 4000 },
          {
            isPrimary: false,
            url: 'https://eqho.example.com/courses',
            headers: [{ name: 'Accept-Language', value: 'th' }],
          },
        ],
        removals: ['00000000-0000-4000-8000-0000000000e2'],
      },
      d,
    );
    expect(r).toEqual({ ok: true, siteId: SITE_ID });
    expect(rpc).toHaveBeenCalledWith('save_monitors', {
      p_site_id: SITE_ID,
      p_upserts: [
        expect.objectContaining({ id, thresholds: { slowMs: 4000 } }),
        expect.objectContaining({ thresholds: {}, headers: [{ name: 'Accept-Language', value: 'th' }] }),
      ],
      p_removals: ['00000000-0000-4000-8000-0000000000e2'],
    });
  });

  it('refuses a private URL and a refused header name before saving', async () => {
    const { rpc, deps: d } = deps();
    expect(
      await saveMonitors({ siteId: SITE_ID, upserts: [{ isPrimary: true, url: 'http://10.0.0.5/' }] }, d),
    ).toMatchObject({
      ok: false,
      fieldErrors: { 'upserts.0.url': expect.stringContaining('private network') },
    });
    expect(
      await saveMonitors(
        {
          siteId: SITE_ID,
          upserts: [
            { isPrimary: true, url: 'https://a.example.com', headers: [{ name: 'Cookie', value: 'x' }] },
          ],
        },
        d,
      ),
    ).toMatchObject({ ok: false, fieldErrors: { 'upserts.0.headers.0.name': expect.any(String) } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a duplicate URL lands on the primary’s URL field', async () => {
    const { deps: d } = deps({ data: null, error: { code: '23505', message: 'monitors_primary_url_key' } });
    expect(
      await saveMonitors(
        { siteId: SITE_ID, upserts: [{ isPrimary: true, url: 'https://a.example.com' }] },
        d,
      ),
    ).toMatchObject({ ok: false, fieldErrors: { 'upserts.0.url': DUPLICATE_URL } });
  });
});
