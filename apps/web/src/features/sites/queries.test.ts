// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fake-db';

const m = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => m.db }));

const { getRegistrationOptions, getSite, listSites } = await import('./queries');
const SITE = '00000000-0000-4000-8000-0000000000a1';

describe('listSites', () => {
  const live = {
    id: SITE,
    name: 'EQHO',
    tier: 2,
    is_active: true,
    muted_until: '2026-10-08T11:00:00Z',
    clients: { id: 'c1', name: 'Cando Asia', is_internal: false, am: { display_name: 'Bua' } },
    owner: { id: 'u1', display_name: 'Nok' },
    backup: { id: 'u2', display_name: 'Ploy' },
    site_status: [{ status: 'problem', last_round_at: '2026-10-08T00:03:00Z' }],
    monitors: [
      { url: 'https://eqho.example.com/contact', is_primary: false, thresholds: {} },
      { url: 'https://eqho.example.com/', is_primary: true, thresholds: { slowMs: 2000 } },
    ],
    incidents: [
      {
        id: 'i3',
        number: 3,
        state: 'acknowledged',
        escalation_level: 0,
        detected_at: '2026-10-08T00:01:00Z',
        acker: { display_name: 'Arm' },
      },
    ],
  };
  const draft = {
    id: 'draft',
    name: 'Draft',
    tier: 3,
    is_active: false,
    muted_until: null,
    clients: { id: 'c2', name: 'Internal', is_internal: true, am: null },
    owner: null,
    backup: null,
    site_status: { status: 'down', last_round_at: '2026-10-08T00:03:00Z' },
    monitors: [],
    incidents: [],
  };

  it('maps each site: client · AM, owner · backup, mute, open incident and the location glyphs', async () => {
    const fake = fakeDb({
      'sites.select': { data: [live, draft] },
      'rpc.site_list_locations': {
        data: [
          {
            site_id: SITE,
            location: 'SIN',
            outcome: 'pass',
            error: null,
            response_ms: 2500,
            checked_at: 'x',
          },
          {
            site_id: SITE,
            location: 'TYO',
            outcome: 'fail',
            error: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
            response_ms: 90,
            checked_at: 'x',
          },
          {
            site_id: 'draft',
            location: 'BKK',
            outcome: 'fail',
            error: null,
            response_ms: 90,
            checked_at: 'x',
          },
        ],
      },
    });
    m.db = fake.db;
    expect(await listSites()).toEqual([
      {
        id: SITE,
        name: 'EQHO',
        tier: 2,
        live: true,
        client: { id: 'c1', name: 'Cando Asia', internal: false, amName: 'Bua' },
        owner: { id: 'u1', name: 'Nok' },
        backup: { id: 'u2', name: 'Ploy' },
        status: 'problem',
        checkedAt: '2026-10-08T00:03:00Z',
        url: 'https://eqho.example.com/',
        mutedUntil: '2026-10-08T11:00:00Z',
        openIncident: {
          id: 'i3',
          number: 3,
          state: 'acknowledged',
          level: 0,
          detectedAt: '2026-10-08T00:01:00Z',
          ackedBy: 'Arm',
        },
        // the monitor's own slow limit (2 s); a chain error isn't a hard fail (D-029)
        locations: { BKK: 'none', SIN: 'slow', TYO: 'chain' },
        p50Ms: null,
        uptime30d: null,
        expiryDays: null,
      },
      {
        id: 'draft',
        name: 'Draft',
        tier: 3,
        live: false,
        client: { id: 'c2', name: 'Internal', internal: true, amName: null },
        owner: null,
        backup: null,
        status: null,
        checkedAt: null,
        url: null,
        mutedUntil: null,
        openIncident: null,
        locations: { BKK: 'none', SIN: 'none', TYO: 'none' },
        p50Ms: null,
        uptime30d: null,
        expiryDays: null,
      },
    ]);
    // only the open incident is embedded
    expect(fake.calls.find((c) => c.table === 'sites')?.filters).toContainEqual([
      'not',
      'incidents.state',
      'in',
      '("resolved","in_review","closed")',
    ]);
  });

  it('throws on a read error', async () => {
    m.db = fakeDb({ 'sites.select': { error: { message: 'boom' } } }).db;
    await expect(listSites()).rejects.toThrow('sites: boom');
    m.db = fakeDb({ 'rpc.site_list_locations': { error: { message: 'nope' } } }).db;
    await expect(listSites()).rejects.toThrow('site_list_locations: nope');
  });
});

