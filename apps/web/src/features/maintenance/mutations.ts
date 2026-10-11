import 'server-only';
import type { ServerClient } from '@/lib/supabase/server';
import { PROBLEM_WORDS } from './model';
import {
  approveSchema,
  createMaintenanceSchema,
  editWindowSchema,
  muteSiteSchema,
  windowReasonSchema,
  type ApproveInput,
  type CreateMaintenanceInput,
  type EditWindowInput,
  type MuteSiteInput,
  type WindowReasonInput,
} from './schemas';

export interface MaintenanceDeps {
  db: Pick<ServerClient, 'rpc'>;
}

export type WindowResult = { ok: true; id?: string } | { ok: false; message: string };

const FAILED = 'Couldn’t save. Check your connection and try again.';
const NOT_ALLOWED = 'Only an Admin, or the site’s owner or backup, can do that.';

/** A refusal from the window RPCs in words (D-036: 42501 role, 22023 + hint). */
function refusal(
  error: { code?: string; hint?: string | null; message: string },
  notAllowed = NOT_ALLOWED,
): WindowResult {
  if (error.code === '42501') return { ok: false, message: notAllowed };
  if (error.code === 'P0002') return { ok: false, message: 'It no longer exists — reload the page.' };
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
  return error ? refusal(error) : { ok: true, id: data ?? undefined };
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
  return error ? refusal(error) : { ok: true };
}

export async function editWindowEnd(input: EditWindowInput, { db }: MaintenanceDeps): Promise<WindowResult> {
  const p = editWindowSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('edit_window_end', {
    p_window_id: p.data.windowId,
    p_ends_at: p.data.endsAt,
    p_reason: p.data.reason,
  });
  return error ? refusal(error) : { ok: true };
}

export async function cancelWindow(input: WindowReasonInput, { db }: MaintenanceDeps): Promise<WindowResult> {
  const p = windowReasonSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('cancel_window', { p_window_id: p.data.windowId, p_reason: p.data.reason });
  return error ? refusal(error) : { ok: true };
}

export async function approveMaintenance(
  input: ApproveInput,
  { db }: MaintenanceDeps,
): Promise<WindowResult> {
  const p = approveSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('approve_maintenance', { p_window_id: p.data.windowId });
  return error ? refusal(error, 'Only an Admin can approve maintenance.') : { ok: true };
}
