import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { ProfileData } from './model';
import { loadProfileData } from './queries';

export interface ProfilePageData {
  data: ProfileData;
  now: string;
}

/** `/profile`: the signed-in person's own page, every role (S16 PR 3). */
export async function getProfilePage(me: { id: string }, now = new Date()): Promise<ProfilePageData> {
  const data = await loadProfileData(await createClient(), me.id, now);
  return { data, now: now.toISOString() };
}
