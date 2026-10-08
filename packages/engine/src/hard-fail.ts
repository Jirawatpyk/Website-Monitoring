import { isTlsChainError, type CheckOutcome } from '@dxt/shared';

type Vote = { outcome: CheckOutcome; error?: string | null };

/**
 * D-029: the one place that decides whether a check is a hard-fail vote. A certificate-chain error
 * (`isTlsChainError`) is a PROBLEM, never part of a DOWN, of a regional failure or of a faulty
 * location — so every rule that counts failures calls this, never `outcome === 'fail'` (ESLint
 * refuses the raw comparison in packages/engine).
 */
export function isHardFail(c: Vote): boolean {
  // eslint-disable-next-line no-restricted-syntax -- the one raw comparison (D-029)
  return c.outcome === 'fail' && !isTlsChainError(c.error);
}

/** A failed check whose error is a certificate-chain error (D-029). */
export function isTlsChainFail(c: Vote): boolean {
  // eslint-disable-next-line no-restricted-syntax -- the one raw comparison (D-029)
  return c.outcome === 'fail' && isTlsChainError(c.error);
}
