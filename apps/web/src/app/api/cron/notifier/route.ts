import { cronHandler } from '@/lib/auth/cron';
import { serverEnv } from '@/lib/env';
import { runCronJob } from '@/server/cron-job';
import { serviceDb } from '@/server/db';
import { appBaseUrl } from '@/server/app-url';
import { dispatchNotifications } from '@/server/notifier/dispatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Sends queued Google Chat messages in their incident threads. Email, retries and the 30 s target
// arrive in S02b.
export const GET = cronHandler(() => {
  const env = serverEnv();
  return runCronJob('notifier', env.HEALTHCHECKS_PING_URL_NOTIFIER, () =>
    dispatchNotifications({
      db: serviceDb(),
      webhookUrl: env.GOOGLE_CHAT_ALERTS_WEBHOOK_URL,
      appUrl: appBaseUrl(env.NEXT_PUBLIC_APP_URL),
    }),
  );
});
