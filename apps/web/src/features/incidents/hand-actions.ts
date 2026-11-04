'use server';

import { revalidatePath } from 'next/cache';
import { isInsideHours } from '@dxt/engine';
import { createClient } from '@/lib/supabase/server';
import { loadResponseHours } from '@/server/escalation/response-hours';
import { flushAfter } from './flush';
import {
  downAgainSchema,
  type DownAgainInput,
  escalateNowSchema,
  incidentIdSchema,
  manualIncidentSchema,
  type EscalateNowInput,
  type ManualIncidentInput,
} from './schemas';

/**
 * By hand during a monitor fault (S12b, spec §30, D-053 item 5, D-055): the hand check on the Overview,
 * "Down — open incident", and on the Incident page Escalate now and the client-update reminder. The SQL
 * functions check who may (the Acknowledge rule), that the engine is really down, and write state,
 * timeline and audit in one transaction; what they queue leaves from this request (D-053: the sender
 * that doesn't depend on the engine), the notifier cron sweeps anything left.
 */

export type HandCheckResult = { ok: true } | { ok: false; message: string };
export type ManualIncidentResult = { ok: true; incidentId: string } | { ok: false; message: string };
export type EscalateNowResult =
  { ok: true; level: number; notified: number } | { ok: false; message: string };
export type ReminderResult = { ok: true } | { ok: false; message: string };

const FAILED = 'Couldn’t reach the server. Check your connection and try again.';

/** The SQL's refusals in words: by code, then by the hint it raises with. */
const REFUSALS: Record<string, string> = {
  '42501': 'Only the site’s owner, the person on call or an Admin can do this.',
  P0002: 'This doesn’t exist any more.',
  '22001': 'Keep it under 500 characters.',
  engine_running: 'The status engine is running again — it judges the sites and escalates on its own.',
  not_tier1: 'The hand check covers live Tier 1 sites only.',
  already_open: 'This site already has an open incident.',
  paused: 'This site is muted or in maintenance, so no alert goes out.',
  no_monitor: 'This site has no home page monitor yet.',
  level_moved: 'Someone else escalated it a moment ago — the page now shows the next level.',
  not_waiting: 'It was acknowledged — escalation has stopped.',
  no_level: 'Every level has been sent.',
  not_sent: 'That level couldn’t be sent — the DOWN alert hasn’t gone out yet.',
  already_sent: 'The client-update reminder went already.',
  not_down: 'The site isn’t down now — the engine sends the reminder if it falls due.',
  no_track: 'This site has no client update.',
  not_down_again: 'This incident is down already, or closed.',
  no_thread: 'The DOWN alert hasn’t gone out yet — try again in a moment.',
};

const refusal = (error: { code: string; hint?: string | null }) =>
  (error.hint && REFUSALS[error.hint]) || REFUSALS[error.code] || FAILED;

/** Loads OK (§30.2): recorded and logged, nothing sent. */
export async function recordHandCheck(siteId: string): Promise<HandCheckResult> {
  const id = incidentIdSchema.safeParse(siteId);
  if (!id.success) return { ok: false, message: REFUSALS.P0002! };
  const supabase = await createClient();
  const { error } = await supabase.rpc('record_hand_check', { p_site_id: id.data });
  if (error) return { ok: false, message: refusal(error) };
  revalidatePath('/');
  return { ok: true };
}

/**
 * Down — open incident (§30.2): a DOWN with trigger Manual (hand check). L0 pages the person on call
 * outside response hours (the engine's own rule, worked out here: SQL never works hours out), and the
 * DOWN line leaves at once; its emails wait out D-047's grace (D-055 item 2).
 */
export async function openManualIncident(input: ManualIncidentInput): Promise<ManualIncidentResult> {
  const parsed = manualIncidentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  const now = new Date();
  const supabase = await createClient();
  // As the user (staff read the hours); a failed read falls back to the seeded hours.
  const hours = await loadResponseHours(supabase, now);
  const { data, error } = await supabase.rpc('open_manual_incident', {
    p_site_id: parsed.data.siteId,
    p_note: parsed.data.note,
    p_outside_hours: !isInsideHours(now, hours),
  });
  if (error || !data) return { ok: false, message: error ? refusal(error) : FAILED };
  flushAfter(data, null, 'manual_incident_flush_failed');
  revalidatePath('/');
  revalidatePath('/incidents');
  return { ok: true, incidentId: data };
}

/**
 * Down again by hand (D-055 item 7): a recovered incident relapses in its thread (DOWN AGAIN), a PROBLEM
 * is raised to DOWN — what the engine would have done, from the press. Sent at once.
 */
export async function reportDownByHand(input: DownAgainInput): Promise<ManualIncidentResult> {
  const parsed = downAgainSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  const now = new Date();
  const supabase = await createClient();
  const hours = await loadResponseHours(supabase, now);
  const { error } = await supabase.rpc('report_down_by_hand', {
    p_incident_id: parsed.data.incidentId,
    p_note: parsed.data.note,
    p_outside_hours: !isInsideHours(now, hours),
  });
  if (error) return { ok: false, message: refusal(error) };
  flushAfter(parsed.data.incidentId, null, 'down_again_flush_failed');
  revalidatePath('/');
  revalidatePath(`/incidents/${parsed.data.incidentId}`);
  return { ok: true, incidentId: parsed.data.incidentId };
}

/** Escalate now (§30.6): the level the person saw, sent at once; the engine never repeats it. */
export async function escalateNow(input: EscalateNowInput): Promise<EscalateNowResult> {
  const parsed = escalateNowSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: REFUSALS.P0002! };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('escalate_now', {
    p_incident_id: parsed.data.incidentId,
    p_level: parsed.data.level,
  });
  if (error) return { ok: false, message: refusal(error) };
  const sent = (data ?? {}) as { level?: unknown; notified?: unknown };
  flushAfter(parsed.data.incidentId, null, 'escalate_now_flush_failed');
  revalidatePath(`/incidents/${parsed.data.incidentId}`);
  revalidatePath('/');
  return {
    ok: true,
    level: typeof sent.level === 'number' ? sent.level : parsed.data.level,
    notified: typeof sent.notified === 'number' ? sent.notified : 0,
  };
}

/** Send client-update reminder now (§30.7): the engine's track then never sends it again. */
export async function sendClientUpdateReminder(incidentId: string): Promise<ReminderResult> {
  const id = incidentIdSchema.safeParse(incidentId);
  if (!id.success) return { ok: false, message: REFUSALS.P0002! };
  const supabase = await createClient();
  const { error } = await supabase.rpc('send_client_update_reminder', { p_incident_id: id.data });
  if (error) return { ok: false, message: refusal(error) };
  flushAfter(id.data, null, 'client_update_reminder_flush_failed');
  revalidatePath(`/incidents/${id.data}`);
  return { ok: true };
}
