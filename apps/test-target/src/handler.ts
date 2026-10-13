/**
 * The staging test target (S02a, S03): answers each probe according to `mode` in Edge Config, so a
 * DOWN / RECOVERED / blocked round can be triggered on demand without touching the app being tested.
 *   ok             → 200
 *   error          → 500
 *   timeout        → holds a probe past any monitor timeout, then 200
 *   challenge      → a probe gets a bot-protection challenge (403); a browser gets the page (S03 Done-when 2)
 *   challenge-down → a probe gets the challenge; a browser gets a 503 (blocked, then the page fails → DOWN)
 *   challenge-all  → everyone gets the challenge (blocked in the browser too → PROBLEM, D-020)
 *   keyword-missing → 200 without "Test target" anywhere on the page (PROBLEM · Keyword, S04a)
 *   slow           → a probe waits 6 s, over both tier limits and under the monitor timeout (PROBLEM · Slow)
 *   waf-partial    → a WAF blocks every request from outside Thailand (403 + cf-mitigated); Thailand gets the
 *                    page — SIN / TYO blocked, the Bangkok VPS passes (S05b, D-027: OK with the note)
 *   waf-partial-down → the same block abroad, and a 503 in Thailand (D-027: DOWN on the Bangkok probe alone)
 *   waf-partial-slow → the same block abroad, and a probe in Thailand waits 6 s (D-039: slow on BKK alone)
 *   defaced        → everyone gets the page with gambling links (S09c: PROBLEM · Keyword from the probes)
 *   cloaked-ua     → only a Googlebot User-Agent gets the gambling links (S09c: "(as Googlebot)")
 *   cloaked-referer → a browser arriving from Google search is sent to another site (S09c: PROBLEM ·
 *                    Redirect "(from Google search)"); a probe and Googlebot get the page
 *   deep-spam      → everyone gets a page with the gambling links after 300 KB, past the probes' 256 KB
 *                    sample (S09c: only the crawler's whole-body read sees them)
 * Anything else (store missing, unknown value) counts as ok. Only a probe (User-Agent `DxT-Monitor/`)
 * is held or challenged differently, so nobody else can tie up the function.
 */
export const TARGET_MODES = [
  'ok',
  'error',
  'timeout',
  'challenge',
  'challenge-down',
  'challenge-all',
  'keyword-missing',
  'slow',
  'waf-partial',
  'waf-partial-down',
  'waf-partial-slow',
  'defaced',
  'cloaked-ua',
  'cloaked-referer',
  'deep-spam',
] as const;
export type TargetMode = (typeof TARGET_MODES)[number];

export const TIMEOUT_HOLD_MS = 45_000;
/** Over the slow limits (Tier 1 3 s, Tier 2–3 5 s) and under the 10 s default monitor timeout. */
export const SLOW_HOLD_MS = 6_000;
/** Where `cloaked-referer` sends a visitor from Google search: outside the staging monitor's allowlist. */
export const CLOAKED_REDIRECT = 'https://example.com/';
/** Padding before `deep-spam`'s links: past the probes' 256 KB sample, under the crawler's 3 MB. */
export const DEEP_SPAM_OFFSET = 300_000;
/** Phrases from the shared forbidden list (`@dxt/shared` forbidden.ts), as a hacked page carries them. */
export const SPAM = '<p><a href="#">สล็อตออนไลน์</a> <a href="#">บาคาร่า</a></p>';

export function parseMode(value: unknown): TargetMode {
  return TARGET_MODES.find((m) => m === value) ?? 'ok';
}

export interface HandlerDeps {
  readMode: () => Promise<unknown>;
  /** The request's User-Agent: tells a probe from a browser. */
  userAgent?: string | null;
  /** Vercel's `x-vercel-ip-country` of the caller: where a WAF-partial block applies (S05b). */
  country?: string | null;
  /** The request's Referer: a visitor arriving from Google search (S09c `cloaked-referer`). */
  referer?: string | null;
  sleep?: (ms: number) => Promise<void>;
}

/** What a Cloudflare managed challenge answers: 403, `cf-mitigated: challenge`, "Just a moment...". */
const CHALLENGE_PAGE =
  '<!doctype html><html lang="en"><head><title>Just a moment...</title></head>' +
  '<body><p>Checking your browser before accessing the test target.</p></body></html>\n';
/** A broken deploy: answers 200, but the brand keyword the monitor looks for is gone. */
const BROKEN_PAGE =
  '<!doctype html><html lang="en"><head><title>Index of /</title></head><body><h1>Index of /</h1></body></html>\n';
const PAGE = (mode: TargetMode, extra = '') =>
  `<!doctype html><html lang="en"><head><title>Test target</title></head><body><h1>Test target</h1><p>Mode: ${mode}</p>${extra}</body></html>\n`;

export async function handle({
  readMode,
  userAgent = null,
  country = null,
  referer = null,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}: HandlerDeps) {
  const mode = parseMode(await readMode());
  const probe = !!userAgent?.startsWith('DxT-Monitor/');
  const googlebot = !!userAgent?.includes('Googlebot');
  const fromGoogle = !!referer?.startsWith('https://www.google.');
  const headers = { 'cache-control': 'no-store', 'x-target-mode': mode };
  const text = { ...headers, 'content-type': 'text/plain; charset=utf-8' };
  const html = { ...headers, 'content-type': 'text/html; charset=utf-8' };

  if (mode === 'error') return new Response('Test target: error mode\n', { status: 500, headers: text });
  if (mode.startsWith('waf-partial') && country !== 'TH') {
    return new Response(CHALLENGE_PAGE, { status: 403, headers: { ...html, 'cf-mitigated': 'challenge' } });
  }
  if (mode === 'waf-partial-down')
    return new Response('Service unavailable\n', { status: 503, headers: text });
  if ((mode.startsWith('challenge') && probe) || mode === 'challenge-all') {
    return new Response(CHALLENGE_PAGE, { status: 403, headers: { ...html, 'cf-mitigated': 'challenge' } });
  }
  if (mode === 'challenge-down') return new Response('Service unavailable\n', { status: 503, headers: text });
  if (mode === 'timeout' && probe) await sleep(TIMEOUT_HOLD_MS);
  if ((mode === 'slow' || mode === 'waf-partial-slow') && probe) await sleep(SLOW_HOLD_MS);
  if (mode === 'keyword-missing') return new Response(BROKEN_PAGE, { status: 200, headers: html });
  if (mode === 'defaced' || (mode === 'cloaked-ua' && googlebot)) {
    return new Response(PAGE(mode, SPAM), { status: 200, headers: html });
  }
  if (mode === 'cloaked-referer' && fromGoogle && !probe && !googlebot) {
    return new Response(null, { status: 302, headers: { ...headers, location: CLOAKED_REDIRECT } });
  }
  if (mode === 'deep-spam') {
    return new Response(PAGE(mode, `<!-- ${'x'.repeat(DEEP_SPAM_OFFSET)} -->${SPAM}`), {
      status: 200,
      headers: html,
    });
  }
  return new Response(PAGE(mode), { status: 200, headers: html });
}
