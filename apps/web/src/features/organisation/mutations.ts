import 'server-only';
import type { ServerClient } from '@/lib/supabase/server';
import { DAY_SETS } from './model';
import { saveHoursSchema, type SaveHoursInput } from './schemas';

export type SaveHoursResult = { ok: true } | { ok: false; message: string };

export interface OrganisationDeps {
  db: Pick<ServerClient, 'rpc'>;
}

/** Hints `save_response_hours` raises whose message is already the sentence to show. */
const SQL_WORDS = new Set(['note_required', 'note_too_long', 'hours_grid', 'hours_order', 'days_invalid']);

/**
 * Saves the response hours in one SQL call (Admin only; one audit row with the note). The engine and
 * the notifier read them live, so the next run uses them (D-034, D-069 item 2).
 */
export async function saveHours(input: SaveHoursInput, { db }: OrganisationDeps): Promise<SaveHoursResult> {
  const parsed = saveHoursSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the hours.' };
  const { error } = await db.rpc('save_response_hours', {
    p_start: parsed.data.from,
    p_end: parsed.data.to,
    p_days: [...DAY_SETS[parsed.data.days]],
    p_note: parsed.data.note,
  });
  if (!error) return { ok: true };
  if (error.code === '42501') return { ok: false, message: 'Only an Admin can change the response hours.' };
  if (error.hint && SQL_WORDS.has(error.hint)) return { ok: false, message: error.message };
  return { ok: false, message: 'Couldn’t save. Check your connection and try again.' };
}
