// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb, type FakeCall } from '../../../test/fake-db';
import { dispatchNotifications } from './dispatch';

// The account emails (S16 PR 4, spec §34, D-062 item 13): one email to the event's own person, never
// threaded; the Access removed email is the one email an inactive person may get.
const appUrl = 'https://monitor.dxt.example';
const email = { apiKey: 're_test', from: 'DxT Monitor <alerts@notify.dxt.example>' };
const NOW = new Date('2026-09-25T03:08:30Z');
const now = () => NOW;

const facts = {
  actor: 'Tao',
  was_am: true,
  manages_clients: false,
  left_rotation: false,
  admins: [],
  moves: [{ kind: 'am', place: 'MuvMi', with: 'Thee' }],
};
const event = (over: Record<string, unknown> = {}) => ({
  id: 'ev1',
  kind: 'deactivated',
  user_id: 'u-bua',
  from_role: 'stakeholder',
  to_role: null,
  created_at: '2026-09-25T03:08:00Z',
  facts,
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  incident_id: null,
  system_alert_id: null,
  maintenance_window_id: null,
  maintenance_series_id: null,
  oncall_event_id: null,
  report_id: null,
  account_event_id: 'ev1',
  user_id: 'u-bua',
  channel: 'email',
  template: 'account_email',
  thread_key: 'account-ev1',
  attempts: 1,
  hold_until: null,
  created_at: '2026-09-25T03:08:00Z',
  context: {},
  ...over,
});
const bua = (active: boolean) => ({
  id: 'u-bua',
  email: 'bua@example.test',
  display_name: 'Bua',
  is_active: active,
});
const queue = (rows: unknown[], ev: unknown[], people: unknown[], extra: Record<string, unknown> = {}) => ({
  'rpc.claim_notifications': (c: FakeCall) => ({
    data: (c.values as { p_channel: string }).p_channel === 'email' ? rows : [],
  }),
  'incidents.select': { data: [] },
  'account_events.select': { data: ev },
  // Facts.recipients reads active people only (`is_active = true`): the inactive Bua isn't among them.
  'profiles.select': (c: FakeCall) => ({
    data: c.filters.some((f) => f[0] === 'eq' && f[1] === 'is_active')
      ? (people as { is_active: boolean }[]).filter((p) => p.is_active)
      : people,
  }),
  'notifications.select': { data: [] },
  'notifications.update': { data: [{ id: 'x' }] },
  ...extra,
});
const okSend = () => vi.fn(async () => ({ ok: true as const, id: 'em_1' }));
const updates = (calls: FakeCall[]) =>
  calls.filter((c) => c.table === 'notifications' && c.op === 'update').map((c) => c.values);

