// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb, type FakeCall } from '../../../test/fake-db';
import { dispatchNotifications } from './dispatch';

// Reports (S14, D-056): the card queued at 09:00 goes to the Reports Space as stored; the weekly email to
// each CEO; the reports' Healthchecks check hears only about a digest post that went, or a report that failed.
const webhookUrl = 'https://chat.googleapis.com/v1/spaces/ALERTS/messages?key=K&token=T';
const reportsWebhookUrl = 'https://chat.googleapis.com/v1/spaces/REPORTS/messages?key=K&token=T';
const reportsPingUrl = 'https://hc-ping.com/reports-uuid';
const email = { apiKey: 're_test', from: 'DxT Monitor <alerts@notify.dxt.example>' };
const now = () => new Date('2026-09-25T02:00:05Z');

const chatCard = { text: 'Website status Fri 25 Sep 09:00 · 17/17 OK', cardsV2: [] };
const weeklyMail = {
  subject: 'DxT Monitor · Weekly summary · 21–27 Sep',
  html: '<p>x</p>',
  text: 'x',
  headers: {},
};

const row = (over: Record<string, unknown> = {}) => ({
  id: 'n-daily',
  incident_id: null,
  system_alert_id: null,
  maintenance_window_id: null,
  oncall_event_id: null,
  report_id: 'r-daily',
  user_id: null as string | null,
  channel: 'google_chat',
  template: 'daily_digest',
  thread_key: 'report-daily-2026-09-25',
  attempts: 1,
  hold_until: null,
  created_at: '2026-09-25T02:00:01Z',
  context: {},
  ...over,
});

const db = (chat: unknown[], emails: unknown[] = []) =>
  fakeDb({
    'rpc.claim_notifications': (c: FakeCall) => ({
      data: (c.values as { p_channel: string }).p_channel === 'email' ? emails : chat,
    }),
    'incidents.select': { data: [] },
    'profiles.select': {
      data: [{ id: 'u-ceo', email: 'ceo@example.test', display_name: 'CEO', google_chat_user_id: null }],
    },
    'reports.select': {
      data: [
        { id: 'r-daily', kind: 'daily', chat: chatCard, email: null },
        { id: 'r-weekly', kind: 'weekly', chat: chatCard, email: weeklyMail },
      ],
    },
    'notifications.select': { data: [] },
    'notifications.update': { data: [{ id: 'x' }] },
  });

const deps = (d: ReturnType<typeof db>, over: Record<string, unknown> = {}) => ({
  db: d.db,
  webhookUrl,
  reportsWebhookUrl,
  reportsPingUrl,
  email,
  appUrl: 'https://monitor.dxt.example',
  now,
  ...over,
});

describe('report messages', () => {
  it('claims report rows and posts the digest as stored in the Reports Space, then pings its check', async () => {
    const post = vi.fn(async () => ({ ok: true as const, messageName: 'spaces/REPORTS/messages/M' }));
    const ping = vi.fn(async () => {});
    const d = db([row()]);
    await dispatchNotifications(deps(d, { post, ping }));
    const claim = d.rpcCalls.find((c) => c.name === 'claim_notifications')!;
    expect(claim.args).toMatchObject({ p_reports: true });
    expect(post).toHaveBeenCalledWith(reportsWebhookUrl, chatCard, {
      threadKey: 'report-daily-2026-09-25',
      messageId: 'client-n-daily',
    });
    expect(ping).toHaveBeenCalledWith(reportsPingUrl, 'ok');
  });

  it('a weekly post that went pings nothing (the check is the digest’s, once a day)', async () => {
    const post = vi.fn(async () => ({ ok: true as const, messageName: 'm' }));
    const ping = vi.fn(async () => {});
    await dispatchNotifications(
      deps(db([row({ id: 'n-weekly', report_id: 'r-weekly', template: 'weekly_summary' })]), { post, ping }),
    );
    expect(post).toHaveBeenCalledOnce();
    expect(ping).not.toHaveBeenCalled();
  });

  it('a digest that fails for good pings /fail, and queues no email fallback', async () => {
    const post = vi.fn(async () => ({ ok: false as const, error: 'HTTP 500' }));
    const ping = vi.fn(async () => {});
    const d = db([row({ attempts: 4 })]);
    await dispatchNotifications(deps(d, { post, ping }));
    expect(ping).toHaveBeenCalledWith(reportsPingUrl, 'fail');
    expect(d.rpcCalls.some((c) => c.name === 'queue_fallback_emails')).toBe(false);
  });

  it('a retry still to come pings nothing yet', async () => {
    const post = vi.fn(async () => ({ ok: false as const, error: 'Timeout' }));
    const ping = vi.fn(async () => {});
    await dispatchNotifications(deps(db([row()]), { post, ping }));
    expect(ping).not.toHaveBeenCalled();
  });

  it('without a Reports Space webhook the digest fails at once — never into the Alerts Space', async () => {
    const post = vi.fn(async () => ({ ok: true as const, messageName: 'm' }));
    const ping = vi.fn(async () => {});
    await dispatchNotifications(deps(db([row()]), { post, ping, reportsWebhookUrl: undefined }));
    expect(post).not.toHaveBeenCalled();
    expect(ping).toHaveBeenCalledWith(reportsPingUrl, 'fail');
  });

  it('emails the weekly summary as stored to the CEO', async () => {
    const send = vi.fn(async () => ({ ok: true as const, id: 'em_1' }));
    await dispatchNotifications(
      deps(
        db(
          [],
          [
            row({
              id: 'n-mail',
              report_id: 'r-weekly',
              template: 'weekly_summary',
              channel: 'email',
              user_id: 'u-ceo',
            }),
          ],
        ),
        { send },
      ),
    );
    expect(send).toHaveBeenCalledWith(weeklyMail, {
      apiKey: 're_test',
      from: email.from,
      to: 'ceo@example.test',
      idempotencyKey: 'notification-n-mail',
    });
  });
});
