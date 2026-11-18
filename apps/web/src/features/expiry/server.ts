import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { loadExpiry } from './queries';

export { checkNowHandler } from './check-now';

/** `/expiry`: every live site's certificate and domain expiry, read as the signed-in person. */
export async function getExpiry(now = new Date()) {
  return loadExpiry(await createClient(), now);
}
