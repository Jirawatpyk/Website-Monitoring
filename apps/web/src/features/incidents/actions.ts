'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { serverEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { serviceDb } from '@/server/db';
import { notifierDeps } from '@/server/notifier/deps';
import { dispatchNotifications } from '@/server/notifier/dispatch';
import { incidentIdSchema } from './schemas';

export type AckResult = { ok: true; postsAt: string } | { ok: false; message: string };
export type UndoResult = { ok: true } | { ok: false; message: string };

/** Database refusals in words (`ack_incident` / `undo_ack` error codes). */
const REFUSALS: Record<string, string> = {
  '42501': 'Only the site’s owner, its backup or an Admin can acknowledge this incident.',
  P0002: 'This incident doesn’t exist any more.',
  '55000': 'This incident is no longer waiting for an acknowledgement.',
};
const UNDO_REFUSALS: Record<string, string> = {
  '42501': 'Only the person who acknowledged can undo it.',
  P0002: 'This incident doesn’t exist any more.',
  '55000': 'Too late to undo — the acknowledgement has been posted.',
};
const FAILED = 'Couldn’t reach the server. Check your connection and try again.';

/**
 * Acknowledge as the signed-in person (FR-07, D-016). The SQL function checks who may, records the
 * state, timeline and audit row, and holds ACKNOWLEDGED for the 10 s Undo window (spec §14.3);
 * once the window closes this request sends it, and the notifier cron sweeps up anything left.
 */
export async function acknowledgeIncident(incidentId: string): Promise<AckResult> {
  const id = incidentIdSchema.safeParse(incidentId);
  if (!id.success) return { ok: false, message: REFUSALS.P0002! };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('ack_incident', { p_incident_id: id.data });
  if (error) return { ok: false, message: REFUSALS[error.code] ?? FAILED };

  const postsAt = data;
  after(async () => {
    // Just after the window closes, so the claim (hold_until <= now) takes the held messages.
    await new Promise((r) => setTimeout(r, Math.max(0, new Date(postsAt).getTime() - Date.now()) + 500));
    try {
      await dispatchNotifications(notifierDeps(serviceDb(), serverEnv()));
    } catch (err) {
      console.error(JSON.stringify({ event: 'ack_flush_failed', error: String(err) }));
    }
  });
  revalidatePath(`/incidents/${id.data}`);
  return { ok: true, postsAt };
}

/** Take back one's own acknowledgement inside the 10 s window: nothing is sent (T08). */
export async function undoAcknowledge(incidentId: string): Promise<UndoResult> {
  const id = incidentIdSchema.safeParse(incidentId);
  if (!id.success) return { ok: false, message: UNDO_REFUSALS.P0002! };
  const supabase = await createClient();
  const { error } = await supabase.rpc('undo_ack', { p_incident_id: id.data });
  if (error) return { ok: false, message: UNDO_REFUSALS[error.code] ?? FAILED };
  revalidatePath(`/incidents/${id.data}`);
  return { ok: true };
}
