import { loadConfig } from './config';

/**
 * Bangkok probe loop (systemd, every minute) and the browser verifier worker.
 * Both talk only to the web app's Ingest / Job APIs with INGEST_TOKEN (PRD §10).
 */
async function main() {
  const config = loadConfig();
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => controller.abort());

  console.info(`vps-agent started · loop every ${config.LOOP_INTERVAL_MS / 1000} s`);
  while (!controller.signal.aborted) {
    const started = Date.now();
    // TODO(FR-02): fetch monitors due for BKK, runHttpCheck (@dxt/probe) with the WAF secret header,
    // recheck failures within 30 s, POST results to /api/ingest, then ping Healthchecks.
    // TODO(FR-04): lease verification jobs from /api/jobs and run them in Playwright Chromium.
    const wait = Math.max(0, config.LOOP_INTERVAL_MS - (Date.now() - started));
    await new Promise((resolve) => setTimeout(resolve, wait).unref());
  }
  console.info('vps-agent stopped');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
