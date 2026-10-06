import 'server-only';
import type { DbClient } from '@dxt/db';
import type { ServerEnv } from '@/lib/env';
import { appBaseUrl } from '../app-url';
import type { DispatchDeps } from './dispatch';

/** Delivery settings from the environment: Chat webhook, Resend (both optional), app URL. */
export function notifierDeps(db: DbClient, env: ServerEnv): DispatchDeps {
  return {
    db,
    webhookUrl: env.GOOGLE_CHAT_ALERTS_WEBHOOK_URL,
    email:
      env.RESEND_API_KEY && env.ALERT_EMAIL_FROM
        ? { apiKey: env.RESEND_API_KEY, from: env.ALERT_EMAIL_FROM }
        : undefined,
    appUrl: appBaseUrl(env.NEXT_PUBLIC_APP_URL),
  };
}
