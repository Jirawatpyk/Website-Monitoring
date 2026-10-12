// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb, type FakeCall } from '../../../test/fake-db';
import { dispatchNotifications, MAX_ATTEMPTS } from './dispatch';

// Maintenance windows and mutes (S09b, spec §24, D-037): their own Chat thread and mail thread.
const webhookUrl = 'https://chat.googleapis.com/v1/spaces/S/messages?key=K&token=T';
const appUrl = 'https://monitor.dxt.example';
const email = { apiKey: 're_test', from: 'DxT Monitor <alerts@notify.dxt.example>' };
const NOW = new Date('2026-10-06T03:00:00Z');
const now = () => NOW;
const created = '2026-10-06T02:48:45Z';

const windowRow = {
  id: 'w1',
  kind: 'maintenance',
  starts_at: '2026-10-06T18:00:00Z',
  ends_at: '2026-10-06T20:00:00Z',
  reason: 'Plugin updates',
  created_at: '2026-10-06T02:00:00Z',
  approved_at: '2026-10-06T02:00:00Z',
  creator: { display_name: 'Arm' },
  approver: { display_name: 'Arm' },
  sites: {
    name: 'Tubtong',
    tier: 2,
    primary: { id: 'u-tao', display_name: 'Tao', google_chat_user_id: 'TAO' },
    backup: { id: 'u-arm', display_name: 'Arm', google_chat_user_id: 'ARM' },
  },
};
const people = [
  { id: 'u-arm', email: 'arm@example.test', display_name: 'Arm', google_chat_user_id: 'ARM' },
  { id: 'u-tao', email: 'tao@example.test', display_name: 'Tao', google_chat_user_id: 'TAO' },
];
const row = (over: Record<string, unknown> = {}) => ({
  id: 'n-line',
  incident_id: null,
  system_alert_id: null,
  maintenance_window_id: 'w1',
  user_id: null as string | null,
  channel: 'google_chat',
  template: 'mw_line',
  thread_key: 'mw-w1',
  attempts: 1,
  hold_until: null,
  created_at: created,
  context: { kind: 'scheduled', by: 'Arm', at: created } as Record<string, unknown>,
  ...over,
});
const queue = (chat: unknown[], emails: unknown[] = [], windows: unknown[] = [windowRow]) => ({
  'rpc.claim_notifications': (c: FakeCall) => ({
    data: (c.values as { p_channel: string }).p_channel === 'email' ? emails : chat,
  }),
  'incidents.select': { data: [] },
  'profiles.select': { data: people },
  'maintenance_windows.select': { data: windows },
  'notifications.update': { data: [{ id: 'x' }] },
});
const okPost = () => vi.fn(async () => ({ ok: true as const, messageName: 'spaces/S/messages/M' }));
const okSend = () => vi.fn(async () => ({ ok: true as const, id: 'em_1' }));
const updates = (calls: FakeCall[]) =>
  calls.filter((c) => c.table === 'notifications' && c.op === 'update').map((c) => c.values);

