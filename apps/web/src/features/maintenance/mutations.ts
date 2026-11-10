import 'server-only';
import type { ServerClient } from '@/lib/supabase/server';
import { UNDO_WINDOW_SEC } from '@dxt/shared';
import { PROBLEM_WORDS, whenText } from './model';
import {
  approveSchema,
  createSeriesSchema,
  seriesDecisionSchema,
  seriesIdSchema,
  seriesReasonSchema,
  type CreateSeriesInput,
  type SeriesDecisionInput,
  type SeriesIdInput,
  type SeriesReasonInput,
  createMaintenanceSchema,
  editWindowSchema,
  muteSiteSchema,
  windowIdSchema,
  windowReasonSchema,
  type ApproveInput,
  type CreateMaintenanceInput,
  type EditWindowInput,
  type MuteSiteInput,
  type WindowIdInput,
  type WindowReasonInput,
} from './schemas';

export interface MaintenanceDeps {
  db: Pick<ServerClient, 'rpc' | 'from'>;
}

/**
 * `postsAt`: an undoable action's messages are held until then (§24.8, D-037) — the toast counts down
 * to it and offers Undo; create and mute post at once.
 */
export type WindowResult =
  | {
      ok: true;
      id?: string;
      waiting?: boolean;
      postsAt?: string;
      admins?: string[];
      /** A series: the windows it has now (create, approve — §32.2, 7a). */
      windows?: string[];
    }
  | { ok: false; message: string };

/** When an undoable action's held messages go: the window's `undo_until`, set by the RPC. */
async function held(db: MaintenanceDeps['db'], windowId: string): Promise<WindowResult> {
  const { data } = await db.from('maintenance_windows').select('undo_until').eq('id', windowId).maybeSingle();
  // The rows are held either way: if the read fails, the toast still counts down (the RPC held 10 s).
  return {
    ok: true,
    postsAt: data?.undo_until ?? new Date(Date.now() + UNDO_WINDOW_SEC * 1000).toISOString(),
  };
}

const FAILED = 'Couldn’t save. Check your connection and try again.';
const NOT_ALLOWED = 'Only an Admin, or the site’s owner or backup, can do that.';

