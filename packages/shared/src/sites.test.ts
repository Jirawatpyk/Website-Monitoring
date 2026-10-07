import { describe, expect, it } from 'vitest';
import {
  blockingItems,
  type ChecklistInput,
  defaultSlowMs,
  isRefusedHeader,
  itemsLeftText,
  keyPageUrl,
  monitorFormSchema,
  monitorHeadersSchema,
  monitorUrlKey,
  normalizeMonitorUrl,
  probeRequestHeaders,
  registrationChecklist,
  siteFormSchema,
} from './sites';

const ID = {
  nok: '00000000-0000-4000-8000-000000000001',
  ploy: '00000000-0000-4000-8000-000000000002',
  client: '00000000-0000-4000-8000-000000000003',
};

describe('normalizeMonitorUrl', () => {
  it.each([
    ['https://EQHO.example.com', 'https://eqho.example.com/'],
    [' https://eqho.example.com/courses#top ', 'https://eqho.example.com/courses'],
    ['http://eqho.example.com:8080/a?b=1', 'http://eqho.example.com:8080/a?b=1'],
  ])('%s → %s', (raw, url) => {
    expect(normalizeMonitorUrl(raw)).toBe(url);
  });

  it.each(['ftp://example.com/', 'javascript:alert(1)', 'https://user:pw@example.com/', 'example.com', ''])(
    'refuses %j',
    (raw) => {
      expect(() => normalizeMonitorUrl(raw)).toThrow();
    },
  );

  it('keys a duplicate the way the database index does (case, trailing slash)', () => {
    expect(monitorUrlKey('https://EQHO.example.com/')).toBe(monitorUrlKey('https://eqho.example.com'));
  });

  it('builds a key page on the primary URL’s origin', () => {
    expect(keyPageUrl('https://eqho.example.com/th/', '/contact')).toBe('https://eqho.example.com/contact');
  });
});

describe('custom headers (D-025)', () => {
  it.each(['User-Agent', 'host', 'Cookie', 'Authorization', 'x-dxt-monitor', 'Content-Length'])(
    'refuses %s',
    (name) => {
      expect(isRefusedHeader(name)).toBe(true);
      expect(monitorHeadersSchema.safeParse([{ name, value: 'x' }]).success).toBe(false);
    },
  );

  it('refuses a renamed probe secret header too', () => {
    expect(isRefusedHeader('X-Probe-Key', 'X-Probe-Key')).toBe(true);
  });

  it('takes ordinary headers, once each, one line, at most 10', () => {
    expect(
      monitorHeadersSchema.safeParse([{ name: 'Accept-Language', value: 'zh-TW,en;q=0.8' }]).success,
    ).toBe(true);
    expect(
      monitorHeadersSchema.safeParse([
        { name: 'Accept', value: 'a' },
        { name: 'accept', value: 'b' },
      ]).success,
    ).toBe(false);
    expect(monitorHeadersSchema.safeParse([{ name: 'X-A', value: 'a\r\nHost: evil' }]).success).toBe(false);
    expect(monitorHeadersSchema.safeParse([{ name: 'Bad Name', value: 'a' }]).success).toBe(false);
    expect(
      monitorHeadersSchema.safeParse(Array.from({ length: 11 }, (_, i) => ({ name: `X-${i}`, value: '1' })))
        .success,
    ).toBe(false);
  });
});

describe('siteFormSchema', () => {
  const base = { name: ' EQHO Academy ', clientId: ID.client, tier: '2' };

  it('trims, coerces the tier and leaves Draft owners empty', () => {
    const r = siteFormSchema.parse({ ...base, primaryOwnerId: '', backupOwnerId: null });
    expect(r).toMatchObject({ name: 'EQHO Academy', tier: 2, primaryOwnerId: null, backupOwnerId: null });
  });

  it('refuses the same person twice', () => {
    const r = siteFormSchema.safeParse({ ...base, primaryOwnerId: ID.nok, backupOwnerId: ID.nok });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({
      path: ['backupOwnerId'],
      message: 'Same as primary — pick another',
    });
  });

  it('refuses a tier outside 1–3', () => {
    expect(siteFormSchema.safeParse({ ...base, tier: 4 }).success).toBe(false);
  });
});

describe('monitorFormSchema', () => {
  it('normalises the URL and defaults to GET, 30 s, on', () => {
    expect(monitorFormSchema.parse({ isPrimary: true, url: 'HTTPS://A.example.com' })).toMatchObject({
      url: 'https://a.example.com/',
      method: 'GET',
      timeoutSec: 30,
      enabled: true,
    });
  });

  it('refuses HEAD with content checks (D-022)', () => {
    const r = monitorFormSchema.safeParse({
      isPrimary: true,
      url: 'https://a.example.com',
      method: 'HEAD',
      mustContain: ['A'],
    });
    expect(r.error?.issues[0]?.path).toEqual(['method']);
  });

  it('keeps the primary on', () => {
    expect(
      monitorFormSchema.safeParse({ isPrimary: true, url: 'https://a.example.com', enabled: false }).success,
    ).toBe(false);
    expect(
      monitorFormSchema.safeParse({ isPrimary: false, url: 'https://a.example.com/x', enabled: false })
        .success,
    ).toBe(true);
  });

  it('refuses a 61 s timeout and a bad redirect host', () => {
    expect(
      monitorFormSchema.safeParse({ isPrimary: true, url: 'https://a.example.com', timeoutSec: 61 }).success,
    ).toBe(false);
    expect(
      monitorFormSchema.safeParse({
        isPrimary: true,
        url: 'https://a.example.com',
        allowedRedirectDomains: ['not a host'],
      }).success,
    ).toBe(false);
  });

  it('slow threshold defaults from the tier', () => {
    expect([defaultSlowMs(1), defaultSlowMs(2), defaultSlowMs(3)]).toEqual([3000, 5000, 5000]);
  });
});

