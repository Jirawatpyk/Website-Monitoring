import { describe, expect, it } from 'vitest';
import { isTlsChainError, TLS_CHAIN_ERRORS } from './tls';

describe('isTlsChainError (D-029)', () => {
  it.each([
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', true],
    ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', true],
    ['UNABLE_TO_GET_ISSUER_CERT', true],
    ['CERT_HAS_EXPIRED', false],
    ['ERR_TLS_CERT_ALTNAME_INVALID', false],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', false],
    ['SELF_SIGNED_CERT_IN_CHAIN', false],
    ['CERT_NOT_YET_VALID', false],
    ['Timeout', false],
    [null, false],
    [undefined, false],
  ])('%s → %s', (code, expected) => {
    expect(isTlsChainError(code)).toBe(expected);
  });

  it('lists exactly the three chain codes', () => {
    expect(TLS_CHAIN_ERRORS).toHaveLength(3);
  });
});
