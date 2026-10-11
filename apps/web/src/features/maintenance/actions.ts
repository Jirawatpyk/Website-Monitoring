'use server';

import { revalidatePath } from 'next/cache';
import { getAccess } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import * as m from './mutations';
import type { WindowResult } from './mutations';
import type {
  ApproveInput,
  CreateMaintenanceInput,
  EditWindowInput,
  MuteSiteInput,
  WindowReasonInput,
} from './schemas';

/**
 * Maintenance and mute as the signed-in person (D-036). The SQL functions decide who may act (Admin any
 * site, Responder own sites, approving Admin only) and write the audit row in the same transaction.
 */
async function run<T>(
  input: T,
  fn: (input: T, deps: m.MaintenanceDeps) => Promise<WindowResult>,
  siteId?: string,
): Promise<WindowResult> {
  const access = await getAccess();
  if (access.status !== 'active') return { ok: false, message: 'Sign in again to continue.' };
  const result = await fn(input, { db: await createClient() });
  if (result.ok) {
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
