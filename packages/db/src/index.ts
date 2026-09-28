import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export type { Database, Json } from './database.types';
export type DbClient = SupabaseClient<Database>;

// The service-role client lives in `@dxt/db/service` (server-only), so importing types from here can
// never pull it into a browser bundle.
