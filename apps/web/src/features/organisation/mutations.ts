import 'server-only';
import type { ServerClient } from '@/lib/supabase/server';
import { DAY_SETS } from './model';
import { takenLine } from './holidays';
import {
  addHolidaySchema,
  removeHolidaySchema,
  renameHolidaySchema,
  saveHoursSchema,
  type AddHolidayInput,
  type RenameHolidayInput,
  type SaveHoursInput,
} from './schemas';

export type SaveHoursResult = { ok: true } | { ok: false; message: string };

export interface OrganisationDeps {
  db: Pick<ServerClient, 'rpc'>;
}

/** Hints `save_response_hours` raises whose message is already the sentence to show. */
const SQL_WORDS = new Set(['note_required', 'note_too_long', 'hours_grid', 'hours_order', 'days_invalid']);

/**
 * Saves the response hours in one SQL call (Admin only; one audit row with the note). The engine and
 * the notifier read them live, so the next run uses them (D-034, D-069 item 2).
 */
export async function saveHours(input: SaveHoursInput, { db }: OrganisationDeps): Promise<SaveHoursResult> {
  const parsed = saveHoursSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the hours.' };
  const { error } = await db.rpc('save_response_hours', {
    p_start: parsed.data.from,
    p_end: parsed.data.to,
    p_days: [...DAY_SETS[parsed.data.days]],
    p_note: parsed.data.note,
  });
  if (!error) return { ok: true };
  if (error.code === '42501') return { ok: false, message: 'Only an Admin can change the response hours.' };
  if (error.hint && SQL_WORDS.has(error.hint)) return { ok: false, message: error.message };
  return { ok: false, message: 'Couldn’t save. Check your connection and try again.' };
}

// ── Company holidays (S17 PR 3a) ──────────────────────────────────────────

/** Hints the holiday functions raise whose message is already the sentence to show. */
const HOLIDAY_WORDS = new Set([
  'holiday_past',
  'holiday_too_far',
  'name_required',
  'name_too_long',
  'kind_invalid',
  'holiday_missing',
]);

type RpcError = { code?: string; hint?: string | null; message: string; details?: string | null };

function holidayRefusal(error: RpcError, day?: string): SaveHoursResult {
  if (error.code === '42501') return { ok: false, message: 'Only an Admin can change the company holidays.' };
  if (error.hint === 'holiday_taken' && day)
    return { ok: false, message: `${takenLine(day, error.details ?? 'a holiday')}.` };
  if (error.hint && HOLIDAY_WORDS.has(error.hint)) return { ok: false, message: `${error.message}.` };
  return { ok: false, message: 'Couldn’t save. Check your connection and try again.' };
}

/**
 * One holiday change in one SQL call (Admin only; the row trigger writes the audit row). The engine and
 * the notifier read the calendar live, so the next run uses it (D-034, D-069 item 2).
 */
export async function addHoliday(input: AddHolidayInput, { db }: OrganisationDeps): Promise<SaveHoursResult> {
  const parsed = addHolidaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the day.' };
  const { error } = await db.rpc('add_company_holiday', {
    p_day: parsed.data.day,
    p_name: parsed.data.name,
    p_kind: parsed.data.kind,
  });
  return error ? holidayRefusal(error, parsed.data.day) : { ok: true };
}

export async function renameHoliday(
  input: RenameHolidayInput,
  { db }: OrganisationDeps,
): Promise<SaveHoursResult> {
  const parsed = renameHolidaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the name.' };
  const { error } = await db.rpc('rename_company_holiday', {
    p_id: parsed.data.id,
    p_name: parsed.data.name,
  });
  return error ? holidayRefusal(error) : { ok: true };
}

export async function removeHoliday(id: string, { db }: OrganisationDeps): Promise<SaveHoursResult> {
  const parsed = removeHolidaySchema.safeParse({ id });
  if (!parsed.success) return { ok: false, message: 'That holiday is gone — reload the page.' };
  const { error } = await db.rpc('remove_company_holiday', { p_id: parsed.data.id });
  return error ? holidayRefusal(error) : { ok: true };
}
