// @vitest-environment node
/**
 * S17 Done-when 5 on the LOCAL Supabase stack (D-069): a phrase an Admin saves through
 * `add_forbidden_phrase` is in the next `loadForbiddenList` — what every probe, crawler and Ingest run
 * reads first — and a check with that list finds it on a page; a single short word, and a phrase on a
 * live site's stored clean page, are refused. Run with `pnpm --filter @dxt/web test:int` (CI: `db`).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runHttpCheck } from '@dxt/probe';
import type { Database, DbClient } from '@dxt/db';
import { loadForbiddenList } from './forbidden-list';

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

const PHRASE = 'int test slot vip room';
let server: Server;
let base = '';
let monitor: { id: string; url: string } | null = null;

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
  await db.from('forbidden_phrases').delete().eq('phrase', PHRASE);

  // A live site's stored clean page, for the refusal.
  const m = await db
    .from('monitors')
    .select('id, url, sites!inner(is_active)')
    .eq('sites.is_active', true)
    .eq('is_primary', true)
    .eq('enabled', true)
    .is('removed_at', null)
    .limit(1)
    .single();
  if (m.error) throw new Error(m.error.message);
  monitor = { id: m.data.id, url: m.data.url };
  await db.from('crawler_clean_pages').upsert({
    monitor_id: monitor.id,
    view: 'plain',
    url: monitor.url,
    checked_at: new Date().toISOString(),
    body_hash: 'b'.repeat(64),
    body: '<p>pick a time slot for your visit</p>',
  });

  server = createServer((_req, res) =>
    res.writeHead(200).end(`<html><p>Win big at ${PHRASE.toUpperCase()}!</p></html>`),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.from('forbidden_phrases').delete().eq('phrase', PHRASE);
  if (monitor) await db.from('crawler_clean_pages').delete().eq('monitor_id', monitor.id);
  await new Promise<void>((r) => server.close(() => r()));
});

describe('a phrase an Admin saves reaches the checks on their next run (Done-when 5)', () => {
  it('saved with a note, it is in the next list, and a check with that list finds it', async () => {
    const before = await loadForbiddenList(db);
    expect(before).not.toContain(PHRASE);
    const page = () => runHttpCheck({ url: base, allowPrivateTargets: true, sharedForbidden: before });
    expect((await page()).keywordForbidden).toEqual([]);

    const { error } = await asAdmin.rpc('add_forbidden_phrase', {
      p_group: 'gambling_en',
      p_phrase: PHRASE,
      p_note: 'Done-when 5 int test',
    });
    expect(error).toBeNull();

    const after = await loadForbiddenList(db);
    expect(after.at(-1)).toBe(PHRASE);
    const hit = await runHttpCheck({ url: base, allowPrivateTargets: true, sharedForbidden: after });
    expect(hit.keywordForbidden).toEqual([PHRASE]);
  });

  it('refuses a single short word and a phrase on a live site’s clean page', async () => {
    const short = await asAdmin.rpc('add_forbidden_phrase', {
      p_group: 'gambling_en',
      p_phrase: 'slot',
      p_note: 'n',
    });
    expect(short.error?.hint).toBe('phrase_short');
    const found = await asAdmin.rpc('add_forbidden_phrase', {
      p_group: 'gambling_en',
      p_phrase: 'Time  Slot',
      p_note: 'n',
    });
    expect(found.error?.hint).toBe('phrase_found');
    const check = await asAdmin.rpc('check_forbidden_phrase', { p_phrase: 'time slot' });
    expect(check.error).toBeNull();
    expect((check.data as { hits: unknown[] }).hits).toHaveLength(1);
  });
});
