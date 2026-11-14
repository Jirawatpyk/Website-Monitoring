'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import type { OncallData } from '@/features/oncall';
import { getOncallPage } from '@/features/oncall/server';
import { getAccess } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { serviceDb } from '@/server/db';
import { notifierDeps } from '@/server/notifier/deps';
import { dispatchNotifications } from '@/server/notifier/dispatch';
import * as m from './mutations';
import type { UsersResult } from './mutations';
import type {
  ChangeRoleInput,
  ChatIdInput,
  DeactivateInput,
  InviteInput,
  RevokeInput,
  SignOutDeviceInput,
  SignOutUserInput,
} from './schemas';

/**
 * Users & roles as the signed-in Admin (S16, D-062). The SQL checks the role again, applies the
 * reassignments and writes every audit row in one transaction. A role change or deactivation can hand
 * over shifts and close swaps, whose on-call messages leave from this request.
 */
async function run<T>(
  input: T,
  fn: (input: T, deps: m.UsersDeps) => Promise<UsersResult>,
  { send = false, adminOnly = true }: { send?: boolean; adminOnly?: boolean } = {},
): Promise<UsersResult> {
  const access = await getAccess();
  if (access.status !== 'active') return { ok: false, message: 'Sign in again to continue.' };
  if (adminOnly && access.profile.role !== 'admin')
    return { ok: false, message: 'Only an Admin can change people’s access.' };
  const result = await fn(input, { db: await createClient() });
  if (result.ok) {
    if (send)
      after(async () => {
        try {
          await dispatchNotifications(notifierDeps(serviceDb(), serverEnv()), {
            deadline: Date.now() + 30_000,
          });
        } catch (err) {
          console.error(JSON.stringify({ event: 'users_flush_failed', error: String(err) }));
        }
      });
    revalidatePath('/settings/users');
    revalidatePath('/settings/security');
    revalidatePath('/profile');
    revalidatePath('/oncall');
    revalidatePath('/');
  }
  return result;
}

export async function inviteUser(input: InviteInput) {
  return run(input, m.inviteUser);
}
export async function revokeInvite(input: RevokeInput) {
  return run(input, m.revokeInvite);
}
export async function changeUserRole(input: ChangeRoleInput) {
  return run(input, m.changeUserRole, { send: true });
}
export async function deactivateUser(input: DeactivateInput) {
  return run(input, m.deactivateUser, { send: true });
}
/**
 * The On-call page's data for Hand over shift… (D-048 item 5), read only when the dialog opens — not
 * on every Users render, since someone is nearly always on call (S16 code review). Admin only.
 */
export async function loadHandover(): Promise<OncallData | null> {
  const access = await getAccess();
  if (access.status !== 'active' || access.profile.role !== 'admin') return null;
  return getOncallPage({ id: access.profile.id, name: access.profile.displayName, role: 'admin' }, null);
}

/** Anyone their own (Profile, PR 3), an Admin anyone's — the SQL holds that rule. */
export async function setChatId(input: ChatIdInput) {
  return run(input, m.setChatId, { adminOnly: false });
}

/** Security: an Admin signs someone out on every device (D-062 item 5). */
export async function signOutEverywhere(input: SignOutUserInput) {
  return run(input, m.signOutEverywhere);
}
/** Security's own row: every device of yours but this browser. */
export async function signOutOtherDevices() {
  return run({}, m.signOutOtherDevices, { adminOnly: false });
}
/** Profile: one of your own devices. */
export async function signOutDevice(input: SignOutDeviceInput) {
  return run(input, m.signOutDevice, { adminOnly: false });
}
