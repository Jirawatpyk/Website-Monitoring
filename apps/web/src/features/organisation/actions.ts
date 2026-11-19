'use server';

import { revalidatePath } from 'next/cache';
import { getAccess } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import * as m from './mutations';
import type { SaveHoursInput } from './schemas';

/** Saves the response hours as the signed-in Admin (the SQL checks the role again, D-069). */
export async function saveResponseHours(input: SaveHoursInput): Promise<m.SaveHoursResult> {
  const access = await getAccess();
  if (access.status !== 'active' || access.profile.role !== 'admin') {
    return { ok: false, message: 'Only an Admin can change the response hours.' };
  }
  const result = await m.saveHours(input, { db: await createClient() });
  if (result.ok) {
    // Every page that words the hours.
    for (const path of ['/settings/organisation', '/escalation', '/profile', '/oncall', '/sites', '/']) {
      revalidatePath(path, path === '/sites' ? 'layout' : 'page');
    }
  }
  return result;
}
