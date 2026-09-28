import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { DbClient } from './index';
import type { Database } from './database.types';

/**
 * Service-role client for trusted server code only: Vercel cron functions (probes, engine, notifier)
 * and the Ingest / Job APIs. It bypasses RLS. `server-only` makes a Client Component import fail the
 * build; the VPS never gets this key (it talks to the Job API instead, PRD §10).
 */
export function createServiceClient(url: string, serviceRoleKey: string): DbClient {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
