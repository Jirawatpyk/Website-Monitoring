import { describe, expect, it } from 'vitest';
import { assertPublicTarget, isBlockedAddress } from './target';

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
  });
});
