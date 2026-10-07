/**
 * Healthchecks.io ping after every loop (PRD §9): a missed ping for 3 min emails Tao (spec §15.3).
 * `/fail` when the loop couldn't do its job. No URL → no ping. Never throws, never logs the URL.
 */
export async function ping(
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
