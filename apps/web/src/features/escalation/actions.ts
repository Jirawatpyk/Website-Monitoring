'use server';

import { revalidatePath } from 'next/cache';
import { getAccess } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import * as m from './mutations';
import type { SaveEscalationInput } from './schemas';
import type { EscalationSaveResult } from './types';

/** Saves the escalation policies as the signed-in Admin (the SQL checks the role again, D-034). */
export async function saveEscalation(input: SaveEscalationInput): Promise<EscalationSaveResult> {
  const access = await getAccess();
  if (access.status !== 'active' || access.profile.role !== 'admin') {
    return { ok: false, message: 'Only an Admin can change escalation policies.' };
  }
  const result = await m.saveEscalation(input, { db: await createClient() });
  if (result.ok) revalidatePath('/escalation');
  return result;
}
