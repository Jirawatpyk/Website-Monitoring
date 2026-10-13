import 'server-only';
import { serverEnv } from '@/lib/env';
import { runCronJob } from '../cron-job';
import { serviceDb } from '../db';
import { runCrawler } from './run-crawler';

/** The crawler cron job: env → runCrawler → log, Healthchecks ping, JSON summary. */
export function crawlerJob(): Promise<Response> {
  const env = serverEnv();
  const value = env.PROBE_SECRET_HEADER_VALUE;
  return runCronJob('crawler', env.HEALTHCHECKS_PING_URL_CRAWLER, () =>
    runCrawler({
      db: serviceDb(),
      secretHeader: value ? { name: env.PROBE_SECRET_HEADER_NAME, value } : undefined,
      vercel: process.env.VERCEL ? { region: process.env.VERCEL_REGION } : null,
      // Explicit opt-in, and never on Vercel, as the probe's.
      allowPrivateTargets: !process.env.VERCEL && process.env.PROBE_ALLOW_PRIVATE_TARGETS === '1',
    }),
  );
}
