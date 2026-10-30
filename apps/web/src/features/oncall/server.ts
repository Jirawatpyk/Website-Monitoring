import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Viewer } from './model';
import { loadOncallData } from './queries';

/** `/oncall`: everything the page shows, read as the signed-in person. */
export async function getOncallPage(viewer: Viewer, swapId: string | null, now = new Date()) {
  return loadOncallData(await createClient(), viewer, now, swapId);
}
