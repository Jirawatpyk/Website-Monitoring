import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@dxt/db';

/** Browser client for Client Components (Realtime subscriptions, client-side reads). */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
