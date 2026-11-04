import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { loadProbes } from './queries';

export type { ProbesData } from './queries';

/** `/probes`: everything the page shows, read as the signed-in person. */
export async function getProbes(isAdmin: boolean, now = new Date()) {
  return loadProbes(await createClient(), isAdmin, now);
}
