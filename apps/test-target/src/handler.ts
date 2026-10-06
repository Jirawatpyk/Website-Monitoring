/**
 * The staging test target (S02a): answers each probe according to `mode` in Edge Config, so a
 * DOWN / RECOVERED can be triggered on demand without touching the app being tested.
 *   ok      → 200
 *   error   → 500
 *   timeout → holds the request past any monitor timeout, then 200
 * Anything else (store missing, unknown value) counts as ok.
 */
export type TargetMode = 'ok' | 'error' | 'timeout';

export const TIMEOUT_HOLD_MS = 45_000;

export function parseMode(value: unknown): TargetMode {
  return value === 'error' || value === 'timeout' ? value : 'ok';
}

export interface HandlerDeps {
  readMode: () => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
}

export async function handle({
  readMode,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}: HandlerDeps) {
  const mode = parseMode(await readMode());
  const headers = {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    'x-target-mode': mode,
  };
  if (mode === 'error') return new Response('Test target: error mode\n', { status: 500, headers });
  if (mode === 'timeout') await sleep(TIMEOUT_HOLD_MS);
  return new Response(`Test target: ${mode}\n`, { status: 200, headers });
}