describe('registrationChecklist (AddSite)', () => {
  // The board's default state: internal site, Nok + Ploy, hosting filled, no credential reference.
  const board: ChecklistInput = {
    url: 'https://eqho.example.com',
    duplicate: false,
    keyPages: ['/contact'],
    keyword: 'EQHO Academy',
    tier: 2,
    primary: { id: ID.nok, name: 'Nok', linked: true },
    backup: { id: ID.ploy, name: 'Ploy', linked: true },
    client: { name: 'Internal (DxT group)', internal: true, amName: null },
    hosting: 'Example hosting',
    credentialRef: '',
    behindWaf: false,
    allowlistConfirmed: false,
  };

  it('matches the board: 7 of 8 done, one item left', () => {
    const items = registrationChecklist(board);
    expect(items).toHaveLength(8);
    expect(items.filter((i) => i.state === 'done')).toHaveLength(7);
    expect(itemsLeftText(items)).toBe('1 item left: Credential reference');
    expect(items.map((i) => i.detail)).toEqual([
      '/ and /contact',
      '“EQHO Academy” must appear on the page',
      'Tier 2 · every 3 min · Mon–Fri 09:00–18:00',
      'Nok · Google Chat linked',
      'Ploy · linked channel ready',
      'Internal site · no client updates',
      'Add the credential reference',
      'Not behind a WAF',
    ]);
  });

  it('is ready when everything required is in; a pending allowlist never blocks', () => {
    const items = registrationChecklist({ ...board, credentialRef: 'Vault › EQHO', behindWaf: true });
    expect(blockingItems(items)).toEqual([]);
    expect(items.at(-1)).toMatchObject({
      state: 'todo',
      detail: 'Allowlist pending — can go live, verifier covers it',
    });
  });

  it('a client site adds the AM item; no AM on the client blocks', () => {
    const client = { name: 'Cando Asia', internal: false, amName: null };
    const items = registrationChecklist({ ...board, credentialRef: 'x', client });
    expect(items).toHaveLength(9);
    expect(items.find((i) => i.key === 'client')?.detail).toBe('Cando Asia · client-update track on');
    expect(itemsLeftText(items)).toBe('1 item left: Account manager');
    const withAm = registrationChecklist({
      ...board,
      credentialRef: 'x',
      client: { ...client, amName: 'Thee' },
    });
    expect(withAm.find((i) => i.key === 'am')?.detail).toBe('Thee gets client-update drafts');
  });

  it('blocks a duplicate URL, the same owner twice and an owner without a Chat id (D-015)', () => {
    const items = registrationChecklist({
      ...board,
      duplicate: true,
      backup: { id: ID.nok, name: 'Nok', linked: true },
    });
    expect(items.find((i) => i.key === 'url')).toMatchObject({
      state: 'blocked',
      detail: 'This URL is already monitored',
    });
    expect(items.find((i) => i.key === 'backup')).toMatchObject({
      state: 'blocked',
      detail: 'Same as primary (Nok) — pick someone else',
    });
    const unlinked = registrationChecklist({ ...board, primary: { id: ID.nok, name: 'Nok', linked: false } });
    expect(unlinked.find((i) => i.key === 'primary')).toMatchObject({
      state: 'blocked',
      detail: 'Nok has no Google Chat id — ask an Admin to add it',
    });
  });

  it('an empty Draft lists what is missing in the board’s words', () => {
    const items = registrationChecklist({
      ...board,
      url: '',
      keyPages: [],
      keyword: ' ',
      primary: null,
      backup: null,
      client: null,
      hosting: '',
      credentialRef: '',
    });
    expect(itemsLeftText(items)).toBe(
      '6 items left: URL, Brand keyword, Primary owner, Backup owner, Client, Credential reference',
    );
    expect(items.find((i) => i.key === 'hosting')?.detail).toBe(
      'Add hosting provider and credential reference',
    );
    const hostMissing = registrationChecklist({ ...board, hosting: '', credentialRef: 'x' });
    expect(hostMissing.find((i) => i.key === 'hosting')?.detail).toBe('Add the hosting provider');
  });
});

describe('probeRequestHeaders', () => {
  it('sends custom headers, drops refused ones and puts the secret header last', () => {
    expect(
      probeRequestHeaders(
        [
          { name: 'Accept-Language', value: 'th' },
          { name: 'User-Agent', value: 'spoof' },
          { name: 'X-Probe-Key', value: 'guess' },
        ],
        { name: 'X-Probe-Key', value: 's3cret' },
      ),
    ).toEqual({ 'Accept-Language': 'th', 'X-Probe-Key': 's3cret' });
  });

  it('is undefined with nothing to send', () => {
    expect(probeRequestHeaders([], undefined)).toBeUndefined();
    expect(probeRequestHeaders(undefined)).toBeUndefined();
  });
});
