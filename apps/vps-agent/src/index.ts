import { createApi } from './api';
import { launchBrowser } from './browser';
import { loadConfig } from './config';
import { ping } from './healthchecks';
import { runProbeRound, untilNextTick } from './probe-loop';
import { createVerifierPool } from './verifier';

/** The verifier pings Healthchecks at most this often (its check expects one a minute, grace 3 min). */
const VERIFIER_PING_EVERY_MS = 60_000;

/**
 * The VPS agent (systemd `dxt-agent@<env>`): the Bangkok probe on the UTC minute and the browser
 * verifier polling for jobs. Both talk only to the web app's Ingest / Job APIs with INGEST_TOKEN
 * (PRD §10); each pings its own Healthchecks check.
 */
async function main() {
  const config = loadConfig();
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => controller.abort());
  const { signal } = controller;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
    });

  const api = createApi(config.API_BASE_URL, config.INGEST_TOKEN);
  const value = config.PROBE_SECRET_HEADER_VALUE;
  const secretHeader = value ? { name: config.PROBE_SECRET_HEADER_NAME, value } : undefined;
  const browser = await launchBrowser();
  const pool = createVerifierPool({ api, browser }, config.VERIFIER_MAX_SESSIONS);

  console.info(
    `vps-agent started · probe every ${config.LOOP_INTERVAL_MS / 1000} s · verifier ${config.VERIFIER_MAX_SESSIONS} sessions`,
  );

  const probeLoop = async () => {
    while (!signal.aborted) {
      await sleep(untilNextTick(Date.now(), config.LOOP_INTERVAL_MS));
      if (signal.aborted) break;
      try {
        const summary = await runProbeRound({ api, secretHeader });
        console.info(JSON.stringify({ event: 'probe_round', ...summary }));
        await ping(config.HEALTHCHECKS_PING_URL_PROBE_BKK, 'ok');
      } catch (err) {
        console.error(JSON.stringify({ event: 'probe_round_failed', error: String(err) }));
        await ping(config.HEALTHCHECKS_PING_URL_PROBE_BKK, 'fail');
      }
    }
  };

  const verifierLoop = async () => {
    let lastPing = 0;
    while (!signal.aborted) {
      let ok = true;
      try {
        await pool.poll();
      } catch (err) {
        ok = false;
        console.error(JSON.stringify({ event: 'verifier_poll_failed', error: String(err) }));
      }
      if (Date.now() - lastPing >= VERIFIER_PING_EVERY_MS) {
        lastPing = Date.now();
        await ping(config.HEALTHCHECKS_PING_URL_VERIFIER, ok ? 'ok' : 'fail');
      }
      await sleep(config.VERIFIER_POLL_MS);
    }
    await pool.drain();
  };

  await Promise.all([probeLoop(), verifierLoop()]);
  await browser.close();
  console.info('vps-agent stopped');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