/** "Overlaps WeCare Studio 09:30 → 14:00 — edit that one instead" from the RPC's detail (§23.10). */
export function overlapWords(detail: string | null | undefined, now = new Date()): string | null {
  const [site, start, end] = (detail ?? '').split('|');
  if (!site || !start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  return `Overlaps ${site} ${whenText(s, now)} → ${whenText(e, now)} — edit that one instead.`;
}

/** A refusal from the window RPCs in words (D-036: 42501 role, 22023 + hint). */
function refusal(
  error: { code?: string; hint?: string | null; details?: string | null; message: string },
  notAllowed = NOT_ALLOWED,
): WindowResult {
  if (error.code === '42501') return { ok: false, message: notAllowed };
  if (error.code === 'P0002') return { ok: false, message: 'It no longer exists — reload the page.' };
  if (error.hint === 'overlap') {
    const words = overlapWords(error.details);
    if (words) return { ok: false, message: words };
  }
  const words = error.hint ? PROBLEM_WORDS[error.hint as keyof typeof PROBLEM_WORDS] : undefined;
  return { ok: false, message: words ?? FAILED };
}

const first = (issues: { message: string }[]) => ({
  ok: false as const,
  message: issues[0]?.message ?? FAILED,
});

export async function createMaintenance(
  input: CreateMaintenanceInput,
  { db }: MaintenanceDeps,
): Promise<WindowResult> {
  const p = createMaintenanceSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { data, error } = await db.rpc('create_maintenance', {
    p_site_id: p.data.siteId,
    p_starts_at: p.data.startsAt,
    p_ends_at: p.data.endsAt,
    p_reason: p.data.reason,
  });
  if (error) return refusal(error);
  // Whether it waits for an Admin: back to back with its neighbours it can, where the draft alone didn't.
  const { data: row } = await db
    .from('maintenance_windows')
    .select('approved_at')
    .eq('id', data)
    .maybeSingle();
  const waiting = row ? !row.approved_at : undefined;
  return {
    ok: true,
    id: data ?? undefined,
    waiting,
    ...(waiting ? { admins: await activeAdminNames({ db }) } : {}),
  };
}

/** Every active Admin's name, for "Tao gets a request now" / "Request sent to Tao" (§24.9). */
export async function activeAdminNames({ db }: MaintenanceDeps): Promise<string[]> {
  const { data } = await db
    .from('profiles')
    .select('display_name')
    .eq('role', 'admin')
    .eq('is_active', true)
    .order('display_name');
  return (data ?? []).map((p) => p.display_name);
}

export async function muteSite(input: MuteSiteInput, { db }: MaintenanceDeps): Promise<WindowResult> {
  const p = muteSiteSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { data, error } = await db.rpc('mute_site', {
    p_site_id: p.data.siteId,
    p_ends_at: p.data.endsAt,
    p_reason: p.data.reason,
  });
  return error ? refusal(error) : { ok: true, id: data ?? undefined };
}

export async function endWindowEarly(
  input: WindowReasonInput,
  { db }: MaintenanceDeps,
): Promise<WindowResult> {
  const p = windowReasonSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('end_window_early', {
    p_window_id: p.data.windowId,
    p_reason: p.data.reason,
  });
  return error ? refusal(error) : held(db, p.data.windowId);
}

export async function editWindowEnd(input: EditWindowInput, { db }: MaintenanceDeps): Promise<WindowResult> {
  const p = editWindowSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('edit_window_end', {
    p_window_id: p.data.windowId,
    p_ends_at: p.data.endsAt,
    p_reason: p.data.reason,
  });
  return error ? refusal(error) : held(db, p.data.windowId);
}

export async function cancelWindow(input: WindowReasonInput, { db }: MaintenanceDeps): Promise<WindowResult> {
  const p = windowReasonSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('cancel_window', { p_window_id: p.data.windowId, p_reason: p.data.reason });
  return error ? refusal(error) : held(db, p.data.windowId);
}

export async function withdrawRequest(
  input: WindowReasonInput,
  { db }: MaintenanceDeps,
): Promise<WindowResult> {
  const p = windowReasonSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('withdraw_request', {
    p_window_id: p.data.windowId,
    p_reason: p.data.reason,
  });
  return error
    ? refusal(error, 'Only the asker or the site’s owner or backup can withdraw it.')
    : held(db, p.data.windowId);
}

export async function declineMaintenance(
  input: WindowReasonInput,
  { db }: MaintenanceDeps,
): Promise<WindowResult> {
  const p = windowReasonSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('decline_maintenance', {
    p_window_id: p.data.windowId,
    p_reason: p.data.reason,
  });
  return error ? refusal(error, 'Only an Admin can decline maintenance.') : held(db, p.data.windowId);
}

export async function approveMaintenance(
  input: ApproveInput,
  { db }: MaintenanceDeps,
): Promise<WindowResult> {
  const p = approveSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('approve_maintenance', {
    p_window_id: p.data.windowId,
    p_ends_at: p.data.endsAt,
  });
  return error ? refusal(error, 'Only an Admin can approve maintenance.') : held(db, p.data.windowId);
}

/** Undo the last held action on a window (§24.8): the person who did it, inside its 10 s. */
/** Posts a held action at once (§24.12): its actor moved on to the next one. */
export async function postWindowActionNow(
  input: WindowIdInput,
  { db }: MaintenanceDeps,
): Promise<WindowResult> {
  const p = windowIdSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('post_window_action_now', { p_window_id: p.data.windowId });
  return error ? refusal(error, 'Only the person who did it can post it now.') : { ok: true };
}

export async function undoWindowAction(input: WindowIdInput, { db }: MaintenanceDeps): Promise<WindowResult> {
  const p = windowIdSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('undo_window_action', { p_window_id: p.data.windowId });
  return error ? refusal(error, 'Only the person who did it can undo it.') : { ok: true };
}

// ── Repeating series (D-057, spec §32) ────────────────────────────────────────────────────────────

/** When a series action's held messages go: the series' `undo_until`, set by the RPC (§32 7a). */
async function heldSeries(db: MaintenanceDeps['db'], seriesId: string): Promise<WindowResult> {
  const { data } = await db.from('maintenance_series').select('undo_until').eq('id', seriesId).maybeSingle();
  return {
    ok: true,
    id: seriesId,
    postsAt: data?.undo_until ?? new Date(Date.now() + UNDO_WINDOW_SEC * 1000).toISOString(),
  };
}

/**
 * Schedule a series (an Admin's is approved at once; a Responder's waits). Posts at once, as a one-off
 * window's create does; returns the windows it made now for the success line (§32.2).
 */
export async function createSeries(
  input: CreateSeriesInput,
  { db }: MaintenanceDeps,
): Promise<WindowResult & { windows?: string[] }> {
  const p = createSeriesSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { data: id, error } = await db.rpc('create_maintenance_series', {
    p_site_id: p.data.siteId,
    p_rule: p.data.rule,
    p_start_time: p.data.startTime,
    p_duration_min: p.data.durationMin,
    p_starts_on: p.data.startsOn,
    p_until_on: p.data.untilOn as string,
    p_reason: p.data.reason,
  });
  if (error || !id) return error ? refusal(error) : { ok: false, message: FAILED };
  const [series, windows] = await Promise.all([
    db.from('maintenance_series').select('approved_at').eq('id', id).maybeSingle(),
    db.from('maintenance_windows').select('starts_at').eq('series_id', id).order('starts_at'),
  ]);
  const waiting = !series.data?.approved_at;
  return {
    ok: true,
    id,
    waiting,
    windows: (windows.data ?? []).map((w) => w.starts_at),
    ...(waiting ? { admins: await activeAdminNames({ db }) } : {}),
  };
}

export async function decideSeries(
  input: SeriesDecisionInput,
  { db }: MaintenanceDeps,
): Promise<WindowResult> {
  const p = seriesDecisionSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  if (!p.data.approve && !p.data.reason) return { ok: false, message: 'Type a reason — the asker gets it.' };
  const { error } = await db.rpc('decide_maintenance_series', {
    p_series_id: p.data.seriesId,
    p_approve: p.data.approve,
    p_reason: p.data.reason,
  });
  if (error) return refusal(error, 'Only an Admin can approve or decline a series.');
  const held = await heldSeries(db, p.data.seriesId);
  if (!p.data.approve || !held.ok) return held;
  // The toast says how many windows the approval made ("… · 4 windows scheduled", §32 7a).
  const { data } = await db
    .from('maintenance_windows')
    .select('starts_at')
    .eq('series_id', p.data.seriesId)
    .order('starts_at');
  return { ...held, windows: (data ?? []).map((w) => w.starts_at) };
}

/** Cancel a series, or withdraw a waiting one (the asker) — the RPC tells the two apart. */
export async function cancelSeries(input: SeriesReasonInput, { db }: MaintenanceDeps): Promise<WindowResult> {
  const p = seriesReasonSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('cancel_maintenance_series', {
    p_series_id: p.data.seriesId,
    p_reason: p.data.reason,
  });
  return error ? refusal(error) : heldSeries(db, p.data.seriesId);
}

export async function postSeriesActionNow(
  input: SeriesIdInput,
  { db }: MaintenanceDeps,
): Promise<WindowResult> {
  const p = seriesIdSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('post_series_action_now', { p_series_id: p.data.seriesId });
  return error ? refusal(error, 'Only the person who did it can post it now.') : { ok: true };
}

export async function undoSeriesAction(input: SeriesIdInput, { db }: MaintenanceDeps): Promise<WindowResult> {
  const p = seriesIdSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('undo_series_action', { p_series_id: p.data.seriesId });
  return error ? refusal(error, 'Only the person who did it can undo it.') : { ok: true };
}
