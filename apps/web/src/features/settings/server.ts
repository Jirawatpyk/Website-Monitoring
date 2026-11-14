import 'server-only';
import { parseAllowedDomains } from '@dxt/shared';
import { serverEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import type { UsersData } from './model';
import { loadSecurityData, loadUsersData } from './queries';
import type { SecurityData } from './security-model';

export interface UsersPageData {
  data: UsersData;
  now: string;
}

/** The Users page for an Admin (S16, D-062). Hand over's On-call data loads when that dialog opens. */
export async function getUsersPage(viewer: { id: string }, now = new Date()): Promise<UsersPageData> {
  const env = serverEnv();
  const emailOn = !!env.RESEND_API_KEY && !!env.ALERT_EMAIL_FROM;
  const data = await loadUsersData(await createClient(), viewer.id, now);
  return { data: { ...data, emailOn }, now: now.toISOString() };
}

export interface SecurityPageData {
  data: SecurityData;
  now: string;
}

/** Sign-in & security for an Admin (S16 PR 3): the domains come from the deploy's env (§35.5). */
export async function getSecurityPage(viewer: { id: string }, now = new Date()): Promise<SecurityPageData> {
  const domains = parseAllowedDomains(serverEnv().ALLOWED_EMAIL_DOMAIN);
  const data = await loadSecurityData(await createClient(), viewer.id, domains, now);
  return { data, now: now.toISOString() };
}
