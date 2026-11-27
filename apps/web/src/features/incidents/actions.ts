'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  clientUpdateSchema,
  incidentIdSchema,
  noteSchema,
  type ClientUpdateInput,
  rootCauseSchema,
  type NoteInput,
  type RootCauseInput,
} from './schemas';
import { flushAfter } from './flush';

export type AckResult = { ok: true; postsAt: string } | { ok: false; message: string };
export type UndoResult = { ok: true } | { ok: false; message: string };
export type NoteResult = { ok: true } | { ok: false; message: string };
export type RootCauseResult =
  { ok: true } | { ok: false; message: string; field?: 'category' | 'what' | 'fix' | 'prevent' };
export type ResolveResult =
  | { ok: true; postsAt: string; notifies: boolean }
  | { ok: false; message: string; field?: 'category' | 'what' | 'fix' | 'prevent' };

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
 * Note / root cause / resolve refusals (D-033). The SQL words a condition or a field refusal for
 * people (22023, 55000: "It needs 2 OK rounds …", "Unknown keeps the incident open …"), so those
 * messages are shown as they are; the role and not-found ones are said here.
 */
const ACT_REFUSALS: Record<string, string> = {
  '42501': 'Only the site’s owner, its backup or an Admin can do this.',
  P0002: 'This incident doesn’t exist any more.',
};
const UNDO_RESOLVE_REFUSALS: Record<string, string> = {
  '42501': 'Only the person who resolved it can undo it.',
  P0002: 'This incident doesn’t exist any more.',
};
const refusal = (error: { code: string; message: string }, table: Record<string, string>) =>
  table[error.code] ?? (error.code === '55000' || error.code === '22023' ? error.message : FAILED);

const revalidate = (id: string) => {
  revalidatePath(`/incidents/${id}`);
  revalidatePath('/incidents');
  revalidatePath('/'); // the Overview banners and Live issues (S06b)
};

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
  flushAfter(id.data, postsAt, 'ack_flush_failed');
  revalidate(id.data);
  return { ok: true, postsAt };
}

/** Take back one's own acknowledgement inside the 10 s window: nothing is sent (T08). */
export async function undoAcknowledge(incidentId: string): Promise<UndoResult> {
  const id = incidentIdSchema.safeParse(incidentId);
  if (!id.success) return { ok: false, message: UNDO_REFUSALS.P0002! };
  const supabase = await createClient();
  const { error } = await supabase.rpc('undo_ack', { p_incident_id: id.data });
  if (error) return { ok: false, message: UNDO_REFUSALS[error.code] ?? FAILED };
  revalidate(id.data);
  return { ok: true };
}

const fieldOf = (path: PropertyKey | undefined): 'category' | 'what' | 'fix' | 'prevent' | undefined =>
  path === 'category' || path === 'what' || path === 'fix' || path === 'prevent' ? path : undefined;

/**
 * A note on the timeline and the NOTE reply in the thread, sent at once (§16.5: no @mention, no
 * email; D-033: no hold). `add_incident_note` checks who may (Admin, the site's owner or backup).
 */
export async function addNote(input: NoteInput): Promise<NoteResult> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('add_incident_note', {
    p_incident_id: parsed.data.incidentId,
    p_text: parsed.data.text,
  });
  if (error) return { ok: false, message: refusal(error, ACT_REFUSALS) };
  flushAfter(parsed.data.incidentId, null, 'note_flush_failed');
  revalidatePath(`/incidents/${parsed.data.incidentId}`);
  return { ok: true };
}

/** "Save, keep open": the root cause without resolving (a draft while still down, or Unknown). */
export async function saveRootCause(input: RootCauseInput): Promise<RootCauseResult> {
  const parsed = rootCauseSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return { ok: false, message: issue.message, field: fieldOf(issue.path[0]) };
  }
  const { incidentId, category, what, fix, prevent } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_root_cause', {
    p_incident_id: incidentId,
    p_category: category,
    p_what: what,
    p_fix: fix,
    ...(prevent === undefined ? {} : { p_prevent: prevent }),
  });
  if (error) return { ok: false, message: refusal(error, ACT_REFUSALS) };
  revalidate(incidentId);
  return { ok: true };
}

export type ClientUpdateResult = { ok: true } | { ok: false; message: string };

const CLIENT_UPDATE_REFUSALS: Record<string, string> = {
  '42501': 'Only an Admin, the site’s owner or backup, or the client’s account manager can mark this.',
  P0002: 'This incident doesn’t exist any more.',
  '22001': 'Keep it under 500 characters.',
};

/**
 * Mark client updated / Not needed (S11, spec §9, §16.6, D-052): `mark_client_update` checks who may
 * and records it with the timeline and the audit row. It sends nothing, so nothing is held.
 */
export async function markClientUpdate(input: ClientUpdateInput): Promise<ClientUpdateResult> {
  const parsed = clientUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  const { incidentId, notNeeded, note } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_client_update', {
    p_incident_id: incidentId,
    p_not_needed: notNeeded,
    p_note: note,
  });
  if (error) return { ok: false, message: refusal(error, CLIENT_UPDATE_REFUSALS) };
  revalidate(incidentId);
  return { ok: true };
}

/**
 * Resolve (FR-06, T10, D-033): `resolve_incident` checks the three conditions itself, saves the root
 * cause and holds RESOLVED for the 10 s Undo window; this request sends it once the window closes.
 */
export async function resolveIncident(input: RootCauseInput): Promise<ResolveResult> {
  const parsed = rootCauseSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return { ok: false, message: issue.message, field: fieldOf(issue.path[0]) };
  }
  const { incidentId, category, what, fix, prevent, acceptCheckId } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('resolve_incident', {
    p_incident_id: incidentId,
    p_category: category,
    p_what: what,
    p_fix: fix,
    ...(prevent === undefined ? {} : { p_prevent: prevent }),
    ...(acceptCheckId ? { p_accept_check_id: acceptCheckId } : {}),
  });
  if (error) return { ok: false, message: refusal(error, ACT_REFUSALS) };
  // The resolve's event says whether anything was queued (D-047: no alert went out → nothing to post).
  const { data: event } = await supabase
    .from('incident_events')
    .select('payload')
    .eq('incident_id', incidentId)
    .eq('type', 'resolved')
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const notifies = (event?.payload as { notifies?: unknown } | null)?.notifies !== false;
  if (notifies) flushAfter(incidentId, data, 'resolve_flush_failed');
  revalidate(incidentId);
  return { ok: true, postsAt: data, notifies };
}

/** Take back one's own resolve inside the 10 s window: nothing is sent. */
export async function undoResolve(incidentId: string): Promise<UndoResult> {
  const id = incidentIdSchema.safeParse(incidentId);
  if (!id.success) return { ok: false, message: UNDO_RESOLVE_REFUSALS.P0002! };
  const supabase = await createClient();
  const { error } = await supabase.rpc('undo_resolve', { p_incident_id: id.data });
  if (error) {
    const message =
      error.code === '55000' && /window/.test(error.message)
        ? 'Too late to undo — the resolve has been posted.'
        : refusal(error, UNDO_RESOLVE_REFUSALS);
    return { ok: false, message };
  }
  revalidate(id.data);
  return { ok: true };
}
