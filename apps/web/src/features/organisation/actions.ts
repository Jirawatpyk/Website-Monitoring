'use server';

import { revalidatePath } from 'next/cache';
import { getAccess } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import * as m from './mutations';
import type {
  AddHolidayInput,
  AddPhraseInput,
  RemovePhraseInput,
  RenameHolidayInput,
  SaveHoursInput,
} from './schemas';

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

async function asAdmin(run: (db: m.OrganisationDeps['db']) => Promise<m.SaveHoursResult>) {
  const access = await getAccess();
  if (access.status !== 'active' || access.profile.role !== 'admin') {
    return { ok: false as const, message: 'Only an Admin can change the company holidays.' };
  }
  const result = await run(await createClient());
  // The Organisation page lists them; Escalation previews the ladder over them.
  if (result.ok) for (const path of ['/settings/organisation', '/escalation']) revalidatePath(path);
  return result;
}

/** Adds, renames or removes one company holiday as the signed-in Admin (the SQL checks the role again). */
export async function addHoliday(input: AddHolidayInput): Promise<m.SaveHoursResult> {
  return asAdmin((db) => m.addHoliday(input, { db }));
}
export async function renameHoliday(input: RenameHolidayInput): Promise<m.SaveHoursResult> {
  return asAdmin((db) => m.renameHoliday(input, { db }));
}
export async function removeHoliday(id: string): Promise<m.SaveHoursResult> {
  return asAdmin((db) => m.removeHoliday(id, { db }));
}

const NOT_ADMIN_WORDS = 'Only an Admin can change the shared forbidden words.';
const isAdmin = async () => {
  const access = await getAccess();
  return access.status === 'active' && access.profile.role === 'admin';
};

/** "Check phrase" as the signed-in Admin (the SQL checks the role again; nothing is written). */
export async function checkPhrase(phrase: string): Promise<m.CheckPhraseResult> {
  if (!(await isAdmin())) return { ok: false, message: NOT_ADMIN_WORDS };
  return m.checkPhrase(phrase, { db: await createClient() });
}

/** Adds or removes one shared forbidden phrase with a note (audited in SQL). */
export async function addPhrase(input: AddPhraseInput): Promise<m.SaveHoursResult> {
  if (!(await isAdmin())) return { ok: false, message: NOT_ADMIN_WORDS };
  const result = await m.addPhrase(input, { db: await createClient() });
  if (result.ok) revalidatePath('/settings/organisation');
  return result;
}
export async function removePhrase(input: RemovePhraseInput): Promise<m.SaveHoursResult> {
  if (!(await isAdmin())) return { ok: false, message: NOT_ADMIN_WORDS };
  const result = await m.removePhrase(input, { db: await createClient() });
  if (result.ok) revalidatePath('/settings/organisation');
  return result;
}
