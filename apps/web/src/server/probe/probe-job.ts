import 'server-only';
import { serverEnv } from '@/lib/env';
import { runCronJob, type CronJobResult } from '../cron-job';
import { serviceDb } from '../db';
import { engineAndDeliver } from '../engine/engine-and-deliver';
import { PROBE_BUDGET_MS, runProbe, type CloudLocation } from './run-probe';

const PING: Record<CloudLocation, 'HEALTHCHECKS_PING_URL_PROBE_SIN' | 'HEALTHCHECKS_PING_URL_PROBE_TYO'> = {
  SIN: 'HEALTHCHECKS_PING_URL_PROBE_SIN',
  TYO: 'HEALTHCHECKS_PING_URL_PROBE_TYO',
};

/** Time the engine and the first sends need after the probe: skip the trigger below it. */
export const ENGINE_TRIGGER_MIN_MS = 20_000;

/**
 * The probe-sin / probe-tyo cron job: env → runProbe → log, Healthchecks ping, JSON summary.
 * When a recheck failed or a check was blocked, the round may just have completed: run the engine and send right away,
 * so DOWN leaves within 30 s of the confirm (PRD §9) instead of waiting for the engine cron. The
 * engine is idempotent (one open incident per site, state-guarded writes), so a second probe or
 * the cron judging the same round adds nothing; a failure here never fails the probe's ping.
 */
export function probeJob(location: CloudLocation, clock: () => number = Date.now): Promise<Response> {
  const env = serverEnv();
  const value = env.PROBE_SECRET_HEADER_VALUE;
  const started = clock();
  return runCronJob(`probe-${location.toLowerCase()}`, env[PING[location]], async () => {
    const db = serviceDb();
    const result = await runProbe({
      db,
      location,
      secretHeader: value ? { name: env.PROBE_SECRET_HEADER_NAME, value } : undefined,
      vercel: process.env.VERCEL ? { region: process.env.VERCEL_REGION } : null,
      // Explicit opt-in, and never on Vercel: a local dev server probing a loopback test target.
      allowPrivateTargets: !process.env.VERCEL && process.env.PROBE_ALLOW_PRIVATE_TARGETS === '1',
    });
    const deadline = started + PROBE_BUDGET_MS;
    // A failed recheck may confirm DOWN; a blocked check needs its verify job queued (or PROBLEM
    // (unverified) when the verifier is down, D-001) — either way, not at the next engine cron.
    if (!(result.recheckFailed || result.blocked) || deadline - clock() < ENGINE_TRIGGER_MIN_MS)
      return result;
    try {
      return { ...result, engine: await engineAndDeliver(db, env, deadline) };
    } catch (err) {
      console.error(JSON.stringify({ event: 'probe_engine_trigger_failed', location, error: String(err) }));
      return {
        ...result,
        engine: { ok: false, error: 'engine failed; the engine cron retries' },
      } satisfies CronJobResult;
    }
  });
}
