import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { loadExpiry, loadExpirySummary } from './queries';

export { checkNowHandler } from './check-now';

/** `/expiry`: every live site's certificate and domain expiry, read as the signed-in person. */
export async function getExpiry(now = new Date()) {
  return loadExpiry(await createClient(), now);
}

/** The Sites list's "SSL & domains" phone row: due within 60 days, couldn't read, not checked yet. */
export async function getExpirySummary(now = new Date()) {
  return loadExpirySummary(await createClient(), now);
}
