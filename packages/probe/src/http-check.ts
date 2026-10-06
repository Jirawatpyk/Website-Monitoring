import { PROBE_USER_AGENT, type CheckOutcome } from '@dxt/shared';
import { classifyResponse } from './classify';
import { assertPublicTarget, TargetNotAllowedError, type Lookup } from './target';

export interface HttpCheckRequest {
  url: string;
  method?: 'GET' | 'HEAD';
  timeoutMs?: number;
  /**
   * Extra headers, e.g. the secret header a site's WAF allowlists (PRD §13). Sent only to the
   * monitor's own origin — never to a host a redirect points at.
   */
  headers?: Record<string, string>;
  /** Local development and tests only: allow loopback / private targets. Never in a deployed probe. */
  allowPrivateTargets?: boolean;
  /** DNS lookup for the SSRF guard (tests). */
  lookup?: Lookup;
}

export interface HttpCheckResult {
  outcome: CheckOutcome;
  statusCode: number | null;
  responseMs: number | null;
  ttfbMs: number | null;
  error: string | null;
  bodySample: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const BODY_SAMPLE_BYTES = 16_384;
export const MAX_REDIRECTS = 5;

/**
 * One HTTP(S) check. Shared by the Vercel probes (sin1 / hnd1) and the Bangkok VPS probe
 * so every location judges a response the same way.
 */
export async function runHttpCheck(req: HttpCheckRequest): Promise<HttpCheckResult> {
  const started = performance.now();
  try {
    const res = await fetchFollowing(req);
    const ttfbMs = Math.round(performance.now() - started);
    const bodySample = (await res.text()).slice(0, BODY_SAMPLE_BYTES);
    return {
      outcome: classifyResponse({ status: res.status, headers: res.headers, bodySample }),
      statusCode: res.status,
      responseMs: Math.round(performance.now() - started),
      ttfbMs,
      error: null,
      bodySample,
    };
  } catch (err) {
    // DNS, TLS, refused connection and timeout all land here: a hard fail.
    return {
      outcome: 'fail',
      statusCode: null,
      responseMs: null,
      ttfbMs: null,
      error: describeError(err),
      bodySample: '',
    };
  }
}

/**
 * Follows redirects by hand (at most MAX_REDIRECTS): every hop passes the SSRF guard, and the extra
 * headers go only to the monitor's own origin.
 */
async function fetchFollowing(req: HttpCheckRequest): Promise<Response> {
  const origin = new URL(req.url).origin;
  const signal = AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let url = new URL(req.url);
  let method = req.method ?? 'GET';
  for (let hop = 0; ; hop += 1) {
    if (!req.allowPrivateTargets) await assertPublicTarget(url, req.lookup);
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      headers: { 'user-agent': PROBE_USER_AGENT, ...(url.origin === origin ? req.headers : {}) },
      signal,
    });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || res.status === 304 || !location) return res;
    if (hop >= MAX_REDIRECTS) throw new Error('Too many redirects');
    await res.body?.cancel();
    url = new URL(location, url);
    if (res.status === 303) method = 'GET';
  }
}

function describeError(err: unknown): string {
  if (err instanceof TargetNotAllowedError) return err.message;
  if (err instanceof DOMException && err.name === 'TimeoutError') return 'Timeout';
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string } }).cause;
    return cause?.code ?? err.message;
  }
  return String(err);
}
