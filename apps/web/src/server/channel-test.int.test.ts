// @vitest-environment node
/**
 * S17 Done-when 2 on the LOCAL Supabase stack (D-069, spec §10): a test alert posts in its own
 * "TEST — no action" thread mentioning only the tester — through the real `send_channel_test`, the
 * notifier's claim and dispatch (Chat post and email send are stubbed). Run with
 * `pnpm --filter @dxt/web test:int` (CI: the `db` job).
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database, DbClient } from '@dxt/db';
import { dispatchNotifications } from './notifier/dispatch';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
// The Supabase CLI's well-known local demo keys — not secrets, and never sent to a non-local URL.
const SECRET_KEY = process.env.E2E_SUPABASE_SECRET_KEY ?? 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
const PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const PASSWORD = 'int-local-only-Password-1';
const MAIL = { apiKey: 're_local_test', from: 'DxT Monitor <alerts@notify.example.test>' };
const ADMIN_EMAIL = 'tao@example.test'; // the local seed's Admin (supabase/seed.sql)
const CHAT_ID = '9990001';
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(URL_))
  throw new Error('integration tests run on the local stack only');

const db: DbClient = createClient<Database>(URL_, SECRET_KEY, { auth: { persistSession: false } });
const me: DbClient = createClient<Database>(URL_, PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let myId = '';
let chatBefore: string | null = null;

/** Only this test's rows go through the pass: other files' queued rows are set aside. */
async function onlyEvent(eventId: string) {
  const { error } = await db
    .from('notifications')
    .update({ status: 'cancelled' })
    .eq('status', 'queued')
    .or(`oncall_event_id.is.null,oncall_event_id.neq.${eventId}`);
  if (error) throw new Error(error.message);
}

beforeAll(async () => {
  const { data: p, error } = await db
    .from('profiles')
    .select('id, google_chat_user_id')
    .eq('email', ADMIN_EMAIL)
    .single();
  if (error) throw new Error(error.message);
  myId = p.id;
  chatBefore = p.google_chat_user_id;
  await db.from('profiles').update({ google_chat_user_id: CHAT_ID }).eq('id', myId);
  await db.from('oncall_events').delete().eq('kind', 'channel_test').eq('user_id', myId);
  const set = await db.auth.admin.updateUserById(myId, { password: PASSWORD });
  if (set.error) throw new Error(set.error.message);
  const signIn = await me.auth.signInWithPassword({ email: ADMIN_EMAIL, password: PASSWORD });
  if (signIn.error) throw new Error(signIn.error.message);
});

afterAll(async () => {
  if (myId) await db.from('profiles').update({ google_chat_user_id: chatBefore }).eq('id', myId);
});

describe('a test alert in its own thread, mentioning only the tester (Done-when 2)', () => {
  it('Chat: one card in "test-<event>", the text line @mentioning only the tester', async () => {
    const { data: eventId, error } = await me.rpc('send_channel_test', { p_channel: 'chat' });
    expect(error).toBeNull();
    await onlyEvent(eventId!);
    const post = vi.fn(async () => ({ ok: true as const, messageName: 'spaces/x/messages/y' }));
    await dispatchNotifications({
      db,
      webhookUrl: 'https://chat.example.test/hook',
      email: undefined,
      appUrl: 'https://monitor.example.test',
      post,
    });
    expect(post).toHaveBeenCalledTimes(1);
    const [, message, opts] = post.mock.calls[0] as unknown as [
      string,
      { text: string },
      { threadKey: string },
    ];
    expect(opts.threadKey).toBe(`test-${eventId}`);
    expect(message.text).toMatch(/^<users\/9990001> TEST — no action · Google Chat test for /);
    expect(message.text.match(/<users\//g)).toHaveLength(1);
    const { data: row } = await db
      .from('notifications')
      .select('status, provider_message_id')
      .eq('oncall_event_id', eventId!)
      .single();
    expect(row).toEqual({ status: 'sent', provider_message_id: 'spaces/x/messages/y' });

    const again = await me.rpc('send_channel_test', { p_channel: 'chat' });
    expect(again.error?.hint).toBe('test_too_soon');
  });

  it('email: one "TEST — no action" email to the tester alone', async () => {
    const { data: eventId, error } = await me.rpc('send_channel_test', { p_channel: 'email' });
    expect(error).toBeNull();
    await onlyEvent(eventId!);
    const send = vi.fn(async () => ({ ok: true as const, id: 'em_local' }));
    await dispatchNotifications({
      db,
      webhookUrl: undefined,
      email: MAIL,
      appUrl: 'https://monitor.example.test',
      send,
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [message, opts] = send.mock.calls[0] as unknown as [{ subject: string }, { to: string }];
    expect(opts.to).toBe(ADMIN_EMAIL);
    expect(message.subject).toMatch(/^DxT Monitor · TEST — no action · /);
  });
});
