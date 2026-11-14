// @vitest-environment node
/**
 * S16 on the LOCAL Supabase stack, through real Auth (GoTrue) — plan Done-when 1 and 3 (D-062):
 * an invited address can sign up with its role, an address not on the list is refused (and the
 * refusal is logged), deactivating bans the account and kills its sessions, and "Sign out
 * everywhere" makes the refresh token fail and the app read the old token as `ended`.
 * Run with `pnpm --filter @dxt/web test:int` (CI: the `db` job).
 */
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database, DbClient } from '@dxt/db';

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
const run = crypto.randomUUID().slice(0, 8);
const newClient = (): DbClient =>
  createClient<Database>(URL_, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function must<T>(
  p: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  if (data === null || data === undefined) throw new Error('no data');
  return data;
}

const asAdmin = newClient();

/** Signs `email` in on a fresh client (a fresh device). */
async function signIn(email: string): Promise<DbClient> {
  const c = newClient();
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(error.message);
  return c;
}

async function accessOf(c: DbClient): Promise<string> {
  const row = await must(c.rpc('my_access').single());
  return row.status;
}

beforeAll(async () => {
  const profile = await must(
    db.from('profiles').select('id').eq('email', ADMIN_EMAIL).eq('is_active', true).single(),
  );
  const { error } = await db.auth.admin.updateUserById(profile.id, { password: PASSWORD });
  if (error) throw new Error(error.message);
  const { error: signInError } = await asAdmin.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: PASSWORD,
  });
  if (signInError) throw new Error(signInError.message);
});

describe('invite → sign in, deactivate (Done-when 1)', () => {
  const email = `s16-${run}@example.test`;
  let userId = '';

  it('an invited address signs up with the role picked', async () => {
    expect(await must(asAdmin.rpc('invite_user', { p_email: email, p_role: 'responder' }))).toBe('invited');
    const person = newClient();
    const { data, error } = await person.auth.signUp({ email, password: PASSWORD });
    expect(error).toBeNull();
    userId = data.user!.id;
    const profile = await must(db.from('profiles').select('role, is_active').eq('id', userId).single());
    expect(profile).toEqual({ role: 'responder', is_active: true });
    expect(await accessOf(await signIn(email))).toBe('active');
  });

  it('an address not on the list is refused, and the refusal is logged', async () => {
    const stranger = `s16-stranger-${run}@example.test`;
    const { error } = await newClient().auth.signUp({ email: stranger, password: PASSWORD });
    expect(error?.message).toMatch(/access list/i);
    const rows = await must(
      db
        .from('audit_log')
        .select('after')
        .eq('action', 'signin.refused')
        .order('at', { ascending: false })
        .limit(20),
    );
    expect(rows.map((r) => r.after)).toContainEqual({ reason: 'not_invited', email: stranger });
  });

  it('deactivating bans the account and ends its sessions at once', async () => {
    const device = await signIn(email);
    expect(await accessOf(device)).toBe('active');
    await must(asAdmin.rpc('deactivate_user', { p_user_id: userId }).then((r) => ({ ...r, data: true })));

    // The refresh token is gone with the session; the old access token reads `ended` in the app.
    const { error: refreshError } = await device.auth.refreshSession();
    expect(refreshError).not.toBeNull();
    // Deactivated reads before signed out, so they see "Account deactivated".
    expect(await accessOf(device)).toBe('inactive');
    // Banned: a new sign-in is refused.
    const { error: signInError } = await newClient().auth.signInWithPassword({ email, password: PASSWORD });
    expect(signInError?.message).toMatch(/banned/i);
    const { count } = await db
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'user.deactivate')
      .eq('entity_id', userId);
    expect(count).toBe(1);
  });

  it('inviting the address again gives the access back', async () => {
    expect(await must(asAdmin.rpc('invite_user', { p_email: email, p_role: 'viewer' }))).toBe('reactivated');
    const device = await signIn(email);
    expect(await accessOf(device)).toBe('active');
    const profile = await must(db.from('profiles').select('role').eq('id', userId).single());
    expect(profile.role).toBe('viewer');
  });

  describe('Sign out everywhere (Done-when 3)', () => {
    it('rejects every refresh token and the app reads the old tokens as ended', async () => {
      const laptop = await signIn(email);
      const phone = await signIn(email);
      const sessions = await must(asAdmin.rpc('list_sessions', { p_user_id: userId }));
      expect(sessions.length).toBeGreaterThanOrEqual(2);

      expect(
        await must(asAdmin.rpc('sign_out_user_everywhere', { p_user_id: userId })),
      ).toBeGreaterThanOrEqual(2);
      for (const device of [laptop, phone]) {
        const { error } = await device.auth.refreshSession();
        expect(error).not.toBeNull();
        expect(await accessOf(device)).toBe('ended');
      }
      expect(await must(asAdmin.rpc('list_sessions', { p_user_id: userId }))).toEqual([]);
    });

    it('"Sign out other devices" keeps this one', async () => {
      const here = await signIn(email);
      const there = await signIn(email);
      expect(await must(here.rpc('sign_out_my_other_devices'))).toBe(1);
      expect(await accessOf(here)).toBe('active');
      const { error } = await here.auth.refreshSession();
      expect(error).toBeNull();
      expect(await accessOf(there)).toBe('ended');
    });
  });

  it('cleans up: the run’s person is deactivated again', async () => {
    const { error } = await asAdmin.rpc('deactivate_user', { p_user_id: userId });
    expect(error).toBeNull();
  });
});

describe('two Admins demoting each other at once (review M1)', () => {
  it('one of them stays an Admin', async () => {
    const a = `s16-a-${run}@example.test`;
    const b = `s16-b-${run}@example.test`;
    const ids: string[] = [];
    for (const email of [a, b]) {
      await must(asAdmin.rpc('invite_user', { p_email: email, p_role: 'admin' }));
      const { data, error } = await newClient().auth.signUp({ email, password: PASSWORD });
      if (error) throw new Error(error.message);
      ids.push(data.user!.id);
    }
    const [asA, asB] = [await signIn(a), await signIn(b)];
    // Tao steps aside for the race: only A and B are Admins (put back below).
    const others = await must(db.from('profiles').select('id').eq('role', 'admin').eq('is_active', true));
    const away = others.map((p) => p.id).filter((id) => !ids.includes(id));
    await must(db.from('profiles').update({ is_active: false }).in('id', away).select('id'));
    try {
      const results = await Promise.all([
        asA.rpc('change_user_role', { p_user_id: ids[1]!, p_role: 'viewer' }),
        asB.rpc('change_user_role', { p_user_id: ids[0]!, p_role: 'viewer' }),
      ]);
      expect(results.filter((r) => r.error === null)).toHaveLength(1);
      const { count } = await db
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .in('id', ids)
        .eq('role', 'admin');
      expect(count).toBe(1);
    } finally {
      await must(db.from('profiles').update({ is_active: true }).in('id', away).select('id'));
      // The run's two people leave as they came: deactivated by Tao (off the list, banned).
      for (const id of ids) {
        const { data } = await db.from('profiles').select('is_active').eq('id', id).single();
        if (data?.is_active)
          await must(asAdmin.rpc('deactivate_user', { p_user_id: id }).then((r) => ({ ...r, data: true })));
      }
    }
  });
});
