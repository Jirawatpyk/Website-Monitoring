import { cronHandler } from '@/lib/auth/cron';
import { serverEnv } from '@/lib/env';
import { runCronJob } from '@/server/cron-job';
import { serviceDb } from '@/server/db';
import { runEngine } from '@/server/engine/run-engine';
import { notifierDeps } from '@/server/notifier/deps';
import { dispatchNotifications } from '@/server/notifier/dispatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Status engine sweep (PRD §10): judge the latest rounds, open / recover incidents, queue messages —
// and send what it just queued (Chat + email), so alerts leave within 30 s of the confirm (PRD §9)
// instead of waiting for the notifier cron, which is the sweep for retries and held messages.
export const GET = cronHandler(() => {
  const env = serverEnv();
  return runCronJob('engine', env.HEALTHCHECKS_PING_URL_ENGINE, async () => {
    const db = serviceDb();
    const summary = await runEngine(db);
    if (summary.opened + summary.recovered === 0) return summary;
    const delivery = await dispatchNotifications(notifierDeps(db, env));
    return { ...summary, delivery };
  });
});
