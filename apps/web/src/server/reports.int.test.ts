// @vitest-environment node
/**
 * S14 (FR-12, D-056) on the LOCAL Supabase stack: the reports cron's reads run against the real schema
 * (every embed and RPC name), a Monday queues the digest and the weekly summary once each, posts both
 * to the Reports Space and emails the CEOs; a second run queues nothing. Run with
 * `pnpm --filter @dxt/web test:int` (CI: the `db` job). Local URLs only.
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database, DbClient } from '@dxt/db';
import { runReports } from './reports/run-reports';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
// The Supabase CLI's well-known local demo key — not a secret, and never sent to a non-local URL.
const SECRET_KEY = process.env.E2E_SUPABASE_SECRET_KEY ?? 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(URL_))
  throw new Error('integration tests run on the local stack only');

const db: DbClient = createClient<Database>(URL_, SECRET_KEY, { auth: { persistSession: false } });
const reportsWebhookUrl = 'https://chat.example.test/reports';
const email = { apiKey: 're_local_test', from: 'DxT Monitor <alerts@notify.example.test>' };

// A Monday 09:00 Bangkok far ahead, a different week each run, so no earlier run's report is in the way.
const weeks = Math.floor(Math.random() * 2000);
const monday = new Date(Date.UTC(2031, 0, 6, 2, 0, 0) + weeks * 7 * 86_400_000);

const reportIds = async () =>
  (
    (
      await db
        .from('reports')
        .select('id')
        .in('period_start', [day(monday), day(new Date(monday.getTime() - 7 * 86_400_000))])
    ).data ?? []
  ).map((r) => r.id);
const day = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Other queued messages would be claimed too: hand them nothing to send but these reports.
  await db.from('notifications').update({ status: 'cancelled' }).eq('status', 'queued');
});

afterAll(async () => {
  const ids = await reportIds();
  const rows = (await db.from('notifications').select('id').in('report_id', ids)).data ?? [];
  await db
    .from('notification_attempts')
    .delete()
    .in(
      'notification_id',
      rows.map((r) => r.id),
    );
  await db.from('notifications').delete().in('report_id', ids);
  await db.from('reports').delete().in('id', ids);
});

describe('reports cron (S14)', () => {
  it('a Monday queues the digest and the weekly summary once each, and posts both to the Reports Space', async () => {
    expect(new Date(monday.getTime() + 7 * 3_600_000).getUTCDay()).toBe(1);
    const post = vi.fn(async () => ({ ok: true as const, messageName: 'spaces/R/messages/M' }));
    const send = vi.fn(async () => ({ ok: true as const, id: 'em_local' }));
    const ping = vi.fn(async () => {});
    const deps = {
      db,
      webhookUrl: 'https://chat.example.test/alerts',
      reportsWebhookUrl,
      reportsPingUrl: 'https://hc.example.test/reports',
      email,
      appUrl: 'https://monitor.example.test',
      post,
      send,
      ping,
    };

    const first = await runReports(deps, monday);
    expect(first).toMatchObject({ ok: true, daily: 'queued', weekly: 'queued' });

    const texts = (post.mock.calls as unknown as [string, { text: string }][]).map(([url, m]) => [
      url,
      m.text,
    ]);
    expect(texts.every(([url]) => url === reportsWebhookUrl)).toBe(true);
    expect(texts.map(([, t]) => t)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Website status Mon \d+ \w+ 09:00 · \d+\/\d+ OK/),
        expect.stringMatching(/^Website week /),
      ]),
    );
    expect(ping).toHaveBeenCalledWith('https://hc.example.test/reports', 'ok');

    // Every CEO (active stakeholder who manages no client) got the weekly email.
    const ams = new Set(
      ((await db.from('clients').select('am_user_id')).data ?? []).map((c) => c.am_user_id),
    );
    const ceos = (
      (await db.from('profiles').select('id, email').eq('role', 'stakeholder').eq('is_active', true)).data ??
      []
    ).filter((p) => !ams.has(p.id));
    const to = (send.mock.calls as unknown as [{ subject: string }, { to: string }][]).map(([m, o]) => [
      m.subject,
      o.to,
    ]);
    expect(to.map(([, t]) => t).sort()).toEqual(ceos.map((c) => c.email).sort());
    for (const [subject] of to) expect(subject).toMatch(/^DxT Monitor · Weekly summary · /);

    const second = await runReports(deps, new Date(monday.getTime() + 60_000));
    expect(second).toMatchObject({ ok: true, daily: 'already_queued', weekly: 'already_queued' });
    expect(post).toHaveBeenCalledTimes(texts.length);
  });

  it('refuses to run without a Reports Space webhook (the Healthchecks check then alarms)', async () => {
    const r = await runReports(
      { db, webhookUrl: 'https://chat.example.test/alerts', email: undefined, appUrl: 'x' },
      monday,
    );
    expect(r).toEqual({ ok: false, reason: 'no_reports_webhook' });
  });
});
