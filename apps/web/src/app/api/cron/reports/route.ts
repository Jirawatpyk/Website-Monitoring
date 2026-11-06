import { cronHandler } from '@/lib/auth/cron';
import { serverEnv } from '@/lib/env';
import { runCronJob } from '@/server/cron-job';
import { serviceDb } from '@/server/db';
import { notifierDeps } from '@/server/notifier/deps';
import { runReports } from '@/server/reports/run-reports';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 09:00 Bangkok (vercel.json `0 2 * * *`): the daily digest, and on Monday the weekly summary (S14,
// FR-12, D-056). No Healthchecks ping here — the dispatcher pings the reports' check once the digest's
// post really went (HEALTHCHECKS_PING_URL_REPORTS), so a cron that ran but couldn't post still alarms.
export const GET = cronHandler(() => {
  const env = serverEnv();
  return runCronJob('reports', undefined, () => runReports(notifierDeps(serviceDb(), env)));
});
