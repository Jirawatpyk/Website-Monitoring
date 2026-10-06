import { cronHandler } from '@/lib/auth/cron';
import { serverEnv } from '@/lib/env';
import { runCronJob } from '@/server/cron-job';
import { serviceDb } from '@/server/db';
import { notifierDeps } from '@/server/notifier/deps';
import { runNotifierSweep } from '@/server/notifier/dispatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Sweeps the delivery queue twice a minute: retries (30 s / 2 min / 8 min, then the email fallback)
// and ack messages whose Undo window has closed. New alerts are sent inline by the engine.
export const GET = cronHandler(() => {
  const env = serverEnv();
  return runCronJob('notifier', env.HEALTHCHECKS_PING_URL_NOTIFIER, () =>
    runNotifierSweep(notifierDeps(serviceDb(), env)),
  );
});
