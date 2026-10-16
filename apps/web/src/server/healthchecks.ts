import 'server-only';

const ATTEMPTS = 2;
const TIMEOUT_MS = 5_000;

/**
 * Dead man's switch (PRD §9): every cron job pings its Healthchecks.io check when it finishes —
 * `/fail` when it couldn't do its job. A missing URL (local, preview) skips the ping. Never throws,
 * and never logs the URL (it identifies the check).
 *
 * A failed ping is tried once more, and only then logged with why: on 16 Oct 2026 a ~6-min network
 * blip from sin1 posted "engine is DOWN" while every run was fine, and the log couldn't say what failed.
 */
export async function pingHealthcheck(
  url: string | undefined,
  result: 'ok' | 'fail',
  fetchImpl: typeof fetch = fetch,
  pauseMs = 1_000,
): Promise<void> {
  if (!url) return;
  const target = result === 'ok' ? url : `${url.replace(/\/$/, '')}/fail`;
  let reason = 'unknown';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(target, { method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) return;
      reason = `http_${res.status}`;
    } catch (err) {
      reason = failureReason(err);
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, pauseMs));
  }
  console.warn(JSON.stringify({ event: 'healthcheck_ping_failed', result, attempts: ATTEMPTS, reason }));
}

/** "timeout", or the network error's code ("ECONNRESET", "ENOTFOUND") — never its message (it may hold the URL). */
function failureReason(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timeout';
    const code = (err.cause as { code?: unknown } | undefined)?.code;
    if (typeof code === 'string') return code;
    return err.name;
  }
  return 'unknown';
}
