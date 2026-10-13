import {
  findForbiddenPhrases,
  FORBIDDEN_PHRASES,
  MAX_FORBIDDEN_PHRASE_LENGTH,
  PROBE_USER_AGENT,
  type CheckOutcome,
  type WafVendor,
} from '@dxt/shared';
import { classifyResponse, wafSignature } from './classify';
import { Agent, fetch, type Response } from 'undici';
import {
  assertPublicUrl,
  defaultLookup,
  publicOnlyLookup,
  TargetNotAllowedError,
  type Lookup,
} from './target';

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
  /** Tests only, with `lookup`: a CA to trust, for a local https server. */
  tlsCa?: string;
  /** Text the page must contain / must not contain (PROBLEM · Keyword, D-022). Case-sensitive. */
  mustContain?: readonly string[];
  mustNotContain?: readonly string[];
  /**
   * The crawler's identity (D-041 / D-042): a fixed User-Agent and Referer from `CRAWLER_CLIENTS`,
   * sent on every redirect hop (cloaking often sits behind an apex → www hop). `headers` stay same-site.
   */
  client?: { userAgent: string; referer?: string };
  /**
   * The crawler's whole-body read (D-041): look for `mustNotContain` and the shared forbidden list in
   * everything up to KEYWORD_SCAN_BYTES, not only the sample — injected links sit at the end of <body>.
   */
  scanWholeBody?: boolean;
}

