import 'server-only';
import { getOncallPage } from '@/features/oncall/server';
import type { OncallData } from '@/features/oncall';
import { createClient } from '@/lib/supabase/server';
import { liveShiftOf, type UsersData } from './model';
import { loadUsersData } from './queries';

export interface UsersPageData {
  data: UsersData;
  /** On-call as the On-call page has it, only while someone holds a live shift (Hand over shift…). */
  oncall: OncallData | null;
  now: string;
}

/** The Users page for an Admin (S16, D-062). */
export async function getUsersPage(
  viewer: { id: string; name: string },
  now = new Date(),
): Promise<UsersPageData> {
  const data = await loadUsersData(await createClient(), viewer.id, now);
  const live = data.people.some((p) => liveShiftOf(data, p.id, now));
  const oncall = live
    ? await getOncallPage({ id: viewer.id, name: viewer.name, role: 'admin' }, null, now)
    : null;
  return { data, oncall, now: now.toISOString() };
}
