import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { UsersData } from './model';
import { loadUsersData } from './queries';

export interface UsersPageData {
  data: UsersData;
  now: string;
}

/** The Users page for an Admin (S16, D-062). Hand over's On-call data loads when that dialog opens. */
export async function getUsersPage(viewer: { id: string }, now = new Date()): Promise<UsersPageData> {
  const data = await loadUsersData(await createClient(), viewer.id, now);
  return { data, now: now.toISOString() };
}
