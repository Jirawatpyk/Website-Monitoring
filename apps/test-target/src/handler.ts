/**
 * The staging test target (S02a, S03): answers each probe according to `mode` in Edge Config, so a
 * DOWN / RECOVERED / blocked round can be triggered on demand without touching the app being tested.
 *   ok             → 200
 *   error          → 500
 *   timeout        → holds a probe past any monitor timeout, then 200
 *   challenge      → a probe gets a bot-protection challenge (403); a browser gets the page (S03 Done-when 2)
 *   challenge-down → a probe gets the challenge; a browser gets a 503 (blocked, then the page fails → DOWN)
 *   challenge-all  → everyone gets the challenge (blocked in the browser too → PROBLEM, D-020)
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
] as const;
export type TargetMode = (typeof TARGET_MODES)[number];

export const TIMEOUT_HOLD_MS = 45_000;

export function parseMode(value: unknown): TargetMode {
  return TARGET_MODES.find((m) => m === value) ?? 'ok';
}

export interface HandlerDeps {
  readMode: () => Promise<unknown>;
  /** The request's User-Agent: tells a probe from a browser. */
  userAgent?: string | null;
  sleep?: (ms: number) => Promise<void>;
}

/** What a Cloudflare managed challenge answers: 403, `cf-mitigated: challenge`, "Just a moment...". */
const CHALLENGE_PAGE =
  '<!doctype html><html lang="en"><head><title>Just a moment...</title></head>' +
  '<body><p>Checking your browser before accessing the test target.</p></body></html>\n';
const PAGE = (mode: TargetMode) =>
  `<!doctype html><html lang="en"><head><title>Test target</title></head><body><h1>Test target</h1><p>Mode: ${mode}</p></body></html>\n`;

export async function handle({
  readMode,
  userAgent = null,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}: HandlerDeps) {
  const mode = parseMode(await readMode());
  const probe = !!userAgent?.startsWith('DxT-Monitor/');
  const headers = { 'cache-control': 'no-store', 'x-target-mode': mode };
  const text = { ...headers, 'content-type': 'text/plain; charset=utf-8' };
  const html = { ...headers, 'content-type': 'text/html; charset=utf-8' };

  if (mode === 'error') return new Response('Test target: error mode\n', { status: 500, headers: text });
  if ((mode.startsWith('challenge') && probe) || mode === 'challenge-all') {
    return new Response(CHALLENGE_PAGE, { status: 403, headers: { ...html, 'cf-mitigated': 'challenge' } });
  }
  if (mode === 'challenge-down') return new Response('Service unavailable\n', { status: 503, headers: text });
  if (mode === 'timeout' && probe) await sleep(TIMEOUT_HOLD_MS);
  return new Response(PAGE(mode), { status: 200, headers: html });
}
