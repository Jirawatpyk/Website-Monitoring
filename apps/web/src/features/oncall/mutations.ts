import 'server-only';
import type { ServerClient } from '@/lib/supabase/server';
import {
  checklistSchema,
  decideSwapSchema,
  handOverSchema,
  requestSwapSchema,
  respondSwapSchema,
  saveRotationSchema,
  swapIdSchema,
  testTokenSchema,
  type ChecklistInput,
  type DecideSwapInput,
  type HandOverInput,
  type RequestSwapInput,
  type RespondSwapInput,
  type SaveRotationInput,
  type SwapIdInput,
  type TestTokenInput,
} from './schemas';

export interface OncallDeps {
  db: Pick<ServerClient, 'rpc'>;
}

/** `at`: the moment the RPC returned (the test sent or received, the swap id). */
export type OncallResult =
  | { ok: true; id?: string; at?: string }
  | { ok: false; message: string; code?: 'test_other_person' | 'test_expired' };

const FAILED = 'Couldn’t save. Check your connection and try again.';

/**
 * The on-call RPCs' refusals in words (B0, D-048). The SQL's own sentences that predate D-048 item 5
 * ("hand it over in Users") are reworded for this page, where Hand over lives.
 */
export const PROBLEM_WORDS: Record<string, string> = {
  rotation_empty: 'Add at least one person to the rotation.',
  rotation_duplicate: 'Each person can be in the rotation once.',
  rotation_person: 'Only active Admins and Responders can be on call.',
  swap_same_person: 'Pick a week someone else has.',
  swap_live: 'The live shift can’t be swapped — use Hand over… on its row.',
  swap_open: 'A swap is already waiting on one of those weeks.',
  swap_too_soon: 'Too many swap requests — wait a few minutes.',
  swap_closed: 'This request is closed — reload the page to see what happened.',
  swap_not_accepted: 'Approve unlocks once the person asked accepts.',
  swap_self: 'Another Admin decides on a swap you’re part of.',
  swap_reason: 'Say why — both of them see this.',
  handover_reason: 'Add a short reason — both of them see it.',
  handover_same: 'Pick someone else.',
  handover_over: 'That shift is over.',
  test_too_soon: 'A test alert went less than a minute ago — wait a moment.',
  reason_too_long: 'Keep it under 500 characters.',
};

type DbError = { code?: string; hint?: string | null; message: string };

function refusal(error: DbError, notAllowed: string): OncallResult {
  if (error.hint === 'test_other_person')
    return { ok: false, message: error.message, code: 'test_other_person' };
  const words = error.hint ? PROBLEM_WORDS[error.hint] : undefined;
  // A refusal the page has words for (a 42501 like swap_self, D-048 12.17) says why, not just "not allowed".
  if (words) return { ok: false, message: words };
  if (error.code === '42501') return { ok: false, message: notAllowed };
  if (error.code === 'P0002') return { ok: false, message: 'It no longer exists — reload the page.' };
  // A refusal with no words is a bug or an outage: log what the database said (never the input).
  if (!words)
    console.error(JSON.stringify({ event: 'oncall_refusal', code: error.code, message: error.message }));
  return { ok: false, message: words ?? FAILED };
}

const first = (issues: { message: string }[]): OncallResult => ({
  ok: false,
  message: issues[0]?.message ?? FAILED,
});

const ONLY_STAFF = 'Only Admins and Responders take on-call weeks.';

export async function saveRotation(input: SaveRotationInput, { db }: OncallDeps): Promise<OncallResult> {
  const p = saveRotationSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('save_oncall_rotation', { p_user_ids: p.data.userIds });
  return error ? refusal(error, 'Only an Admin can change the rotation.') : { ok: true };
}

export async function requestSwap(input: RequestSwapInput, { db }: OncallDeps): Promise<OncallResult> {
  const p = requestSwapSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { data, error } = await db.rpc('request_oncall_swap', {
    p_shift_id: p.data.shiftId,
    p_with_shift_id: p.data.withShiftId,
    ...(p.data.reason ? { p_reason: p.data.reason } : {}),
  });
  return error
    ? refusal(error, 'You can ask to swap only your own week.')
    : { ok: true, id: data ?? undefined };
}

export async function respondSwap(input: RespondSwapInput, { db }: OncallDeps): Promise<OncallResult> {
  const p = respondSwapSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('respond_oncall_swap', {
    p_swap_id: p.data.swapId,
    p_accept: p.data.accept,
    ...(p.data.note ? { p_note: p.data.note } : {}),
  });
  return error
    ? refusal(error, 'Only the person asked can answer this request.')
    : { ok: true, id: p.data.swapId };
}

export async function decideSwap(input: DecideSwapInput, { db }: OncallDeps): Promise<OncallResult> {
  const p = decideSwapSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('decide_oncall_swap', {
    p_swap_id: p.data.swapId,
    p_approve: p.data.approve,
    ...(p.data.approve ? {} : { p_note: p.data.note }),
  });
  return error
    ? refusal(error, 'Only an Admin can approve or decline a swap.')
    : { ok: true, id: p.data.swapId };
}

export async function withdrawSwap(input: SwapIdInput, { db }: OncallDeps): Promise<OncallResult> {
  const p = swapIdSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('withdraw_oncall_swap', { p_swap_id: p.data.swapId });
  return error
    ? refusal(error, 'Only the person who asked can withdraw it.')
    : { ok: true, id: p.data.swapId };
}

export async function handOver(input: HandOverInput, { db }: OncallDeps): Promise<OncallResult> {
  const p = handOverSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { data, error } = await db.rpc('hand_over_oncall_shift', {
    p_shift_id: p.data.shiftId,
    p_to: p.data.to,
    p_at: p.data.at,
    p_reason: p.data.reason,
  });
  return error ? refusal(error, 'Only an Admin can hand over a shift.') : { ok: true, id: data ?? undefined };
}

export async function setChecklist(input: ChecklistInput, { db }: OncallDeps): Promise<OncallResult> {
  const p = checklistSchema.safeParse(input);
  if (!p.success) return first(p.error.issues);
  const { error } = await db.rpc('set_oncall_checklist', {
    p_mentions_only: p.data.mentionsOnly,
    p_dnd_allowed: p.data.dndAllowed,
  });
  return error ? refusal(error, ONLY_STAFF) : { ok: true };
}

export async function sendTest(_input: Record<string, never>, { db }: OncallDeps): Promise<OncallResult> {
  const { data, error } = await db.rpc('send_oncall_test');
  return error ? refusal(error, ONLY_STAFF) : { ok: true, at: data ?? undefined };
}

/** The test link opened on a phone: only the person it was for ticks it (§27.8). */
export async function confirmTest(input: TestTokenInput, { db }: OncallDeps): Promise<OncallResult> {
  const p = testTokenSchema.safeParse(input);
  if (!p.success)
    return {
      ok: false,
      message: 'This test link has expired — send a new test alert.',
      code: 'test_expired',
    };
  const { data, error } = await db.rpc('confirm_oncall_test', { p_token: p.data.token });
  if (error?.code === 'P0002') {
    return {
      ok: false,
      message: 'This test link has expired — send a new test alert.',
      code: 'test_expired',
    };
  }
  return error ? refusal(error, 'Sign in first.') : { ok: true, at: data ?? undefined };
}
