import 'server-only';
import { serverEnv } from '@/lib/env';
import { runCronJob } from '../cron-job';
import { serviceDb } from '../db';
import { runProbe, type CloudLocation } from './run-probe';

const PING: Record<CloudLocation, 'HEALTHCHECKS_PING_URL_PROBE_SIN' | 'HEALTHCHECKS_PING_URL_PROBE_TYO'> = {
  SIN: 'HEALTHCHECKS_PING_URL_PROBE_SIN',
  TYO: 'HEALTHCHECKS_PING_URL_PROBE_TYO',
};

/** The probe-sin / probe-tyo cron job: env → runProbe → log, Healthchecks ping, JSON summary. */
export function probeJob(location: CloudLocation): Promise<Response> {
  const env = serverEnv();
  const value = env.PROBE_SECRET_HEADER_VALUE;
  return runCronJob(`probe-${location.toLowerCase()}`, env[PING[location]], () =>
    runProbe({
      db: serviceDb(),
      location,
      secretHeader: value ? { name: env.PROBE_SECRET_HEADER_NAME, value } : undefined,
      vercel: process.env.VERCEL ? { region: process.env.VERCEL_REGION } : null,
    }),
  );
}
