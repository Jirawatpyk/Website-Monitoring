import 'server-only';
import type { ServerClient } from '@/lib/supabase/server';
import { saveEscalationInputSchema, type SaveEscalationInput } from './schemas';
import type { EscalationSaveResult } from './types';

export interface EscalationDeps {
  db: Pick<ServerClient, 'rpc'>;
}

/** Hints `save_escalation_policies` raises whose message is already the board's sentence. */
const BOARD_WORDS = new Set([
  'note_required',
  'reminder_invalid',
  'no_channel',
  'no_person',
  'step_too_early',
  'step_not_later',
  'down_needs_step',
  'ceo_not_allowed',
  'ceo_too_early',
  'voice_not_here',
  'fyi_required',
  'fyi_people',
  'l0_pinned',
  'too_many_steps',
  'step_too_late',
]);

/** Saves every policy and the reminder intervals in one SQL call (Admin only; one audit row with the note). */
export async function saveEscalation(
  input: SaveEscalationInput,
  { db }: EscalationDeps,
): Promise<EscalationSaveResult> {
  const parsed = saveEscalationInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the steps.' };
  const { error } = await db.rpc('save_escalation_policies', {
    p_policies: parsed.data.policies,
    p_down_reminder_min: parsed.data.downReminderMin,
    p_problem_reminder_min: parsed.data.problemReminderMin,
    p_note: parsed.data.note,
  });
  if (!error) return { ok: true };
  if (error.code === '42501') return { ok: false, message: 'Only an Admin can change escalation policies.' };
  if (error.hint && BOARD_WORDS.has(error.hint)) return { ok: false, message: error.message };
  return { ok: false, message: 'Couldn’t save. Check your connection and try again.' };
}
