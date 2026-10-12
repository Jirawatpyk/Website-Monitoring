import { describe, expect, it } from 'vitest';
import {
  assertPublicTarget,
  assertPublicUrl,
  isBlockedAddress,
  publicOnlyLookup,
  TargetNotAllowedError,
  type Lookup,
} from './target';

describe('publicOnlyLookup (the connection resolves once and checks, D-040)', () => {
  const ask = (lookup: Lookup, all: boolean, allowPrivate = false) =>
    new Promise<{ err: Error | null; address: unknown; family?: number }>((resolve) =>
      publicOnlyLookup(lookup, allowPrivate)('host.example.test', { all }, (err, address, family) =>
        resolve({ err, address, family }),
      ),
    );
  const v4 = async () => [{ address: '93.184.216.34' }, { address: '2606:2800:220:1::' }];

  it('answers one address, or all of them, with their families', async () => {
    expect(await ask(v4, false)).toEqual({ err: null, address: '93.184.216.34', family: 4 });
    expect((await ask(v4, true)).address).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::', family: 6 },
    ]);
  });

  it.each([
    [
      'a private address among public ones',
      async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }],
    ],
    ['no address', async () => []],
    ['something that is not an address', async () => [{ address: 'not-an-ip' }]],
  ])('refuses %s', async (_, lookup) => {
    expect((await ask(lookup, false)).err).toBeInstanceOf(TargetNotAllowedError);
  });

  it('answers in the family asked for, after checking every address', async () => {
    const answer = (family: number | string, all = false) =>
      new Promise<{ address: unknown; family?: number; err: Error | null }>((resolve) =>
        publicOnlyLookup(async () => [{ address: '2606:2800:220:1::' }, { address: '93.184.216.34' }])(
          'host.example.test',
          { all, family },
          (err, address, fam) => resolve({ err, address, family: fam }),
        ),
      );
    expect(await answer(4)).toMatchObject({ address: '93.184.216.34', family: 4 });
    expect(await answer('IPv6')).toMatchObject({ address: '2606:2800:220:1::', family: 6 });
    expect((await answer(4, true)).address).toEqual([{ address: '93.184.216.34', family: 4 }]);
    const none = await new Promise<Error | null>((resolve) =>
      publicOnlyLookup(async () => [{ address: '93.184.216.34' }])('v4only.test', { family: 6 }, (err) =>
        resolve(err),
      ),
    );
    expect(none).toMatchObject({ code: 'ENOTFOUND' });
  });

  it('lets a private address through only when allowed (local development), and passes DNS errors on', async () => {
    expect((await ask(async () => [{ address: '127.0.0.1' }], false, true)).address).toBe('127.0.0.1');
    const failed = await ask(
      () => Promise.reject(Object.assign(new Error('nx'), { code: 'ENOTFOUND' })),
      false,
    );
    expect(failed.err).toMatchObject({ code: 'ENOTFOUND' });
  });
});

describe('assertPublicUrl (no DNS)', () => {
  it('returns the host to resolve, or null for a public IP literal; refuses the rest', () => {
    expect(assertPublicUrl(new URL('https://example.test/'))).toBe('example.test');
    expect(assertPublicUrl(new URL('https://93.184.216.34/'))).toBeNull();
    expect(() => assertPublicUrl(new URL('http://[::1]/'))).toThrow('private or reserved address');
    expect(() => assertPublicUrl(new URL('ftp://example.test/'))).toThrow('scheme');
  });
});

describe('isBlockedAddress (SSRF guard)', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.20.0.1', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['224.0.0.1', true],
    ['::1', true],
    ['::7f00:1', true], // IPv4-compatible 127.0.0.1
    ['2002:7f00:1::', true], // 6to4 of 127.0.0.1
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:10.0.0.1', true],
    ['not-an-ip', true],
    ['93.184.216.34', false],
    ['8.8.8.8', false],
    ['2606:4700:4700::1111', false],
    ['::ffff:8.8.8.8', false],
  ])('%s → %s', (address, expected) => {
    expect(isBlockedAddress(address)).toBe(expected);
  });
});

describe('assertPublicTarget', () => {
  const publicDns = async () => [{ address: '93.184.216.34' }];

  it('allows a public host on the standard ports', async () => {
    await expect(assertPublicTarget(new URL('https://example.test/'), publicDns)).resolves.toBeUndefined();
    await expect(assertPublicTarget(new URL('http://example.test:80/'), publicDns)).resolves.toBeUndefined();
  });

  it('refuses other schemes and ports', async () => {
    await expect(assertPublicTarget(new URL('ftp://example.test/'), publicDns)).rejects.toThrow('scheme');
    await expect(assertPublicTarget(new URL('http://example.test:8080/'), publicDns)).rejects.toThrow('port');
  });

  it('refuses a host when any of its addresses is private', async () => {
    const mixed = async () => [{ address: '93.184.216.34' }, { address: '10.0.0.1' }];
    await expect(assertPublicTarget(new URL('https://example.test/'), mixed)).rejects.toThrow('private');
    await expect(assertPublicTarget(new URL('https://example.test/'), async () => [])).rejects.toThrow(
      'private',
    );
    await expect(assertPublicTarget(new URL('http://[::1]/'))).rejects.toThrow('private');
    // The real resolver: localhost is loopback.
    await expect(assertPublicTarget(new URL('http://localhost/'))).rejects.toThrow('private');
  });

  it('passes DNS errors through and stops at the deadline', async () => {
    const signal = new AbortController().signal;
    const failing = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    };
    await expect(assertPublicTarget(new URL('https://example.test/'), failing, signal)).rejects.toThrow(
      'ENOTFOUND',
    );
    const aborted = AbortSignal.abort(new Error('deadline'));
    await expect(assertPublicTarget(new URL('https://example.test/'), publicDns, aborted)).rejects.toThrow(
      'deadline',
    );
    await expect(
      assertPublicTarget(new URL('https://example.test/'), publicDns, signal),
    ).resolves.toBeUndefined();
  });
});