describe('maintenance window messages', () => {
  it('posts the action’s line in the window’s own thread, with no timeline event', async () => {
    const post = okPost();
    const { db, calls } = fakeDb(queue([row()]));
    const result = await dispatchNotifications({ db, webhookUrl, email, appUrl, now, post });
    expect(result).toMatchObject({ chat: { sent: 1 } });
    const [, message, options] = post.mock.calls[0] as unknown as [
      string,
      { text: string },
      { threadKey: string },
    ];
    expect(message.text).toBe(
      'MAINTENANCE SCHEDULED · Tubtong · Wed 7 Oct 01:00 → 03:00 (2 h) · “Plugin updates” · by Arm',
    );
    expect(options).toMatchObject({ threadKey: 'mw-w1', messageId: 'client-n-line' });
    expect(calls.some((c) => c.table === 'incident_events')).toBe(false);
  });

  it('@mentions the person a "direct message" goes to', async () => {
    const post = okPost();
    const dm = row({
      id: 'n-dm',
      template: 'mw_dm',
      user_id: 'u-tao',
      context: { kind: 'muted', dm: 'muted', by: 'Arm' },
    });
    const { db } = fakeDb(queue([dm]));
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, post });
    const [, message] = post.mock.calls[0] as unknown as [string, { text: string }];
    expect(message.text.startsWith('<users/TAO> MUTED · Tubtong · ')).toBe(true);
  });

  it('a reminder reads the window as it is now', async () => {
    const post = okPost();
    const dm = row({
      id: 'n-r',
      template: 'mw_dm',
      user_id: 'u-tao',
      context: { kind: 'reminder_1h', dm: 'reminder_1h' },
    });
    const { db } = fakeDb(
      queue([dm], [], [{ ...windowRow, starts_at: '2026-10-06T04:00:00Z', ends_at: '2026-10-07T10:00:00Z' }]),
    );
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, post });
    const [, message] = post.mock.calls[0] as unknown as [string, { text: string }];
    expect(message.text).toBe(
      '<users/TAO> WAITING FOR APPROVAL · Tubtong · starts in 1 h (11:00) · last reminder · asked by Arm',
    );
  });

  it('emails the owner in the window’s mail thread', async () => {
    const send = okSend();
    const mail = row({
      id: 'e-w',
      channel: 'email',
      template: 'mw_email',
      user_id: 'u-tao',
      context: { kind: 'scheduled', role: 'owner', by: 'Arm', request: false },
    });
    const { db } = fakeDb(queue([], [mail]));
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, send });
    const [message, options] = send.mock.calls[0] as unknown as [
      { subject: string; headers: Record<string, string>; text: string },
      { to: string },
    ];
    expect(message.subject).toBe('Tubtong · Maintenance · Wed 7 Oct 01:00');
    expect(message.headers).toEqual({ References: '<mw-w1@notify.dxt.example>' });
    expect(message.text).toContain('You got this because you own Tubtong.');
    expect(options.to).toBe('tao@example.test');
  });

  it('MUTED: one reply @mentioning the owner and the backup together (context.mention)', async () => {
    const post = okPost();
    const reply = row({
      id: 'n-muted',
      template: 'mw_dm',
      context: {
        kind: 'muted',
        dm: 'muted',
        by: 'Nok',
        at: created,
        mention: [
          { name: 'Tao', chat: 'TAO' },
          { name: 'Arm', chat: 'ARM' },
        ],
      },
    });
    const { db } = fakeDb(queue([reply], [], [{ ...windowRow, kind: 'mute' }]));
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, post });
    const [, message] = post.mock.calls[0] as unknown as [string, { text: string }];
    expect(message.text).toBe(
      '<users/TAO> <users/ARM> MUTED · Tubtong · until Wed 7 Oct 03:00 · “Plugin updates” · by Nok · still counted in uptime',
    );
  });

  it('the asker reads "Your request …"; the approver gets the didn’t-start email (redrawn EmailAlert)', async () => {
    const send = okSend();
    const asker = row({
      id: 'e-asker',
      channel: 'email',
      template: 'mw_email',
      user_id: 'u-arm',
      context: { kind: 'approved', role: 'backup', by: 'Tao', at: created, request: true },
    });
    const approver = row({
      id: 'e-approver',
      channel: 'email',
      template: 'mw_email',
      user_id: 'u-tao',
      context: { kind: 'didnt_start', role: 'approver', at: created, request: true },
    });
    const { db } = fakeDb(queue([], [asker, approver]));
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, send });
    const texts = send.mock.calls.map((c) => (c as unknown as [{ text: string }])[0].text);
    expect(texts.find((t) => t.startsWith('MAINTENANCE APPROVED'))).toContain(
      'Your request was approved. It starts on its own at Wed 7 Oct 01:00.',
    );
    expect(texts.find((t) => t.startsWith('DIDN’T START'))).toContain(
      'You got this because you approved this window.',
    );
  });

  it('a failed window line gets no email fallback (the owner and backup are emailed anyway)', async () => {
    const post = vi.fn(async () => ({ ok: false as const, error: 'HTTP 500' }));
    const { db, rpcCalls } = fakeDb(queue([row({ attempts: MAX_ATTEMPTS })]));
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, post });
    expect(rpcCalls.some((c) => c.name === 'queue_fallback_emails')).toBe(false);
  });

  it.each([
    ['a window that is gone', row(), [], 'Maintenance window not found'],
    [
      'an action it can’t word',
      row({ context: { kind: 'mystery' } }),
      [windowRow],
      "Can't render template mw_line",
    ],
    [
      'a mention with nobody to mention',
      row({ template: 'mw_dm', user_id: 'u-gone', context: { kind: 'muted', dm: 'muted' } }),
      [windowRow],
      "Can't render template mw_dm",
    ],
  ])('fails for good on %s', async (_name, r, windows, error) => {
    const { db, calls } = fakeDb(queue([r], [], windows));
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, post: okPost() });
    expect(updates(calls)).toEqual([expect.objectContaining({ status: 'failed', error })]);
  });

  it('fails an email to someone inactive, or with a role it can’t word', async () => {
    const send = okSend();
    const gone = row({
      id: 'e-1',
      channel: 'email',
      template: 'mw_email',
      user_id: 'u-gone',
      context: { kind: 'scheduled', role: 'owner' },
    });
    const odd = row({
      id: 'e-2',
      channel: 'email',
      template: 'mw_email',
      user_id: 'u-tao',
      context: { kind: 'scheduled', role: 'ceo' },
    });
    const { db, calls } = fakeDb(queue([], [gone, odd]));
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, send });
    expect(send).not.toHaveBeenCalled();
    expect(updates(calls)).toEqual([
      expect.objectContaining({ status: 'failed', error: 'Recipient not found or inactive' }),
      expect.objectContaining({ status: 'failed', error: "Can't render template mw_email" }),
    ]);
  });
});
