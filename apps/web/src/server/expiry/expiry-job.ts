import 'server-only';
import { serverEnv } from '@/lib/env';
import { runCronJob } from '../cron-job';
import { serviceDb } from '../db';
import { runExpiry } from './run-expiry';

/** The expiry cron job: env → runExpiry → log, Healthchecks ping (optional), JSON summary. */
export function expiryJob(): Promise<Response> {
  const env = serverEnv();
  return runCronJob('expiry', env.HEALTHCHECKS_PING_URL_EXPIRY, () =>
    runExpiry({
      db: serviceDb(),
      vercel: process.env.VERCEL ? { region: process.env.VERCEL_REGION } : null,
      // Explicit opt-in, and never on Vercel, as the probe's.
      allowPrivateTargets: !process.env.VERCEL && process.env.PROBE_ALLOW_PRIVATE_TARGETS === '1',
    }),
  );
}
