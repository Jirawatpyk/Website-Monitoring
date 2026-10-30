/**
 * D-029: certificate-chain errors — the server sends the wrong or no intermediate. Node (the probes,
 * apps and API clients) refuses the connection, while most browsers still open the site because they
 * fetch the missing intermediate themselves. A PROBLEM for the site owner, never a DOWN. Every other
 * TLS failure (expired, wrong host, self-signed, not yet valid) stays a hard fail.
 * The codes are what undici puts in `error.cause.code`, stored as `check_results.error`.
 */
export const TLS_CHAIN_ERRORS = [
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
] as const;

export function isTlsChainError(error: string | null | undefined): boolean {
  return !!error && (TLS_CHAIN_ERRORS as readonly string[]).includes(error);
}

/**
 * The probe gave up waiting (`describeError` in @dxt/probe writes `'Timeout'` for an AbortSignal
 * timeout). A timeout alone needs two failing rounds before DOWN (D-049): on these sites it was a
 * server stalling for a minute far more often than a site down.
 */
export function isTimeoutError(error: string | null | undefined): boolean {
  return error === 'Timeout';
}

/**
 * D-029: is this check a hard-fail vote? A failure that isn't a certificate-chain error. The engine's
 * `isHardFail` and the probes' recheck decision both use it — the one rule.
 */
export function isHardFailCheck(c: { outcome: string; error?: string | null }): boolean {
  return c.outcome === 'fail' && !isTlsChainError(c.error);
}
