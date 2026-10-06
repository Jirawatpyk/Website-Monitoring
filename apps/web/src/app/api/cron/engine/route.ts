import { cronHandler } from '@/lib/auth/cron';
import { serverEnv } from '@/lib/env';
import { appBaseUrl } from '@/server/app-url';
import { runCronJob } from '@/server/cron-job';
import { serviceDb } from '@/server/db';
import { runEngine } from '@/server/engine/run-engine';
import { dispatchNotifications } from '@/server/notifier/dispatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Status engine sweep (PRD §10): judge the latest rounds, open / recover incidents, queue messages —
// and send what it just queued, so DOWN doesn't wait a minute for the notifier cron (3-min budget).
export const GET = cronHandler(() => {
  const env = serverEnv();
  return runCronJob('engine', env.HEALTHCHECKS_PING_URL_ENGINE, async () => {
    const db = serviceDb();
    const summary = await runEngine(db);
    if (summary.opened + summary.recovered === 0) return summary;
    const delivery = await dispatchNotifications({
      db,
      webhookUrl: env.GOOGLE_CHAT_ALERTS_WEBHOOK_URL,
      appUrl: appBaseUrl(env.NEXT_PUBLIC_APP_URL),
    });
    return { ...summary, delivery };
  });
});
