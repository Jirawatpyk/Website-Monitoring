// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb, type FakeCall } from '../../../test/fake-db';
import { dispatchNotifications } from './dispatch';

// Repeating series (S14, D-057, spec §32.10–11): their own Chat thread and mail thread; a series'
// window says "· series every Tue" on its first line.
const webhookUrl = 'https://chat.googleapis.com/v1/spaces/S/messages?key=K&token=T';
const appUrl = 'https://monitor.dxt.example';
const email = { apiKey: 're_test', from: 'DxT Monitor <alerts@notify.dxt.example>' };
const NOW = new Date('2026-09-25T03:07:00Z'); // Fri 25 Sep 10:07 Bangkok
const now = () => NOW;

const seriesRow = {
  id: 's1',
  rule: { freq: 'weekly', days: [2] },
  start_time: '01:00:00',
  duration_min: 120,
  starts_on: '2026-09-15',
  until_on: null,
  first_starts_at: '2026-09-14T18:00:00Z',
  reason: 'WordPress plugin updates',
  created_at: '2026-09-14T02:10:00Z',
  created_by: 'u-ploy',
  creator: { display_name: 'Ploy' },
  sites: {
    name: 'Tubtong',
    tier: 1,
    primary: { id: 'u-ploy', display_name: 'Ploy', google_chat_user_id: 'PLOY' },
    backup: { id: 'u-nok', display_name: 'Nok', google_chat_user_id: 'NOK' },
  },
};
const people = [
  { id: 'u-ploy', email: 'ploy@example.test', display_name: 'Ploy', google_chat_user_id: 'PLOY' },
  { id: 'u-nok', email: 'nok@example.test', display_name: 'Nok', google_chat_user_id: 'NOK' },
];
const row = (over: Record<string, unknown> = {}) => ({
  id: 'n-line',
  incident_id: null,
  system_alert_id: null,
  maintenance_window_id: null,
  maintenance_series_id: 's1',
  user_id: null as string | null,
  channel: 'google_chat',
  template: 'ms_line',
  thread_key: 'ms-s1',
  attempts: 1,
  hold_until: null,
  created_at: NOW.toISOString(),
  context: {
    kind: 'approved',
    by: 'Tao',
    at: NOW.toISOString(),
    windows: ['2026-09-14T18:00:00Z', '2026-09-21T18:00:00Z'],
  } as Record<string, unknown>,
  ...over,
});
const queue = (chat: unknown[], emails: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  'rpc.claim_notifications': (c: FakeCall) => ({
    data: (c.values as { p_channel: string }).p_channel === 'email' ? emails : chat,
  }),
  'incidents.select': { data: [] },
  'profiles.select': { data: people },
  'maintenance_series.select': { data: [seriesRow] },
  'notifications.select': { data: [] },
  'notifications.update': { data: [{ id: 'x' }] },
  ...extra,
});
const okPost = () => vi.fn(async () => ({ ok: true as const, messageName: 'spaces/S/messages/M' }));
const okSend = () => vi.fn(async () => ({ ok: true as const, id: 'em_1' }));
const updates = (calls: FakeCall[]) =>
  calls.filter((c) => c.table === 'notifications' && c.op === 'update').map((c) => c.values);

describe('repeating series messages', () => {
  it('claims series rows, and posts the action’s line in the series’ own thread', async () => {
    const post = okPost();
    const { db, rpcCalls } = fakeDb(queue([row()]));
    const result = await dispatchNotifications({ db, webhookUrl, email, appUrl, now, post });
    expect(result).toMatchObject({ chat: { sent: 1 } });
    expect(rpcCalls.find((c) => c.name === 'claim_notifications')?.args).toMatchObject({ p_series: true });
    const [, message, options] = post.mock.calls[0] as unknown as [
      string,
      { text: string },
      { threadKey: string },
    ];
    expect(message.text).toBe(
      'MAINTENANCE APPROVED · Tubtong · series every Tue · by Tao · 2 windows scheduled (Tue 15 Sep, Tue 22 Sep)',
    );
    expect(options).toMatchObject({ threadKey: 'ms-s1', messageId: 'client-n-line' });
  });

  it('@mentions the asker in an APPROVED reply', async () => {
    const post = okPost();
    const dm = row({
      id: 'n-dm',
      template: 'ms_dm',
      user_id: 'u-ploy',
      context: { ...row().context, dm: 'approved' },
    });
    const { db } = fakeDb(queue([dm]));
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, post });
    const [, message] = post.mock.calls[0] as unknown as [string, { text: string }];
    expect(message.text).toBe(
      '<users/PLOY> APPROVED · Tubtong · series every Tue 01:00 → 03:00 · by Tao 10:07 · 2 windows scheduled, to Tue 22 Sep',
    );
  });

  it('emails the backup in the series’ mail thread, replying once the thread exists', async () => {
    const send = okSend();
    const mail = row({
      id: 'e-s',
      channel: 'email',
      template: 'ms_email',
      user_id: 'u-nok',
      context: { ...row().context, role: 'backup', request: true },
    });
    const { db } = fakeDb(
      queue([], [mail], {
        'notifications.select': { data: [{ id: 'e-first', maintenance_series_id: 's1', user_id: 'u-nok' }] },
      }),
    );
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, send });
    const [message, options] = send.mock.calls[0] as unknown as [
      { subject: string; headers: Record<string, string> },
      { to: string },
    ];
    expect(message.subject).toBe('DxT Monitor · Maintenance request · Tubtong · series every Tue');
    expect(message.headers).toMatchObject({ 'In-Reply-To': '<ms-s1@notify.dxt.example>' });
    expect(options.to).toBe('nok@example.test');
  });

  it('a series gone or a rule it can’t read fails the row for good; an unreadable load retries', async () => {
    const gone = fakeDb(queue([row()], [], { 'maintenance_series.select': { data: [] } }));
    await dispatchNotifications({ db: gone.db, webhookUrl, email, appUrl, now, post: okPost() });
    expect(updates(gone.calls)).toContainEqual(expect.objectContaining({ status: 'failed' }));

    const bad = fakeDb(
      queue([row()], [], { 'maintenance_series.select': { data: [{ ...seriesRow, rule: { freq: 'x' } }] } }),
    );
    await dispatchNotifications({ db: bad.db, webhookUrl, email, appUrl, now, post: okPost() });
    expect(updates(bad.calls)).toContainEqual(expect.objectContaining({ status: 'failed' }));

    const down = fakeDb(queue([row()], [], { 'maintenance_series.select': { error: { message: 'boom' } } }));
    const post = okPost();
    await dispatchNotifications({ db: down.db, webhookUrl, email, appUrl, now, post });
    expect(post).not.toHaveBeenCalled();
    expect(updates(down.calls)).not.toContainEqual(expect.objectContaining({ status: 'failed' }));
  });
});

