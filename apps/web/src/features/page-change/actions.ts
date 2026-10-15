'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * Accept as new baseline and its Undo (spec §26.5–§26.6, D-046 item 9): thin wrappers over
 * `accept_page_baseline` / `undo_page_baseline`, which check the Admin role, the fetch and the window,
 * and write the baseline, the audit row and the timeline event in one transaction. Nothing is posted:
 * accepting only changes a stored value, so there is nothing to flush after the window.
 */

export type AcceptResult = { ok: true; appliesAt: string } | { ok: false; message: string; field?: 'reason' };
export type UndoBaselineResult = { ok: true } | { ok: false; message: string };

const acceptSchema = z.object({
  checkId: z.uuid(),
  reason: z.string().trim().min(1, 'Type a reason — it goes in the audit log with the change').max(500),
});
const monitorSchema = z.uuid();

const FAILED = 'Couldn’t reach the server. Check your connection and try again.';
const REFUSALS: Record<string, string> = {
  '42501': 'Only an Admin can accept a new baseline.',
};

function revalidate() {
  revalidatePath('/incidents', 'layout');
  revalidatePath('/sites', 'layout');
}

export async function acceptBaseline(input: { checkId: string; reason: string }): Promise<AcceptResult> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return issue?.path[0] === 'reason'
      ? { ok: false, message: issue.message, field: 'reason' }
      : { ok: false, message: 'This fetch can’t become the baseline.' };
  }
  const db = await createClient();
  const { data, error } = await db.rpc('accept_page_baseline', {
    p_check_id: parsed.data.checkId,
    p_reason: parsed.data.reason,
  });
  if (error) {
    // 22023 / 55000 carry the SQL's own words ("A new baseline is already waiting to apply").
    const message =
      REFUSALS[error.code] ?? (['22023', '55000'].includes(error.code) ? error.message : FAILED);
    return { ok: false, message, ...(error.hint === 'reason_required' ? { field: 'reason' as const } : {}) };
  }
  revalidate();
  return { ok: true, appliesAt: data };
}

export async function undoBaseline(monitorId: string): Promise<UndoBaselineResult> {
  if (!monitorSchema.safeParse(monitorId).success) return { ok: false, message: 'Nothing to undo.' };
  const db = await createClient();
  const { error } = await db.rpc('undo_page_baseline', { p_monitor_id: monitorId });
  if (error) {
    const message =
      error.code === '42501'
        ? 'Only the person who accepted it can undo it.'
        : error.code === '55000'
          ? 'Too late to undo — the new baseline applies now.'
          : FAILED;
    return { ok: false, message };
  }
  revalidate();
  return { ok: true };
}