describe('getRegistrationOptions', () => {
  it('clients with their AM, owner candidates with a Chat-id flag, existing primary URLs', async () => {
    const fake = fakeDb({
      'clients.select': {
        data: [{ id: 'c1', name: 'Cando Asia', is_internal: false, am: { display_name: 'Bua' } }],
      },
      'profiles.select': {
        data: [
          { id: 'u1', display_name: 'Nok', google_chat_user_id: '1001' },
          { id: 'u2', display_name: 'Arm', google_chat_user_id: ' ' },
        ],
      },
      'monitors.select': { data: [{ url: 'https://a.example.com/', site_id: SITE, sites: { name: 'A' } }] },
    });
    m.db = fake.db;
    expect(await getRegistrationOptions()).toEqual({
      clients: [{ id: 'c1', name: 'Cando Asia', internal: false, amName: 'Bua' }],
      people: [
        { id: 'u1', name: 'Nok', linked: true },
        { id: 'u2', name: 'Arm', linked: false },
      ],
      existingUrls: [{ url: 'https://a.example.com/', siteId: SITE, siteName: 'A' }],
    });
    expect(fake.calls.find((c) => c.table === 'profiles')?.filters).toEqual([
      ['eq', 'is_active', true],
      ['in', 'role', ['admin', 'responder']],
    ]);
  });

  it.each(['clients', 'profiles', 'monitors'])('throws when %s fails', async (table) => {
    m.db = fakeDb({ [`${table}.select`]: { error: { message: 'x' } } }).db;
    await expect(getRegistrationOptions()).rejects.toThrow(`${table}: x`);
  });
});

describe('getSite', () => {
  const row = {
    id: SITE,
    name: 'EQHO',
    tier: 1,
    client_id: 'c1',
    primary_owner_id: 'u1',
    backup_owner_id: null,
    hosting: null,
    credential_ref: 'Vault',
    behind_waf: true,
    waf_allowlist_confirmed: false,
    is_active: false,
    monitoring_started_at: null,
    owner: { display_name: 'Nok' },
    backup: null,
    monitors: [
      {
        id: 'k',
        is_primary: false,
        url: 'https://eqho.example.com/booking',
        method: 'HEAD',
        timeout_ms: 20000,
        must_contain: [],
        must_not_contain: [],
        allowed_redirect_domains: [],
        thresholds: {},
        headers: [{ name: 'Accept-Language', value: 'th' }, { bad: true }],
        enabled: false,
        removed_at: null,
      },
      {
        id: 'gone',
        is_primary: false,
        url: 'https://eqho.example.com/old',
        method: 'GET',
        timeout_ms: 30000,
        must_contain: [],
        must_not_contain: [],
        allowed_redirect_domains: [],
        thresholds: {},
        headers: [],
        enabled: false,
        removed_at: '2026-10-07T00:00:00Z',
      },
      {
        id: 'p',
        is_primary: true,
        url: 'https://eqho.example.com/',
        method: 'GET',
        timeout_ms: 30000,
        must_contain: ['EQHO'],
        must_not_contain: ['Index of /'],
        allowed_redirect_domains: ['cdn.example.com'],
        thresholds: { slowMs: 4000 },
        headers: 'not an array',
        enabled: true,
        removed_at: null,
      },
    ],
  };

  it('the site with its live monitors, primary first; removed ones left out', async () => {
    m.db = fakeDb({ 'sites.select': { data: row } }).db;
    const site = await getSite(SITE);
    expect(site).toMatchObject({
      id: SITE,
      tier: 1,
      hosting: '',
      credentialRef: 'Vault',
      ownerName: 'Nok',
      backupName: null,
      live: false,
      everStarted: false,
      behindWaf: true,
    });
    expect(site!.monitors.map((x) => [x.id, x.method, x.timeoutSec, x.slowMs, x.headers])).toEqual([
      ['p', 'GET', 30, 4000, []],
      ['k', 'HEAD', 20, null, [{ name: 'Accept-Language', value: 'th' }]],
    ]);
  });

  it('null for a malformed or unknown id; throws on a read error', async () => {
    expect(await getSite('nope')).toBeNull();
    m.db = fakeDb({ 'sites.select': { data: null } }).db;
    expect(await getSite(SITE)).toBeNull();
    m.db = fakeDb({ 'sites.select': { error: { message: 'x' } } }).db;
    await expect(getSite(SITE)).rejects.toThrow('site: x');
  });
});
