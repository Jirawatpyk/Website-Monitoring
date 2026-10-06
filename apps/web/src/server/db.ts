import 'server-only';
import { createServiceClient } from '@dxt/db/service';
import type { DbClient } from '@dxt/db';
import { serverEnv } from '@/lib/env';

/** Service-role client for background jobs (cron, Ingest / Job APIs). Bypasses RLS — never for UI. */
export function serviceDb(): DbClient {
  const env = serverEnv();
  return createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}
