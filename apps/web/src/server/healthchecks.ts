import 'server-only';

/**
 * Dead man's switch (PRD §9): every cron job pings its Healthchecks.io check when it finishes —
 * `/fail` when it couldn't do its job. A missing URL (local, preview) skips the ping. Never throws,
 * and never logs the URL (it identifies the check).
 */
export async function pingHealthcheck(
  url: string | undefined,
  result: 'ok' | 'fail',
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!url) return;
  try {
    await fetchImpl(result === 'ok' ? url : `${url.replace(/\/$/, '')}/fail`, {
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    console.warn(JSON.stringify({ event: 'healthcheck_ping_failed', result }));
  }
}