export interface HttpCheckResult {
  outcome: CheckOutcome;
  statusCode: number | null;
  responseMs: number | null;
  ttfbMs: number | null;
  error: string | null;
  bodySample: string;
  /** Where the redirects ended (PROBLEM · Redirect, D-022); null when nothing answered. */
  finalUrl: string | null;
  /**
   * Keywords checked on a passing GET with keywords set; null when not checked (HEAD, no keywords,
   * or a response that didn't pass — a challenge page or a 5xx says nothing about the content).
   */
  keywordMissing: string[] | null;
  keywordForbidden: string[] | null;
  /** A blocked response's header-level WAF signature (D-027); null otherwise. */
  waf: WafVendor | null;
  /** With `scanWholeBody`: the body was read to its end or to KEYWORD_SCAN_BYTES, not broken off. */
  scanComplete?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
/**
 * The body sample of a GET: classification, `must_not_contain` and the shared forbidden list look
 * here (D-022, D-041) — the error pages and spam those words catch are usually near the top.
 */
export const KEYWORD_BODY_BYTES = 262_144;
/**
 * How far a `must_contain` keyword is looked for (D-026; whole chunks, so a few KB more). The read
 * stops as soon as every keyword is found, so only a page whose brand sits deep (Wix inlines
 * ~200 KB+ of CSS before `<title>`) reads further than the sample.
 */
export const KEYWORD_SCAN_BYTES = 3_145_728;
/** What `check_results` and the Ingest schema take: a longer URL or list is cut, never refused. */
export const MAX_FINAL_URL = 2048;
export const MAX_KEYWORDS = 20;
export const MAX_KEYWORD_LENGTH = 200;
const capped = (words: string[]) => words.slice(0, MAX_KEYWORDS).map((w) => w.slice(0, MAX_KEYWORD_LENGTH));
export const MAX_REDIRECTS = 5;

/**
 * One HTTP(S) check. Shared by the Vercel probes (sin1 / hnd1) and the Bangkok VPS probe
 * so every location judges a response the same way.
 */
export async function runHttpCheck(req: HttpCheckRequest): Promise<HttpCheckResult> {
  const started = performance.now();
  const mustContain = req.mustContain ?? [];
  const mustNotContain = req.mustNotContain ?? [];
  // Every GET is keyword-checked: the shared forbidden list applies to every monitor (D-041).
  const keywords = (req.method ?? 'GET') === 'GET';
  const { agent, owned } = dispatcherFor(req);
  try {
    const { res, url } = await fetchFollowing(req, agent);
    const ttfbMs = Math.round(performance.now() - started);
    const { bodySample, missing, sampleAt, forbidden, complete } = await readBody(
      res,
      KEYWORD_BODY_BYTES,
      keywords ? mustContain : [],
      keywords && req.scanWholeBody ? mustNotContain : null,
    );
    const snapshot = { status: res.status, headers: res.headers, bodySample };
    const outcome = classifyResponse(snapshot);
    const checked = keywords && outcome === 'pass';
    return {
      outcome,
      statusCode: res.status,
      // The page's response time ends with the sample; a deeper keyword scan (D-026) isn't load time.
      responseMs: Math.round(sampleAt - started),
      ttfbMs,
      error: null,
      bodySample,
      finalUrl: url.href.slice(0, MAX_FINAL_URL),
      keywordMissing: checked && missing ? capped(missing) : null,
      keywordForbidden: checked ? capped(forbidden ?? forbiddenIn(bodySample, mustNotContain)) : null,
      waf: outcome === 'blocked' ? wafSignature(snapshot) : null,
      ...(req.scanWholeBody ? { scanComplete: complete } : {}),
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
      finalUrl: null,
      keywordMissing: null,
      keywordForbidden: null,
      waf: null,
    };
  } finally {
    if (owned) await agent.destroy().catch(() => {});
  }
}

// The SSRF guard runs inside the connection's DNS lookup (`publicOnlyLookup`, D-040), so a hop
// resolves once and connects to the address that passed. `fetch` and `Agent` come from the same undici
// so the dispatcher fits. The connect phase (DNS included) gets no timeout of its own — undici's 10 s
// default would cut a slow lookup short of the check's own timeout, which the request's signal enforces.
const agentFor = (lookup: Lookup, allowPrivate: boolean, ca?: string) =>
  new Agent({
    connect: { lookup: publicOnlyLookup(lookup, allowPrivate), timeout: 0, ...(ca ? { ca } : {}) },
  });

/** One pool each, shared by every check of the process; made on first use. */
const shared = new Map<boolean, Agent>();

/** The check's dispatcher; an injected `lookup` (tests) gets its own, closed when the check ends. */
function dispatcherFor(req: HttpCheckRequest): { agent: Agent; owned: boolean } {
  const allowPrivate = !!req.allowPrivateTargets;
  if (req.lookup) return { agent: agentFor(req.lookup, allowPrivate, req.tlsCa), owned: true };
  let agent = shared.get(allowPrivate);
  if (!agent) shared.set(allowPrivate, (agent = agentFor(defaultLookup, allowPrivate)));
  return { agent, owned: false };
}

/**
 * Follows redirects by hand (at most MAX_REDIRECTS): every hop passes the SSRF guard — scheme, port
 * and an IP-literal host here, the resolved addresses in the connection — and the extra headers go
 * only to the monitor's own origin.
 */
async function fetchFollowing(
  req: HttpCheckRequest,
  dispatcher: Agent,
): Promise<{ res: Response; url: URL }> {
  const first = new URL(req.url);
  const signal = AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let url = first;
  let method = req.method ?? 'GET';
  for (let hop = 0; ; hop += 1) {
    if (!req.allowPrivateTargets) assertPublicUrl(url);
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      headers: {
        'user-agent': req.client?.userAgent ?? PROBE_USER_AGENT,
        ...(req.client?.referer ? { referer: req.client.referer } : {}),
        ...(sameSite(url, first) ? req.headers : {}),
      },
      signal,
      dispatcher,
    });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || res.status === 304 || !location) return { res, url };
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

/** A site's own words (case-sensitive, D-022) then the shared list's entries (D-041), once each. */
function forbiddenIn(text: string, mustNotContain: readonly string[]): string[] {
  return [...new Set([...mustNotContain.filter((k) => text.includes(k)), ...findForbiddenPhrases(text)])];
}

/** The page's declared charset (a TIS-620 / windows-874 Thai page), else UTF-8. */
export function decoderFor(contentType: string | null) {
  const label = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType ?? '')?.[1];
  try {
    return new TextDecoder(label ?? 'utf-8');
  } catch {
    return new TextDecoder();
  }
}

