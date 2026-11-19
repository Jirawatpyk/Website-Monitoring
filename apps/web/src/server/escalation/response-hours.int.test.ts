// @vitest-environment node
/**
 * S17 Done-when 1 on the LOCAL Supabase stack (D-069): an Admin saves new response hours through
 * `save_response_hours` (a note, one audit row), and the very next `loadResponseHours` — what every
 * engine run and notifier batch calls first — returns them, so the PROBLEM hold and the ladder's pause
 * follow them from the next sweep. Run with `pnpm --filter @dxt/web test:int` (CI: the `db` job).
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isInsideHours, problemHoldUntil } from '@dxt/engine';
import type { Database, DbClient } from '@dxt/db';
import { loadResponseHours } from './response-hours';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
// The Supabase CLI's well-known local demo keys — not secrets, and never sent to a non-local URL.
const SECRET_KEY = process.env.E2E_SUPABASE_SECRET_KEY ?? 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
const PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const PASSWORD = 'int-local-only-Password-1';
const ADMIN_EMAIL = 'tao@example.test'; // the local seed's Admin (supabase/seed.sql)
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(URL_))
  throw new Error('integration tests run on the local stack only');

const db: DbClient = createClient<Database>(URL_, SECRET_KEY, { auth: { persistSession: false } });
const asAdmin: DbClient = createClient<Database>(URL_, PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Sat 6 Mar 2027 (no company holiday), Bangkok = UTC+7.
const SAT_0800 = new Date('2027-03-06T01:00:00Z');
const SAT_1000 = new Date('2027-03-06T03:00:00Z');
const MON_0900 = new Date('2027-03-08T02:00:00Z');
const SAT_0830 = new Date('2027-03-06T01:30:00Z');

let before: { response_start: string; response_end: string; response_days: number[] } | null = null;

beforeAll(async () => {
  const { data: profile, error } = await db
    .from('profiles')
    .select('id')
    .eq('email', ADMIN_EMAIL)
    .eq('is_active', true)
    .single();
  if (error) throw new Error(error.message);
  const set = await db.auth.admin.updateUserById(profile.id, { password: PASSWORD });
  if (set.error) throw new Error(set.error.message);
  const signIn = await asAdmin.auth.signInWithPassword({ email: ADMIN_EMAIL, password: PASSWORD });
  if (signIn.error) throw new Error(signIn.error.message);
  const row = await db
    .from('organisation_settings')
    .select('response_start, response_end, response_days')
    .single();
  if (row.error) throw new Error(row.error.message);
  before = row.data;
  // Start from the seeded hours, whatever an earlier run left.
  await db
    .from('organisation_settings')
    .update({ response_start: '09:00', response_end: '18:00', response_days: [1, 2, 3, 4, 5] })
    .eq('singleton', true);
});

afterAll(async () => {
  if (before) await db.from('organisation_settings').update(before).eq('singleton', true);
});

describe('new response hours reach the engine on its next run (Done-when 1)', () => {
  it('the seeded hours hold a Saturday Tier 2 PROBLEM until Monday 09:00', async () => {
    const hours = await loadResponseHours(db, new Date());
    expect(isInsideHours(SAT_1000, hours)).toBe(false);
    expect(problemHoldUntil(2, SAT_1000, hours)).toEqual(MON_0900);
  });

  it('an Admin saves Mon–Sat 08:30–17:30 with a note; the next read uses it', async () => {
    const startedAt = new Date().toISOString();
    const { error } = await asAdmin.rpc('save_response_hours', {
      p_start: '08:30',
      p_end: '17:30',
      p_days: [1, 2, 3, 4, 5, 6],
      p_note: 'int test: Saturday cover',
    });
    expect(error).toBeNull();

    const hours = await loadResponseHours(db, new Date());
    expect(hours).toMatchObject({ startMin: 8 * 60 + 30, endMin: 17 * 60 + 30, days: [1, 2, 3, 4, 5, 6] });
    expect(isInsideHours(SAT_1000, hours)).toBe(true);
    expect(problemHoldUntil(2, SAT_1000, hours)).toBeNull();
    expect(problemHoldUntil(2, SAT_0800, hours)).toEqual(SAT_0830);
    // Tier 1 is always on: the hours move only its owner / on-call hand-over, never a hold.
    expect(problemHoldUntil(1, SAT_0800, hours)).toBeNull();

    const audit = await db
      .from('audit_log')
      .select('after')
      .eq('action', 'organisation.response_hours')
      .gte('at', startedAt);
    expect(audit.error).toBeNull();
    expect(audit.data).toHaveLength(1);
    expect(audit.data?.[0]?.after).toMatchObject({
      start: '08:30',
      end: '17:30',
      note: 'int test: Saturday cover',
    });
  });

  it('a holiday an Admin adds is outside the hours on the next read, and its removal brings them back (Done-when 4)', async () => {
    // Back to Mon–Fri 09:00–18:00 so the day below is a working day before the holiday.
    const reset = await asAdmin.rpc('save_response_hours', {
      p_start: '09:00',
      p_end: '18:00',
      p_days: [1, 2, 3, 4, 5],
      p_note: 'int test: back to the seeded hours',
    });
    expect(reset.error).toBeNull();
    // A Wednesday about five weeks out, free of holidays (the SQL takes today to 31 Dec next year).
    const taken = new Set(((await db.from('company_holidays').select('day')).data ?? []).map((h) => h.day));
    const wed = new Date(Date.now() + 35 * 86_400_000);
    wed.setUTCDate(wed.getUTCDate() + ((3 - wed.getUTCDay() + 7) % 7));
    while (
      taken.has(wed.toISOString().slice(0, 10)) ||
      taken.has(new Date(wed.getTime() + 86_400_000).toISOString().slice(0, 10))
    )
      wed.setUTCDate(wed.getUTCDate() + 7);
    const day = wed.toISOString().slice(0, 10);
    const at1000 = new Date(`${day}T10:00:00+07:00`);
    const thu0900 = new Date(new Date(`${day}T09:00:00+07:00`).getTime() + 86_400_000);

    const startedAt = new Date().toISOString();
    const added = await asAdmin.rpc('add_company_holiday', {
      p_day: day,
      p_name: 'int test: company outing',
      p_kind: 'company',
    });
    expect(added.error).toBeNull();
    try {
      const hours = await loadResponseHours(db, new Date());
      expect(hours.holidays.has(day)).toBe(true);
      // Tier 2–3 timers wait for the next working day; Tier 1 is with the person on call all day.
      expect(isInsideHours(at1000, hours)).toBe(false);
      expect(problemHoldUntil(2, at1000, hours)).toEqual(thu0900);
      const audit = await db
        .from('audit_log')
        .select('actor_id, after')
        .eq('action', 'holiday.create')
        .gte('at', startedAt);
      expect(audit.data).toHaveLength(1);
      expect(audit.data?.[0]?.actor_id).not.toBeNull();
      expect(audit.data?.[0]?.after).toMatchObject({ day, kind: 'company' });
    } finally {
      const removed = await asAdmin.rpc('remove_company_holiday', { p_id: added.data! });
      expect(removed.error).toBeNull();
    }
    const after = await loadResponseHours(db, new Date());
    expect(isInsideHours(at1000, after)).toBe(true);
  });

  it('refuses a save without a note and changes nothing', async () => {
    // The holiday case above put the hours back to the seeded ones; the note rule still holds.
    await asAdmin.rpc('save_response_hours', {
      p_start: '08:30',
      p_end: '17:30',
      p_days: [1, 2, 3, 4, 5, 6],
      p_note: 'int test: Saturday cover again',
    });
    const { error } = await asAdmin.rpc('save_response_hours', {
      p_start: '07:00',
      p_end: '16:00',
      p_days: [1, 2, 3, 4, 5],
      p_note: '',
    });
    expect(error?.hint).toBe('note_required');
    const hours = await loadResponseHours(db, new Date());
    expect(hours.startMin).toBe(8 * 60 + 30);
  });
});
