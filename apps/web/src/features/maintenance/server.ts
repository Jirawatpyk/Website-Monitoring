import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { loadPausableSites, loadWindowRows } from './queries';

export { loadWindowRows } from './queries';
export {
  overviewOf,
  phoneLine,
  windowEvents,
  type OverviewMaintenance,
  type WindowEvent,
} from './page-model';

/** `/maintenance`: every window and mute to show, and the live sites the dialog can offer. */
export async function getMaintenancePage(now = new Date()) {
  const db = await createClient();
  const [rows, sites] = await Promise.all([loadWindowRows(db, now), loadPausableSites(db)]);
  return { rows, sites };
}
