import {
  isHardFailCheck,
  isTimeoutError,
  isTlsChainError,
  type CheckOutcome,
  type ProbeLocation,
} from '@dxt/shared';

type Vote = { outcome: CheckOutcome; error?: string | null };

/**
 * D-029: the one place that decides whether a check is a hard-fail vote. A certificate-chain error
 * (`isTlsChainError`) is a PROBLEM, never part of a DOWN, of a regional failure or of a faulty
 * location — so every rule that counts failures calls this, never `outcome === 'fail'` (ESLint
 * refuses the raw comparison in packages/engine).
 */
export function isHardFail(c: Vote): boolean {
  return isHardFailCheck(c);
}

/**
 * Failing at this location, for the regional rule (spec §6): a hard fail, or a certificate-chain error
 * — one location's apps failing for 5 min is worth a PROBLEM (Regional), still never a DOWN (D-029).
 */
export function failsHere(c: Vote): boolean {
  return isHardFail(c) || isTlsChainFail(c);
}

type Timed = Vote & { location: ProbeLocation; checkedAt: Date; attempt?: 1 | 2; confirm?: boolean };

/**
 * D-049: is this confirmed hard fail a timeout alone, in its first round? Then it is not DOWN yet.
 * A timeout alone: every confirming recheck and its location's scheduled check this round timed out
 * (a 503 anywhere is stronger evidence and confirms at once). Its first round: the round just before
 * (`roundAt − interval`) didn't have the needed hard-failing locations (2, or 1 for a WAF round that
 * one location decided) on its scheduled checks — any locations, so a stall rotating between them
 * still counts. Read from the checks themselves, not the carried failing-since clock: a round the
 * engine skipped, or one with no data, must not pass for "the round before" (engine review H1).
 */
export function firstTimeoutRound<T extends Timed>(
  confirming: readonly Timed[],
  scheduled: readonly Timed[],
  history: readonly T[],
  roundAt: Date,
  intervalSec: number,
  /** Behind a WAF, a check that sits its round out (D-027) is no evidence for that round either. */
  sitsOut: (c: T) => boolean = () => false,
): boolean {
  if (!confirming.length || !confirming.every((c) => isTimeoutError(c.error))) return false;
  const here = new Set(confirming.map((c) => c.location));
  if (!scheduled.filter((c) => here.has(c.location)).every((c) => isTimeoutError(c.error))) return false;
  const from = roundAt.getTime() - intervalSec * 1000;
  const latest = new Map<ProbeLocation, T>();
  for (const c of history) {
    const t = c.checkedAt.getTime();
    // A D-051 confirm check isn't the round's own check: only scheduled checks speak for a round.
    if ((c.attempt ?? 1) !== 1 || c.confirm || t < from || t >= roundAt.getTime() || sitsOut(c)) continue;
    const prev = latest.get(c.location);
    if (!prev || prev.checkedAt < c.checkedAt) latest.set(c.location, c);
  }
  const failedBefore = [...latest.values()].filter(isHardFail).length;
  return failedBefore < Math.min(2, confirming.length);
}

/** A failed check whose error is a certificate-chain error (D-029). */
export function isTlsChainFail(c: Vote): boolean {
  // eslint-disable-next-line no-restricted-syntax -- the one raw comparison (D-029)
  return c.outcome === 'fail' && isTlsChainError(c.error);
}
