// @vitest-environment node
/**
 * S09b Done-when 1 and 2 on the LOCAL Supabase stack: a Responder's request over 24 h, made through the
 * real RPC as the seeded Responder, reaches every active Admin in Chat (a reply @mentioning each,
 * D-037) and email; the 12 h / 1 h reminders; an action's Space line and the owner / backup email;
 * the 10 s Undo. Run with `pnpm --filter @dxt/web test:int` (CI: the `db` job). Local URLs only.
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
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(URL_))
  throw new Error('integration tests run on the local stack only');

const db: DbClient = createClient<Database>(URL_, SECRET_KEY, { auth: { persistSession: false } });
const run = crypto.randomUUID().slice(0, 8);
const PASSWORD = 'int-local-only-Password-1';
const webhookUrl = 'https://chat.example.test/webhook';
const appUrl = 'https://monitor.example.test';
const email = { apiKey: 're_local_test', from: 'DxT Monitor <alerts@notify.example.test>' };
const created = { clients: [] as string[], sites: [] as string[] };

async function must<T>(
  p: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  if (data === null || data === undefined) throw new Error('no data');
  return data;
}
const profileId = async (address: string) =>
  (await must(db.from('profiles').select('id').eq('email', address).single())).id;
async function signedIn(address: string) {
  const { error } = await db.auth.admin.updateUserById(await profileId(address), { password: PASSWORD });
  if (error) throw new Error(error.message);
  const user = createClient<Database>(URL_, PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const signIn = await user.auth.signInWithPassword({ email: address, password: PASSWORD });
  if (signIn.error) throw new Error(signIn.error.message);
  return user;
}
const rowsOf = (windowId: string) =>
  must(
    db
      .from('notifications')
      .select('id, channel, template, user_id, status, hold_until, context')
      .eq('maintenance_window_id', windowId)
      .order('created_at'),
  );
// Other messages already queued would be claimed too: keep the run to this window's.
const onlyMine = async (windowId: string) => {
  const { error } = await db
    .from('notifications')
    .update({ status: 'cancelled' })
    .eq('status', 'queued')
    .or(`maintenance_window_id.is.null,maintenance_window_id.neq.${windowId}`);
  if (error) throw new Error(error.message);
};
const okPost = () => vi.fn(async () => ({ ok: true as const, messageName: 'spaces/S/messages/M' }));
const okSend = () => vi.fn(async () => ({ ok: true as const, id: 'em_local' }));

let arm: string;
let ploy: string;
let admins: { id: string; email: string }[];
let siteId: string;

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  arm = await profileId('arm@example.test');
  ploy = await profileId('ploy@example.test');
  admins = await must(db.from('profiles').select('id, email').eq('role', 'admin').eq('is_active', true));
  const client = await must(
    db
      .from('clients')
      .insert({ name: `Messages ${run}` })
      .select('id')
      .single(),
  );
  created.clients.push(client.id);
  const site = await must(
    db
      .from('sites')
      .insert({
        client_id: client.id,
        name: `Window ${run}`,
        tier: 2,
        primary_owner_id: arm,
        backup_owner_id: ploy,
      })
      .select('id')
      .single(),
  );
  siteId = site.id;
  created.sites.push(site.id);
});

afterAll(async () => {
  const windows = await must(db.from('maintenance_windows').select('id').in('site_id', created.sites));
  const ids = windows.map((w) => w.id);
  await db.from('notifications').delete().in('maintenance_window_id', ids);
  await db.from('maintenance_windows').delete().in('id', ids);
  await db.from('sites').delete().in('id', created.sites);
  await db.from('clients').delete().in('id', created.clients);
});

describe('maintenance messages (S09b, spec §24, D-037)', () => {
  it('a Responder’s request over 24 h reaches every active Admin in Chat and email; reminders at 12 h and 1 h', async () => {
    const user = await signedIn('arm@example.test');
    const start = new Date(Date.now() + 2 * 86_400_000);
    const { data: windowId, error } = await user.rpc('create_maintenance', {
      p_site_id: siteId,
      p_starts_at: start.toISOString(),
      p_ends_at: new Date(start.getTime() + 30 * 3_600_000).toISOString(),
      p_reason: 'Move to a new hosting provider',
    });
    expect(error).toBeNull();
    const id = windowId as string;
    await onlyMine(id);

    const post = okPost();
    const send = okSend();
    await dispatchNotifications({ db, webhookUrl, email, appUrl, post, send });
    // The line opens the thread; the mention replies wait for it, then go together.
    await dispatchNotifications({ db, webhookUrl, email, appUrl, post, send });

    const texts = (post.mock.calls as unknown as [string, { text: string }, { threadKey: string }][]).map(
      ([, m, o]) => ({ text: m.text, thread: o.threadKey }),
    );
    expect(texts[0]?.text).toMatch(/^MAINTENANCE REQUESTED · Window .* · by Arm · waiting for an Admin$/);
    expect(texts.filter((t) => t.text.includes('approve before'))).toHaveLength(admins.length);
    expect(new Set(texts.map((t) => t.thread))).toEqual(new Set([`mw-${id}`]));
    const to = (send.mock.calls as unknown as [unknown, { to: string }][]).map(([, o]) => o.to);
    expect(to).toEqual(expect.arrayContaining([...admins.map((a) => a.email), 'ploy@example.test']));
    expect(to).not.toContain('arm@example.test');
    expect((await rowsOf(id)).every((r) => r.status === 'sent')).toBe(true);

    // 12 h before: the Admins in Chat and email, the asker STILL WAITING; 1 h before: Chat only.
    const at12 = new Date(start.getTime() - 12 * 3_600_000 + 60_000);
    expect(await must(db.rpc('engine_window_reminders', { p_now: at12.toISOString() }))).toBe(1);
    const at1 = new Date(start.getTime() - 3_600_000 + 60_000);
    expect(await must(db.rpc('engine_window_reminders', { p_now: at1.toISOString() }))).toBe(1);
    const queued = (await rowsOf(id)).filter((r) => r.status === 'queued');
    const kinds = queued.map(
      (r) =>
        `${r.channel}:${(r.context as { dm?: string; kind: string }).dm ?? (r.context as { kind: string }).kind}`,
    );
    expect(kinds.filter((k) => k === 'google_chat:reminder_12h')).toHaveLength(admins.length);
    expect(kinds.filter((k) => k === 'email:reminder_12h')).toHaveLength(admins.length);
    expect(kinds).toContain('google_chat:still_waiting');
    expect(kinds.filter((k) => k === 'google_chat:reminder_1h')).toHaveLength(admins.length);
    expect(kinds).not.toContain('email:reminder_1h');
  });

  it('an action posts its Space line and emails the owner; Undo inside 10 s sends nothing', async () => {
    const user = await signedIn('ploy@example.test');
    const start = new Date(Date.now() + 5 * 86_400_000);
    const { data: windowId } = await user.rpc('create_maintenance', {
      p_site_id: siteId,
      p_starts_at: start.toISOString(),
      p_ends_at: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
      p_reason: 'WordPress plugin updates',
    });
    const id = windowId as string;
    await onlyMine(id);
    const post = okPost();
    const send = okSend();
    await dispatchNotifications({ db, webhookUrl, email, appUrl, post, send });
    expect((post.mock.calls[0] as unknown as [string, { text: string }])[1].text).toMatch(
      /^MAINTENANCE SCHEDULED · Window .* \(2 h\) · “WordPress plugin updates” · by Ploy$/,
    );
    expect((send.mock.calls as unknown as [unknown, { to: string }][]).map(([, o]) => o.to)).toEqual([
      'arm@example.test',
    ]);

    // Cancel, then Undo inside the 10 s: the held rows are cancelled and nothing more goes out.
    expect(
      (await user.rpc('cancel_window', { p_window_id: id, p_reason: 'Client postponed' })).error,
    ).toBeNull();
    const held = (await rowsOf(id)).filter((r) => r.status === 'queued');
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((r) => r.hold_until && Date.parse(r.hold_until) > Date.now())).toBe(true);
    expect((await user.rpc('undo_window_action', { p_window_id: id })).error).toBeNull();
    expect((await rowsOf(id)).filter((r) => r.status === 'queued')).toEqual([]);
    const w = await must(db.from('maintenance_windows').select('cancelled_at').eq('id', id).single());
    expect(w.cancelled_at).toBeNull();
  });
});
