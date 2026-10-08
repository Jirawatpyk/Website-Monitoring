import type { CheckOutcome, WafVendor } from '@dxt/shared';

/**
 * Turn one HTTP response into pass / fail / blocked (PRD §5).
 * - fail    = DNS error, connect/response timeout > 30 s, HTTP 5xx, TLS failure or expired cert.
 * - blocked = 403 / 429 / 503 carrying a WAF or challenge signature. Inconclusive, never a failure:
 *             the browser verifier decides.
 * Keyword and slow checks raise PROBLEM elsewhere; they never make a check fail here.
 */
export interface ResponseSnapshot {
  status: number;
  headers: Headers;
  /** First few KB of the body, enough to spot a challenge page. */
  bodySample: string;
}

/** Statuses a WAF / challenge page answers with (the browser verifier waits on these too). */
export const CHALLENGE_STATUSES: ReadonlySet<number> = new Set([403, 429, 503]);

/**
 * Headers only a challenge / block response carries. Never match on `server: cloudflare` alone: every
 * response through the proxy has it, including a real 503 from the origin — that must stay a hard fail.
 */
const CHALLENGE_HEADERS: readonly [header: string, match?: RegExp][] = [
  ['cf-mitigated'],
  ['cf-chl-bypass'],
  ['x-sucuri-block'],
];

/** Signatures to refine in Phase 0 against Tubtong and Cando Asia (PRD §5). */
const CHALLENGE_BODY =
  /(cf-challenge|challenge-platform|captcha|attention required|just a moment|access denied)/i;

export function hasChallengeSignature(res: ResponseSnapshot): boolean {
  for (const [name, match] of CHALLENGE_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null && (!match || match.test(value))) return true;
  }
  return CHALLENGE_BODY.test(res.bodySample);
}

/**
 * Akamai's own block page: "Access Denied" and a "Reference #…" (the `#` often HTML-encoded), both.
 * "Reference #" alone is also on Akamai's origin-error page (a 5xx: an outage); "Access denied" alone
 * can be the origin's own page.
 */
const AKAMAI_DENIED = /access denied/i;
const AKAMAI_REFERENCE = /reference(?:\s|&#32;)*(?:#|&#35;)/i;

/**
 * The header-level WAF signature of a challenge response (D-027), or null. Only these let a location
 * abstain on a site behind a WAF; a body-only match is never enough (an origin page saying "captcha"
 * must not hide an outage). Akamai needs its server header and its block page together.
 */
export function wafSignature(res: ResponseSnapshot): WafVendor | null {
  if (!CHALLENGE_STATUSES.has(res.status)) return null;
  if (res.headers.get('cf-mitigated') !== null) return 'cloudflare';
  if (res.headers.get('x-sucuri-block') !== null) return 'sucuri';
  if (
    res.status === 403 &&
    /akamaighost/i.test(res.headers.get('server') ?? '') &&
    AKAMAI_DENIED.test(res.bodySample) &&
    AKAMAI_REFERENCE.test(res.bodySample)
  ) {
    return 'akamai';
  }
  return null;
}

export function classifyResponse(res: ResponseSnapshot): CheckOutcome {
  if (CHALLENGE_STATUSES.has(res.status) && (hasChallengeSignature(res) || wafSignature(res)))
    return 'blocked';
  if (res.status >= 500) return 'fail';
  return 'pass';
}
