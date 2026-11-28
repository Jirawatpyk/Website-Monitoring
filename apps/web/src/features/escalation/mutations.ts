import 'server-only';
import type { ServerClient } from '@/lib/supabase/server';
import { saveEscalationInputSchema, type SaveEscalationInput } from './schemas';
import type { EscalationSaveResult } from './types';

export interface EscalationDeps {
  db: Pick<ServerClient, 'rpc'>;
}

/** Hints whose SQL message isn't the board's sentence: the page's own words (`stepErrors`). */
const CLIENT_WORDS: Record<string, string> = {
  ceo_not_allowed: 'The CEO is told only on Tier 1 DOWN — remove CEO from this step.',
  ceo_too_early: 'The CEO can be told only from L2 onward.',
  management_not_allowed: 'Management is used only on Tier 1 DOWN — remove it from this step.',
  management_too_early: 'Management can be told only from L2.',
};

/** Hints `save_escalation_policies` raises whose message is already the board's sentence. */
export const BOARD_WORDS = new Set([
  'note_required',
  'note_too_long',
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
  // D-078 (20261128124815_management_token.sql)
  'management_not_allowed',
  'management_too_early',
  'nobody_management',
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
  // A stale page or a race reaches these; the SQL words predate the board's (spec re-check L3).
  const words = error.hint ? CLIENT_WORDS[error.hint] : undefined;
  if (words) return { ok: false, message: words };
  if (error.hint && BOARD_WORDS.has(error.hint)) return { ok: false, message: error.message };
  return { ok: false, message: 'Couldn’t save. Check your connection and try again.' };
}
