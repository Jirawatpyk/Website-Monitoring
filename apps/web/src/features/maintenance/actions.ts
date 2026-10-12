'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getAccess } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { serviceDb } from '@/server/db';
import { notifierDeps } from '@/server/notifier/deps';
import { dispatchNotifications } from '@/server/notifier/dispatch';
import * as m from './mutations';
import type { WindowResult } from './mutations';
import type {
  ApproveInput,
  CreateMaintenanceInput,
  EditWindowInput,
  MuteSiteInput,
  WindowIdInput,
  WindowReasonInput,
} from './schemas';

/** The claim takes rows whose hold_until <= the database's now: 2 s of margin for clock skew. */
const FLUSH_MARGIN_MS = 2_000;

/**
 * Sends the window's messages from this request — at once for create and mute, just after the 10 s
 * Undo for the rest (§24.8). The notifier cron sweeps up anything left within a minute.
 */
function flush(postsAt: string | undefined) {
  after(async () => {
    if (postsAt) {
      await new Promise((r) =>
        setTimeout(r, Math.max(0, Date.parse(postsAt) - Date.now()) + FLUSH_MARGIN_MS),
      );
    }
    try {
      await dispatchNotifications(notifierDeps(serviceDb(), serverEnv()), { deadline: Date.now() + 30_000 });
    } catch (err) {
      console.error(JSON.stringify({ event: 'maintenance_flush_failed', error: String(err) }));
    }
  });
}

/**
 * Maintenance and mute as the signed-in person (D-036). The SQL functions decide who may act (Admin any
 * site, Responder own sites, approving Admin only) and write the audit row in the same transaction.
 */
async function run<T>(
  input: T,
  fn: (input: T, deps: m.MaintenanceDeps) => Promise<WindowResult>,
  siteId?: string,
  { send = true }: { send?: boolean } = {},
): Promise<WindowResult> {
  const access = await getAccess();
  if (access.status !== 'active') return { ok: false, message: 'Sign in again to continue.' };
  const result = await fn(input, { db: await createClient() });
  if (result.ok) {
    // An Undo queued nothing: only actions send.
    if (send) flush(result.postsAt);
    revalidatePath('/');
    revalidatePath('/sites');
    revalidatePath('/maintenance');
    if (siteId) revalidatePath(`/sites/${siteId}`);
  }
  return result;
}

export async function scheduleMaintenance(input: CreateMaintenanceInput) {
  return run(input, m.createMaintenance, input.siteId);
}
export async function muteSite(input: MuteSiteInput) {
  return run(input, m.muteSite, input.siteId);
}
export async function endWindowEarly(input: WindowReasonInput) {
  return run(input, m.endWindowEarly);
}
export async function editWindowEnd(input: EditWindowInput) {
  return run(input, m.editWindowEnd);
}
export async function cancelWindow(input: WindowReasonInput) {
  return run(input, m.cancelWindow);
}
export async function withdrawRequest(input: WindowReasonInput) {
  return run(input, m.withdrawRequest);
}
export async function declineMaintenance(input: WindowReasonInput) {
  return run(input, m.declineMaintenance);
}
export async function approveMaintenance(input: ApproveInput) {
  return run(input, m.approveMaintenance);
}
/** The Admins a Responder's request goes to, named in the dialog before it is sent (§24.9). */
export async function loadAdminNames(): Promise<string[]> {
  const access = await getAccess();
  if (access.status !== 'active') return [];
  return m.activeAdminNames({ db: await createClient() });
}
/** The pending action posts now: its messages leave at once (no postsAt → flush now). */
export async function postWindowActionNow(input: WindowIdInput) {
  return run(input, m.postWindowActionNow);
}
export async function undoWindowAction(input: WindowIdInput) {
  return run(input, m.undoWindowAction, undefined, { send: false });
}
