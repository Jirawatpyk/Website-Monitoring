import 'server-only';
import { z } from 'zod';
import type { ServerClient } from '@/lib/supabase/server';
import { DAY_SETS } from './model';
import { takenLine } from './holidays';
import { REFUSAL_WORDS, type PhraseCheck } from './phrases';
import {
  addHolidaySchema,
  addPhraseSchema,
  checkPhraseSchema,
  removePhraseSchema,
  type AddPhraseInput,
  type RemovePhraseInput,
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
  // The deploy runs before `migrate-production`: for those minutes the functions don't exist yet.
  if (error.code === 'PGRST202')
    return { ok: false, message: 'Holidays can’t be changed for a minute — try again shortly.' };
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

// ── Shared forbidden words (S17 PR 3c) ──────────────────────────────────────

/** Hints the phrase functions raise whose message is already the sentence to show. */
const PHRASE_WORDS = new Set([
  'note_required',
  'note_too_long',
  'group_invalid',
  'phrase_required',
  'phrase_too_long',
  'phrases_full',
  'phrase_missing',
  'group_last',
]);

function phraseRefusalWords(error: RpcError): SaveHoursResult {
  if (error.code === '42501')
    return { ok: false, message: 'Only an Admin can change the shared forbidden words.' };
  if (error.hint === 'phrase_short') return { ok: false, message: REFUSAL_WORDS.short };
  if (error.hint === 'phrase_markup') return { ok: false, message: REFUSAL_WORDS.markup };
  if (error.hint === 'phrase_taken' || error.code === '23505')
    return { ok: false, message: REFUSAL_WORDS.taken };
  if (error.hint === 'phrase_found')
    return {
      ok: false,
      message: `Found on ${error.details ?? 'a live site'}’s home page — change the phrase and check again.`,
    };
  if (error.hint && PHRASE_WORDS.has(error.hint)) return { ok: false, message: `${error.message}.` };
  // The deploy runs before `migrate-production`: for those minutes the functions don't exist yet.
  if (error.code === 'PGRST202')
    return { ok: false, message: 'Forbidden words can’t be changed for a minute — try again shortly.' };
  return { ok: false, message: 'Couldn’t save. Check your connection and try again.' };
}

const phraseCheckSchema = z.object({
  sites: z.number().int(),
  checked: z.number().int(),
  unchecked: z.array(z.string()),
  found: z.number().int(),
  hits: z.array(z.object({ site: z.string(), view: z.string(), checkedAt: z.string(), snippet: z.string() })),
});

export type CheckPhraseResult = { ok: true; check: PhraseCheck } | { ok: false; message: string };

/** "Check phrase": where the phrase is found on the live sites' stored clean pages (Admin only). */
export async function checkPhrase(phrase: string, { db }: OrganisationDeps): Promise<CheckPhraseResult> {
  const parsed = checkPhraseSchema.safeParse({ phrase });
  if (!parsed.success) return { ok: false, message: REFUSAL_WORDS.too_long };
  const { data, error } = await db.rpc('check_forbidden_phrase', { p_phrase: parsed.data.phrase });
  if (error) {
    if (error.code === '42501') return { ok: false, message: 'Only an Admin can check a forbidden phrase.' };
    if (error.code === 'PGRST202')
      return { ok: false, message: 'Phrases can’t be checked for a minute — try again shortly.' };
    return { ok: false, message: 'Couldn’t check. Check your connection and try again.' };
  }
  const check = phraseCheckSchema.safeParse(data);
  return check.success
    ? { ok: true, check: check.data }
    : { ok: false, message: 'Couldn’t check. Try again.' };
}

/**
 * Adds one phrase (Admin, a note). The SQL runs every rule again — the short word, the duplicate and
 * the live-site check — at the moment it saves, so a check that went stale or a direct call can't
 * slip a phrase that hits a healthy site into every probe (D-069).
 */
export async function addPhrase(input: AddPhraseInput, { db }: OrganisationDeps): Promise<SaveHoursResult> {
  const parsed = addPhraseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the phrase.' };
  const { error } = await db.rpc('add_forbidden_phrase', {
    p_group: parsed.data.group,
    p_phrase: parsed.data.phrase,
    p_note: parsed.data.note,
  });
  return error ? phraseRefusalWords(error) : { ok: true };
}

export async function removePhrase(
  input: RemovePhraseInput,
  { db }: OrganisationDeps,
): Promise<SaveHoursResult> {
  const parsed = removePhraseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Add a note.' };
  const { error } = await db.rpc('remove_forbidden_phrase', {
    p_id: parsed.data.id,
    p_note: parsed.data.note,
  });
  return error ? phraseRefusalWords(error) : { ok: true };
}

export async function removeHoliday(id: string, { db }: OrganisationDeps): Promise<SaveHoursResult> {
  const parsed = removeHolidaySchema.safeParse({ id });
  if (!parsed.success) return { ok: false, message: 'That holiday is gone — reload the page.' };
  const { error } = await db.rpc('remove_company_holiday', { p_id: parsed.data.id });
  return error ? holidayRefusal(error) : { ok: true };
}