describe('account emails', () => {
  it('claims account rows and sends Access removed to the deactivated person (the one exception)', async () => {
    const send = okSend();
    const { db, rpcCalls } = fakeDb(queue([row()], [event()], [bua(false)]));
    const result = await dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send });
    expect(result).toMatchObject({ email: { sent: 1 } });
    expect(rpcCalls.find((c) => c.name === 'claim_notifications')?.args).toMatchObject({ p_account: true });
    expect(send).toHaveBeenCalledTimes(1);
    const [message, opts] = send.mock.calls[0] as unknown as [
      { subject: string; headers: Record<string, string>; text: string },
      { to: string },
    ];
    expect(opts.to).toBe('bua@example.test');
    expect(message.subject).toBe('Your DxT Monitor access was removed');
    expect(message.headers).toEqual({ References: '<account-ev1@notify.dxt.example>' });
    expect(message.text).toContain('Site AM — MuvMi · Thee');
  });

  it('a role-change email to someone now inactive is refused', async () => {
    const send = okSend();
    const ev = event({ kind: 'role_changed', to_role: 'viewer' });
    const { db, calls } = fakeDb(queue([row()], [ev], [bua(false)]));
    await dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send });
    expect(send).not.toHaveBeenCalled();
    expect(updates(calls)).toContainEqual(
      expect.objectContaining({ status: 'failed', error: 'Recipient not found or inactive' }),
    );
  });

  it('an account row for anyone but the event’s person is refused, even for a deactivation', async () => {
    const send = okSend();
    const other = { id: 'u-tao', email: 'tao@example.test', display_name: 'Tao', is_active: true };
    const { db, calls } = fakeDb(queue([row({ user_id: 'u-tao' })], [event()], [bua(false), other]));
    await dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send });
    expect(send).not.toHaveBeenCalled();
    expect(updates(calls)).toContainEqual(
      expect.objectContaining({ status: 'failed', error: 'Account emails go to their own person only' }),
    );
  });

  it('every other email to an inactive person is still refused (security review H1)', async () => {
    const send = okSend();
    // A system-alert email to the deactivated Bua, claimed in the same pass as their Access removed email.
    const alertRow = row({
      id: 'n2',
      account_event_id: null,
      system_alert_id: 'a1',
      template: 'probe_locations_low',
    });
    const { db, calls } = fakeDb(
      queue([row(), alertRow], [event()], [bua(false)], {
        'system_alerts.select': {
          data: [{ id: 'a1', kind: 'probe_locations_low', opened_at: NOW.toISOString(), context: {} }],
        },
      }),
    );
    await dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [{ subject: string }])[0].subject).toBe(
      'Your DxT Monitor access was removed',
    );
    expect(updates(calls)).toContainEqual(
      expect.objectContaining({ status: 'failed', error: 'Recipient not found or inactive' }),
    );
  });

  it.each([
    ['a Chat row', { channel: 'google_chat' }],
    ['another template', { template: 'probe_locations_low' }],
    ['no person', { user_id: null }],
  ])('%s on an account event is refused', async (_, over) => {
    const send = okSend();
    const { db, calls } = fakeDb(queue([row(over)], [event()], [bua(false)]));
    await dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send });
    expect(send).not.toHaveBeenCalled();
    expect(updates(calls)).toContainEqual(
      expect.objectContaining({ status: 'failed', error: 'Account emails go to their own person only' }),
    );
  });

  it('Access removed is not sent once the person was invited back (code review)', async () => {
    const send = okSend();
    const { db, calls } = fakeDb(queue([row()], [event()], [bua(true)]));
    await dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send });
    expect(send).not.toHaveBeenCalled();
    expect(updates(calls)).toContainEqual(
      expect.objectContaining({ status: 'failed', error: 'Access given back before it was sent' }),
    );
  });

  it('an email that can’t be rendered fails its row only (code review)', async () => {
    const send = okSend();
    const ev = event({ kind: 'role_changed', from_role: 'admin', to_role: 'client' });
    const { db, calls } = fakeDb(queue([row()], [ev], [bua(true)]));
    const result = await dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send });
    expect(result.ok).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(updates(calls)).toContainEqual(expect.objectContaining({ status: 'failed' }));
  });

  it('a row queued over 24 h ago is not sent late (email was off, D-013)', async () => {
    const send = okSend();
    const old = row({ created_at: '2026-09-24T03:00:00Z' });
    const { db, calls } = fakeDb(queue([old], [event()], [bua(false)]));
    await dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send });
    expect(send).not.toHaveBeenCalled();
    expect(updates(calls)).toContainEqual(expect.objectContaining({ status: 'failed' }));
  });

  it('an unreadable event retries; the outage alerts of the pass still go', async () => {
    const send = okSend();
    const { db, calls } = fakeDb(
      queue([row()], [], [bua(false)], { 'account_events.select': { error: { message: 'boom' } } }),
    );
    await dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send });
    expect(send).not.toHaveBeenCalled();
    expect(updates(calls)).toContainEqual(expect.objectContaining({ status: 'queued' }));
  });

  it('a database without p_account yet (PGRST202): claims without it, nothing stalls', async () => {
    const send = okSend();
    let first = true;
    const { db, rpcCalls } = fakeDb(
      queue([], [], [], {
        'rpc.claim_notifications': (c: FakeCall) => {
          if ((c.values as Record<string, unknown>).p_account && first) {
            first = false;
            return { error: { message: 'Could not find the function', code: 'PGRST202' } };
          }
          return { data: [] };
        },
      }),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send });
    expect(result.ok).toBe(true);
    const claims = rpcCalls.filter((c) => c.name === 'claim_notifications').map((c) => c.args);
    expect(claims).toHaveLength(2);
    expect(claims[1]).not.toHaveProperty('p_account');
    log.mockRestore();
  });
});