/**
 * Reads the first `sampleLimit` bytes as the body sample. While a `mustContain` keyword is still
 * unseen it keeps reading — up to KEYWORD_SCAN_BYTES — and stops the download as soon as every one
 * is found. Returns the sample, when it was complete (`sampleAt`, for the response time), and the
 * keywords never seen — or null when the scan past the sample broke off (a stalled or failed tail):
 * the page already answered, so that is "not checked", never a hard fail.
 * With `scanForbidden` (the crawler, D-041) it reads on to KEYWORD_SCAN_BYTES whatever is pending and
 * returns every forbidden word seen in all of it (`forbidden`); otherwise `forbidden` is null.
 */
async function readBody(
  res: Response,
  sampleLimit: number,
  mustContain: readonly string[],
  scanForbidden: readonly string[] | null,
): Promise<{
  bodySample: string;
  missing: string[] | null;
  sampleAt: number;
  forbidden: string[] | null;
  complete: boolean;
}> {
  let pending = [...new Set(mustContain)];
  if (!res.body) {
    return {
      bodySample: '',
      missing: pending,
      sampleAt: performance.now(),
      forbidden: scanForbidden ? [] : null,
      complete: true,
    };
  }
  const reader = res.body.getReader();
  const decoder = decoderFor(res.headers.get('content-type'));
  // A keyword split across two chunks: keep the end of the text read so far.
  const overlap = Math.max(0, ...pending.map((k) => k.length)) - 1;
  // The forbidden scan's own window: twice the longest word, as a run of spaces may stand for one.
  const scanOverlap = scanForbidden
    ? 2 * Math.max(MAX_FORBIDDEN_PHRASE_LENGTH, ...scanForbidden.map((k) => k.length))
    : 0;
  const found = new Set<string>();
  let sample = '';
  let tail = '';
  let scanTail = '';
  let size = 0;
  let done = false;
  const take = (text: string) => {
    if (sample.length < sampleLimit) sample += text.slice(0, sampleLimit - sample.length);
    if (pending.length > 0) {
      const window = tail + text;
      pending = pending.filter((k) => !window.includes(k));
      tail = overlap > 0 ? window.slice(-overlap) : '';
    }
    if (scanForbidden) {
      const window = scanTail + text;
      for (const k of forbiddenIn(window, scanForbidden)) found.add(k);
      scanTail = window.slice(-scanOverlap);
    }
  };
  // The sample: a read error here is the page failing to load, as before.
  while (!done && size < sampleLimit) {
    const chunk = await reader.read();
    done = chunk.done;
    if (chunk.value) {
      size += chunk.value.byteLength;
      take(decoder.decode(chunk.value, { stream: true }));
    }
  }
  const sampleAt = performance.now();
  // Past the sample, only while a keyword is still unseen — or to the end for the crawler.
  let broke = false;
  try {
    while (!done && (pending.length > 0 || scanForbidden) && size < KEYWORD_SCAN_BYTES) {
      const chunk = await reader.read();
      done = chunk.done;
      if (chunk.value) {
        size += chunk.value.byteLength;
        take(decoder.decode(chunk.value, { stream: true }));
      }
    }
  } catch {
    broke = true;
  }
  if (done) take(decoder.decode());
  try {
    await reader.cancel();
  } catch {
    // Everything needed is read; a failed cancel only leaves the rest undownloaded.
  }
  const missing = broke && pending.length > 0 ? null : mustContain.filter((k) => pending.includes(k));
  // Own words first, then the list, as `forbiddenIn` orders a single window.
  const forbidden = scanForbidden
    ? [
        ...scanForbidden.filter((k) => found.has(k)),
        ...FORBIDDEN_PHRASES.filter((k) => found.has(k) && !scanForbidden.includes(k)),
      ]
    : null;
  // Complete = read to the end or to the 3 MB cap (the scan's scope), not broken off by a stalled or
  // dropped tail — a broken-off read has no say about the tail, where injected links sit.
  return { bodySample: sample, missing, sampleAt, forbidden, complete: !broke };
}

function describeError(err: unknown): string {
  if (err instanceof TargetNotAllowedError) return err.message;
  // A refusal inside the connection's lookup arrives as fetch's TypeError with it as the cause.
  const inner = (err as { cause?: unknown } | null)?.cause;
  if (inner instanceof TargetNotAllowedError) return inner.message;
  if (err instanceof DOMException && err.name === 'TimeoutError') return 'Timeout';
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string } }).cause;
    return cause?.code ?? err.message;
  }
  return String(err);
}
