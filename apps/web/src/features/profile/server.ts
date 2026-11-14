import 'server-only';
import { serverEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import type { ProfileData } from './model';
import { loadProfileData } from './queries';

export interface ProfilePageData {
  data: ProfileData;
  now: string;
}

/** `/profile`: the signed-in person's own page, every role (S16 PR 3). */
export async function getProfilePage(me: { id: string }, now = new Date()): Promise<ProfilePageData> {
  // Email is on only with both values set (notifier deps): the Email row never promises what isn't there.
  const env = serverEnv();
  const emailOn = !!env.RESEND_API_KEY && !!env.ALERT_EMAIL_FROM;
  const data = await loadProfileData(await createClient(), me.id, now, emailOn);
  return { data, now: now.toISOString() };
}
