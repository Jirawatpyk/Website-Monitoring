import { PROBE_USER_AGENT, type CheckOutcome } from '@dxt/shared';
import { classifyResponse } from './classify';

export interface HttpCheckRequest {
  url: string;
  method?: 'GET' | 'HEAD';
  timeoutMs?: number;
  /** Extra headers, e.g. the secret header a site's WAF allowlists (PRD §13). */
  headers?: Record<string, string>;
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

/**
 * One HTTP(S) check. Shared by the Vercel probes (sin1 / hnd1) and the Bangkok VPS probe
 * so every location judges a response the same way.
 */
export async function runHttpCheck(req: HttpCheckRequest): Promise<HttpCheckResult> {
  const started = performance.now();
  try {
    const res = await fetch(req.url, {
      method: req.method ?? 'GET',
      redirect: 'follow',
      headers: { 'user-agent': PROBE_USER_AGENT, ...req.headers },
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
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

function describeError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'TimeoutError') return 'Timeout';
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string } }).cause;
    return cause?.code ?? err.message;
  }
  return String(err);
}
