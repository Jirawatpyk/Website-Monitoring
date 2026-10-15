import 'server-only';
import { z } from 'zod';
import { getAccess } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import type { PageChangeView } from './model';
import { loadPageChange } from './queries';

export { loadPageChange, type PageChangeMonitor } from './queries';

/**
 * Site detail's Page fingerprint card (spec §26.8): the live site's home page, read as the signed-in
 * person. Null for a draft site or one without a primary HTTP monitor.
 */
export async function getSitePageChange(
  siteId: string,
  now = new Date(),
): Promise<{ view: PageChangeView; canAccept: boolean } | null> {
  // An unknown address (`/sites/nope`) is the page's 404, never a query error here.
  if (!z.uuid().safeParse(siteId).success) return null;
  const access = await getAccess();
  if (access.status !== 'active') return null;
  const db = await createClient();
  const { data, error } = await db
    .from('monitors')
    .select('id, url, allowed_redirect_domains, sites!inner(is_active)')
    .eq('site_id', siteId)
    .eq('is_primary', true)
    .is('removed_at', null)
    .maybeSingle();
  if (error) throw new Error(`monitors: ${error.message}`);
  if (!data || !data.sites.is_active) return null;
  const view = await loadPageChange(
    db,
    { monitorId: data.id, siteId, url: data.url, allowedRedirectDomains: data.allowed_redirect_domains },
    access.profile,
    now,
  );
  return { view, canAccept: access.profile.role === 'admin' };
}
