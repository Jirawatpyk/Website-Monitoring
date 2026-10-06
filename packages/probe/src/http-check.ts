import { PROBE_USER_AGENT, type CheckOutcome } from '@dxt/shared';
import { classifyResponse } from './classify';
import { assertPublicTarget, TargetNotAllowedError, type Lookup } from './target';

export interface HttpCheckRequest {
  url: string;
  method?: 'GET' | 'HEAD';
  timeoutMs?: number;
  /**
   * Extra headers, e.g. the secret header a site's WAF allowlists (PRD §13). Sent only to the
   * monitor's own host (and an http → https upgrade of it) — never to a host a redirect points at,
   * and never downgraded to plain http.
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
    const bodySample = await readSample(res, BODY_SAMPLE_BYTES);
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
  const first = new URL(req.url);
  const signal = AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let url = first;
  let method = req.method ?? 'GET';
  for (let hop = 0; ; hop += 1) {
    if (!req.allowPrivateTargets) await assertPublicTarget(url, req.lookup, signal);
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      headers: { 'user-agent': PROBE_USER_AGENT, ...(sameSite(url, first) ? req.headers : {}) },
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

/** The monitor's own origin, or its http → https upgrade on the default ports; never a downgrade. */
export function sameSite(url: URL, first: URL): boolean {
  if (url.origin === first.origin) return true;
  return (
    url.hostname === first.hostname &&
    first.protocol === 'http:' &&
    url.protocol === 'https:' &&
    !first.port &&
    !url.port
  );
}

/** Reads at most `limit` bytes of the body as text, then stops the download. */
async function readSample(res: Response, limit: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  try {
    await reader.cancel();
  } catch {
    // The sample is already read; a failed cancel only leaves the rest undownloaded.
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes).slice(0, limit);
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