describe('repeating series: what the row carries', () => {
  it('words SKIPPED from its context: the window it overlaps and the next one', async () => {
    const post = okPost();
    const skip = row({
      id: 'n-skip',
      dedupe_key: '2026-10-05T18:00Z',
      context: {
        kind: 'skipped',
        at: NOW.toISOString(),
        startsAt: '2026-10-05T18:00:00Z',
        endsAt: '2026-10-05T20:00:00Z',
        next: '2026-10-12T18:00:00Z',
        overlap: {
          startsAt: '2026-10-05T17:00:00Z',
          endsAt: '2026-10-05T21:00:00Z',
          reason: 'Data-centre move',
        },
      },
    });
    const { db } = fakeDb(queue([skip]));
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, post });
    const [, message] = post.mock.calls[0] as unknown as [string, { text: string }];
    expect(message.text).toBe(
      'MAINTENANCE SKIPPED · Tubtong · Tue 6 Oct 01:00 → 03:00 · overlaps the 00:00 → 04:00 window (“Data-centre move”) · next Tue 13 Oct',
    );
  });

  it('the 12 h reminder emails an Admin; a row with an unknown kind or role is never sent', async () => {
    const send = okSend();
    const reminder = row({
      id: 'e-r',
      channel: 'email',
      template: 'ms_email',
      user_id: 'u-nok',
      context: { kind: 'reminder_12h', role: 'admin', request: true },
    });
    const odd = row({
      id: 'e-odd',
      channel: 'email',
      template: 'ms_email',
      user_id: 'u-nok',
      context: { kind: 'x', role: 'admin' },
    });
    const noRole = row({
      id: 'e-nr',
      channel: 'email',
      template: 'ms_email',
      user_id: 'u-nok',
      context: { kind: 'approved' },
    });
    const { db, calls } = fakeDb(queue([], [reminder, odd, noRole]));
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [{ subject: string }])[0].subject).toBe(
      'DxT Monitor · Maintenance request · Tubtong · series every Tue',
    );
    expect(updates(calls).filter((u) => (u as { status?: string }).status === 'failed')).toHaveLength(2);
  });

  it('a reply to someone no longer active, or an unknown template, fails for good', async () => {
    const gone = row({
      id: 'n-g',
      template: 'ms_dm',
      user_id: 'u-left',
      context: { kind: 'approved', dm: 'approved' },
    });
    const odd = row({ id: 'n-o', template: 'ms_other' });
    const { db, calls } = fakeDb(queue([gone, odd]));
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, post: okPost() });
    expect(updates(calls).filter((u) => (u as { status?: string }).status === 'failed')).toHaveLength(2);
  });
});

describe('a series window’s first line', () => {
  it('STARTED ends "· series every Tue"', async () => {
    const post = okPost();
    const line = row({
      id: 'n-w',
      maintenance_series_id: null,
      maintenance_window_id: 'w1',
      template: 'mw_line',
      thread_key: 'mw-w1',
      context: { kind: 'started', at: NOW.toISOString() },
    });
    const windowRow = {
      id: 'w1',
      kind: 'maintenance',
      starts_at: '2026-09-28T18:00:00Z',
      ends_at: '2026-09-28T20:00:00Z',
      reason: 'WordPress plugin updates',
      created_at: '2026-09-14T02:10:00Z',
      created_by: 'u-ploy',
      approved_at: '2026-09-14T04:20:00Z',
      creator: { display_name: 'Ploy' },
      approver: { display_name: 'Tao' },
      series: { rule: { freq: 'weekly', days: [2] } },
      sites: seriesRow.sites,
    };
    const { db } = fakeDb(queue([line], [], { 'maintenance_windows.select': { data: [windowRow] } }));
    await dispatchNotifications({
      db,
      webhookUrl,
      email,
      appUrl,
      now: () => new Date('2026-09-28T18:00:00Z'),
      post,
    });
    const [, message] = post.mock.calls[0] as unknown as [string, { text: string }];
    expect(message.text).toBe(
      'MAINTENANCE STARTED · Tubtong · until 03:00 · no alerts, not counted in uptime · series every Tue',
    );
  });
});
