import 'server-only';
import type { ServerClient } from '@/lib/supabase/server';
import {
  changeRoleSchema,
  chatIdSchema,
  deactivateSchema,
  inviteSchema,
  revokeSchema,
  type ChangeRoleInput,
  type ChatIdInput,
  type DeactivateInput,
  type InviteInput,
  type RevokeInput,
} from './schemas';

export interface UsersDeps {
  db: Pick<ServerClient, 'rpc'>;
}

/** `outcome`: an invite's `invited` / `reactivated` (D-062 item 2). */
export type UsersResult = { ok: true; outcome?: string } | { ok: false; message: string; stale?: boolean };

const FAILED = 'Couldn’t save. Check your connection and try again.';

/** The S16 functions' refusals in words (migration 20261114041445, D-062). */
export const PROBLEM_WORDS: Record<string, string> = {
  bad_email: 'Enter their primary Google address, e.g. name@company.',
  bad_domain:
    'Only addresses on the company’s Google Workspace domain can sign in — use their primary address, not a DxT alias.',
  bad_role: 'Pick Admin, Responder, Stakeholder or Viewer.',
  already_member: 'They already have access.',
  already_invited: 'That address is already on the list — revoke it first to pick another role.',
  not_pending: 'They’ve signed in already — deactivate them instead.',
  reason_required: 'Add a short reason — it goes in the audit log.',
  reason_too_long: 'Keep it under 500 characters.',
  self: 'You can’t change your own access — ask another Admin.',
  same_role: 'They have that role already.',
  last_admin: 'They’re the only active Admin — invite another Admin first.',
  needs_reassign: 'Something changed meanwhile — pick who takes over the places shown now.',
  am_not_eligible: 'A Site AM must be an active Admin, Responder or Stakeholder.',
  rotation_last: 'They’re the only person in the on-call rotation — add someone on On-call first.',
  rotation_person: 'Only active Admins and Responders can be on call.',
  handover_same: 'Pick someone else for the shifts.',
  owners_not_eligible: 'Only an active Admin or Responder can own a site.',
  owners_missing_chat_id: 'Owners need a Google Chat id — add theirs first.',
  chat_id_digits: 'A Chat user id is digits only.',
  chat_id_taken: 'That Chat id belongs to someone else.',
  owner_needs_chat: 'They own a live site, so they need a Chat id — reassign the site first.',
};

/** Refusals that mean the page is out of date: reload it so "Used in" shows what's there now. */
const STALE = new Set(['needs_reassign', 'P0002']);

type DbError = { code?: string; hint?: string | null; message: string };

export function refusal(error: DbError, notAllowed: string): UsersResult {
  const words = error.hint ? PROBLEM_WORDS[error.hint] : undefined;
  const stale = STALE.has(error.hint ?? '') || error.code === 'P0002';
  if (words) return { ok: false, message: words, ...(stale ? { stale } : {}) };
  if (error.code === '42501') return { ok: false, message: notAllowed };
  if (error.code === 'P0002')
    return { ok: false, message: 'They no longer have access — reload the page.', stale };
  // Two Admins at once, or a site saved meanwhile (S16 review): nothing was saved.
  if (error.code === '40P01' || error.code === '55P03')
    return { ok: false, message: 'Someone else changed this at the same time — try again.' };
  console.error(
    JSON.stringify({ event: 'users_refusal', code: error.code, hint: error.hint, message: error.message }),
  );
  return { ok: false, message: FAILED };
}

const first = (issues: { message: string }[]): UsersResult => ({
  ok: false,
  message: issues[0]?.message ?? FAILED,
});

const ONLY_ADMIN = 'Only an Admin can change people’s access.';

export async function inviteUser(input: InviteInput, { db }: UsersDeps): Promise<UsersResult> {
  const p = inviteSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { data, error } = await db.rpc('invite_user', { p_email: p.data.email, p_role: p.data.role });
  return error ? refusal(error, ONLY_ADMIN) : { ok: true, outcome: data ?? 'invited' };
}

export async function revokeInvite(input: RevokeInput, { db }: UsersDeps): Promise<UsersResult> {
  const p = revokeSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('revoke_invite', { p_email: p.data.email, p_reason: p.data.reason });
  return error ? refusal(error, ONLY_ADMIN) : { ok: true };
}

export async function changeUserRole(input: ChangeRoleInput, { db }: UsersDeps): Promise<UsersResult> {
  const p = changeRoleSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('change_user_role', {
    p_user_id: p.data.userId,
    p_role: p.data.role,
    p_reassign: p.data.reassign,
  });
  return error ? refusal(error, ONLY_ADMIN) : { ok: true };
}

export async function deactivateUser(input: DeactivateInput, { db }: UsersDeps): Promise<UsersResult> {
  const p = deactivateSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('deactivate_user', {
    p_user_id: p.data.userId,
    p_reassign: p.data.reassign,
  });
  return error ? refusal(error, ONLY_ADMIN) : { ok: true };
}

export async function setChatId(input: ChatIdInput, { db }: UsersDeps): Promise<UsersResult> {
  const p = chatIdSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  // An empty id clears it (the SQL reads blank as none).
  const { error } = await db.rpc('set_chat_user_id', { p_user_id: p.data.userId, p_chat_id: p.data.chatId });
  return error ? refusal(error, 'Only an Admin can change someone else’s Chat id.') : { ok: true };
}
