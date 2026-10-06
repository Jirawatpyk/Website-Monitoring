// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb, type FakeCall } from '../../../test/fake-db';
import { afterAttempt, BACKOFF_MS, dispatchNotifications, MAX_ATTEMPTS, runNotifierSweep } from './dispatch';
import { notifierDeps } from './deps';
import { domainOf } from './render';
import { TEST_ENV } from '../../../test/env';

const webhookUrl = 'https://chat.googleapis.com/v1/spaces/S/messages?key=K&token=T';
const appUrl = 'https://monitor.dxt.example';
const email = { apiKey: 're_test', from: 'DxT Monitor <alerts@notify.dxt.example>' };
const now = () => new Date('2026-10-06T03:00:00Z');
const created = '2026-10-06T02:48:45Z';

const notification = (template: string, over: Record<string, unknown> = {}) => ({
  id: `n-${template}`,
  incident_id: 'i1',
  user_id: null as string | null,
  channel: 'google_chat',
  template,
  thread_key: 'i1',
  attempts: 1,
  hold_until: null as string | null,
  created_at: created,
  context: {} as Record<string, unknown>,
  ...over,
});
const mail = (template: string, over: Record<string, unknown> = {}) =>
  notification(template, { id: `e-${template}`, channel: 'email', user_id: 'u-arm', ...over });

const incident = {
  id: 'i1',
  number: 7,
  started_at: '2026-10-06T02:47:30Z',
  detected_at: '2026-10-06T02:48:41Z',
  acked_at: '2026-10-06T02:55:10Z',
  recovered_at: '2026-10-06T03:30:30Z',
  acker: { display_name: 'Arm' },
  sites: {
    name: 'Test target',
    tier: 1,
    primary: { id: 'u-arm', display_name: 'Arm', google_chat_user_id: 'ARM' },
    backup: null,
  },
};
const people = [
  { id: 'u-arm', email: 'arm@example.test', display_name: 'Arm' },
  { id: 'u-tao', email: 'tao@example.test', display_name: 'Tao' },
];

/** Claims by channel: what each `claim_notifications(channel)` returns. */
const queue = (chat: unknown[], emails: unknown[] = []) => ({
  'rpc.claim_notifications': (c: FakeCall) => ({
    data: (c.values as { p_channel: string }).p_channel === 'email' ? emails : chat,
  }),
  'incidents.select': { data: [incident] },
  'profiles.select': { data: people },
});

const okPost = () => vi.fn(async () => ({ ok: true as const, messageName: 'spaces/S/messages/M' }));
const okSend = () => vi.fn(async () => ({ ok: true as const, id: 'em_1' }));
const updates = (calls: FakeCall[]) =>
  calls.filter((c) => c.table === 'notifications' && c.op === 'update').map((c) => c.values);

describe('dispatchNotifications', () => {
  it('leaves a channel queued when it isn’t configured', async () => {
    const { db, rpcCalls } = fakeDb();
    expect(await dispatchNotifications({ db, webhookUrl: undefined, email: undefined, appUrl })).toEqual({
      ok: true,
      chat: 'no_webhook',
      email: 'not_configured',
    });
    expect(rpcCalls).toEqual([]);
  });

  it('does nothing when no message is due', async () => {
    const { db } = fakeDb(queue([]));
    expect(await dispatchNotifications({ db, webhookUrl, email, appUrl })).toEqual({
      ok: true,
      chat: { sent: 0, retrying: 0, failed: 0 },
      email: { sent: 0, retrying: 0, failed: 0 },
    });
  });

  it('posts DOWN, ACKNOWLEDGED and RECOVERED in the incident thread and records each delivery', async () => {
    const { db, calls } = fakeDb(
      queue([
        notification('down', { context: { cause: 'HTTP 500 (SIN, TYO)', confirmingLocations: 2 } }),
        notification('acknowledged', {
          hold_until: '2026-10-06T02:55:20Z',
          context: { ackedBy: 'Arm', ackedById: 'u-arm', ackedAt: '2026-10-06T02:55:10Z' },
        }),
        notification('recovered', { context: { okLocations: 2 } }),
      ]),
    );
    const post = okPost();
    expect(
      await dispatchNotifications({ db, webhookUrl, email: undefined, appUrl, now, post }),
    ).toMatchObject({
      chat: { sent: 3, retrying: 0, failed: 0 },
    });

    const posted = post.mock.calls as unknown as [string, { text: string; cardsV2: unknown[] }, unknown][];
    expect(posted.map((c) => c[1].text)).toEqual([
      '<users/ARM> DOWN · Test target (Tier 1)',
      'ACKNOWLEDGED · Test target · by Arm 09:55',
      '<users/ARM> RECOVERED · Test target · down 43 min · add a root cause',
    ]);
    expect(JSON.stringify(posted[0]?.[1].cardsV2)).toContain(
      'https://monitor.dxt.example/incidents/i1?ack=1',
    );
    // messageId makes a retry after an unrecorded success a no-op.
    expect(posted[0]?.[2]).toEqual({ threadKey: 'i1', messageId: 'client-n-down' });

    expect(updates(calls)[0]).toEqual({
      status: 'sent',
      sent_at: '2026-10-06T03:00:00.000Z',
      provider_message_id: 'spaces/S/messages/M',
      error: null,
      next_retry_at: null,
    });
    expect(calls.filter((c) => c.table === 'notification_attempts').map((c) => c.values)).toContainEqual({
      notification_id: 'n-down',
      attempt: 1,
      ok: true,
      error: null,
      provider_message_id: 'spaces/S/messages/M',
      at: '2026-10-06T03:00:00.000Z',
    });
    expect(calls.filter((c) => c.table === 'incident_events').map((c) => c.values)).toContainEqual({
      incident_id: 'i1',
      type: 'alerted',
      payload: { channel: 'google_chat', template: 'down' },
    });
  });

  it('emails each person with their own footer, threaded by the DOWN email', async () => {
    const { db, calls } = fakeDb(
      queue(
        [],
        [
          mail('down', { context: { cause: 'HTTP 500 (SIN, TYO)', confirmingLocations: 2 } }),
          mail('acknowledged', {
            id: 'e-ack',
            context: { ackedBy: 'Arm', ackedById: 'u-arm', ackedAt: '2026-10-06T02:55:10Z' },
          }),
          mail('recovered', { id: 'e-rec-tao', user_id: 'u-tao', context: { okLocations: 2 } }),
        ],
      ),
    );
    const send = okSend();
    expect(
      await dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send }),
    ).toMatchObject({
      email: { sent: 3 },
    });

    const sent = send.mock.calls as unknown as [
      { subject: string; text: string; headers: Record<string, string> },
      { to: string; idempotencyKey: string; from: string },
    ][];
    expect(sent.map(([m, o]) => [m.subject, o.to, o.idempotencyKey])).toEqual([
      ['Test target · Tier 1 · INC-0007', 'arm@example.test', 'notification-e-down'],
      ['Test target · Tier 1 · INC-0007', 'arm@example.test', 'notification-e-ack'],
      ['Test target · Tier 1 · INC-0007', 'tao@example.test', 'notification-e-rec-tao'],
    ]);
    expect(sent[0]?.[0].text).toContain('You got this because you own Test target.');
    expect(sent[0]?.[0].headers['Message-ID']).toBe('<inc-i1.down.u-arm@notify.dxt.example>');
    expect(sent[1]?.[0].text).toContain('You got this because you acknowledged this incident.');
    expect(sent[1]?.[0].headers['In-Reply-To']).toBe('<inc-i1.down.u-arm@notify.dxt.example>');
    expect(sent[2]?.[0].text).toContain('Acknowledged: Arm at 09:55');
    expect(sent[2]?.[0].text).toContain('couldn’t be delivered');
    expect(calls.filter((c) => c.table === 'incident_events').map((c) => c.values)).toContainEqual({
      incident_id: 'i1',
      type: 'alerted',
      payload: { channel: 'email', template: 'down', user_id: 'u-arm' },
    });
  });

  it('retries a failed Chat post at +30 s, +2 min, +8 min, then falls back to email', async () => {
    const post = vi.fn(async () => ({ ok: false as const, error: 'HTTP 503' }));
    const at = (attempts: number) => {
      const { db, calls, rpcCalls } = fakeDb({
        ...queue([notification('down', { attempts })]),
        'rpc.queue_fallback_emails': { data: 2 },
      });
      return {
        run: () => dispatchNotifications({ db, webhookUrl, email: undefined, appUrl, now, post }),
        calls,
        rpcCalls,
      };
    };

    for (const [attempts, retry] of [
      [1, '2026-10-06T02:49:15.000Z'],
      [2, '2026-10-06T02:50:45.000Z'],
      [3, '2026-10-06T02:56:45.000Z'],
    ] as const) {
      const r = at(attempts);
      expect(await r.run()).toMatchObject({ chat: { retrying: 1 } });
      expect(updates(r.calls)).toEqual([{ status: 'queued', error: 'HTTP 503', next_retry_at: retry }]);
      expect(r.rpcCalls.some((c) => c.name === 'queue_fallback_emails')).toBe(false);
    }

    const last = at(MAX_ATTEMPTS);
    expect(await last.run()).toMatchObject({ chat: { failed: 1 } });
    expect(updates(last.calls)).toEqual([{ status: 'failed', error: 'HTTP 503', next_retry_at: null }]);
    expect(last.rpcCalls).toContainEqual({
      name: 'queue_fallback_emails',
      args: { p_notification_id: 'n-down' },
    });
    expect(last.calls.some((c) => c.table === 'incident_events')).toBe(false);
  });

  it('gives up on an email the provider refuses for good, without a fallback', async () => {
    const send = vi.fn(async () => ({ ok: false as const, error: 'HTTP 422: invalid', retryable: false }));
    const { db, calls, rpcCalls } = fakeDb(queue([], [mail('down')]));
    await dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send });
    expect(updates(calls)).toEqual([{ status: 'failed', error: 'HTTP 422: invalid', next_retry_at: null }]);
    expect(rpcCalls.some((c) => c.name === 'queue_fallback_emails')).toBe(false);
  });

  it.each([
    [notification('escalated'), "Can't render template escalated"],
    [notification('recovered', { incident_id: 'gone' }), 'Incident not found'],
    [mail('escalated'), "Can't render template escalated"],
    [mail('down', { user_id: 'u-nobody' }), 'Recipient not found'],
  ])('fails a message it can’t send without sending (%#)', async (row, error) => {
    const { db, calls } = fakeDb({
      ...queue(row.channel === 'email' ? [] : [row], row.channel === 'email' ? [row] : []),
    });
    const post = okPost();
    const send = okSend();
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, post, send });
    expect(post).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(updates(calls)[0]).toMatchObject({ status: 'failed', error });
  });

  it('uses safe defaults when the stored context is missing', async () => {
    const { db } = fakeDb({
      ...queue([notification('down'), notification('acknowledged'), notification('recovered')]),
      'incidents.select': { data: [{ ...incident, sites: { ...incident.sites, primary: null } }] },
    });
    const post = okPost();
    await dispatchNotifications({ db, webhookUrl, email: undefined, appUrl, now, post });
    const msgs = (post.mock.calls as unknown as [string, { text: string; cardsV2: unknown }][]).map(
      (c) => c[1],
    );
    expect(JSON.stringify(msgs[0]?.cardsV2)).toContain('2 locations, 2 checks');
    expect(msgs[1]?.text).toBe('ACKNOWLEDGED · Test target · by someone 09:48');
    expect(msgs[2]?.text).toBe('RECOVERED · Test target · down 43 min · add a root cause');
  });

  it.each([
    ['rpc.claim_notifications', 'claim_notifications: boom'],
    ['incidents.select', 'incidents: boom'],
    ['profiles.select', 'profiles: boom'],
    ['notifications.update', 'notifications: boom'],
    ['notification_attempts.insert', 'notification_attempts: boom'],
    ['incident_events.insert', 'incident_events: boom'],
  ])('throws when %s fails', async (key, message) => {
    const { db } = fakeDb({ ...queue([], [mail('down')]), [key]: { error: { message: 'boom' } } });
    await expect(
      dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send: okSend() }),
    ).rejects.toThrow(message);
  });

  it('throws when the fallback can’t be queued', async () => {
    const { db } = fakeDb({
      ...queue([notification('down', { attempts: MAX_ATTEMPTS })]),
      'rpc.queue_fallback_emails': { error: { message: 'boom' } },
    });
    const post = vi.fn(async () => ({ ok: false as const, error: 'HTTP 500' }));
    await expect(
      dispatchNotifications({ db, webhookUrl, email: undefined, appUrl, now, post }),
    ).rejects.toThrow('queue_fallback_emails: boom');
  });
});

describe('afterAttempt', () => {
  const row = { attempts: 1, hold_until: '2026-10-06T03:00:10Z', created_at: created };
  it('times retries from when a held message was due', () => {
    expect(afterAttempt(row, { ok: false, error: 'x', retryable: true }, new Date())).toMatchObject({
      next_retry_at: new Date(Date.parse('2026-10-06T03:00:10Z') + BACKOFF_MS[0]).toISOString(),
    });
  });
});

describe('runNotifierSweep', () => {
  it('runs two passes 30 s apart', async () => {
    const { db, rpcCalls } = fakeDb(queue([]));
    const sleep = vi.fn(async () => {});
    const result = await runNotifierSweep({ db, webhookUrl, email, appUrl }, { sleep });
    expect(sleep).toHaveBeenCalledWith(30_000);
    expect(rpcCalls.filter((c) => c.name === 'claim_notifications')).toHaveLength(4);
    expect(result).toMatchObject({ ok: true, passes: [{ ok: true }, { ok: true }] });
  });
});

describe('notifierDeps', () => {
  it('turns email on only with both the key and the sender', () => {
    const env = { ...TEST_ENV, RESEND_API_KEY: 're_x', ALERT_EMAIL_FROM: email.from } as never;
    expect(notifierDeps('db' as never, env).email).toEqual({ apiKey: 're_x', from: email.from });
    expect(
      notifierDeps('db' as never, { ...TEST_ENV, RESEND_API_KEY: 're_x' } as never).email,
    ).toBeUndefined();
  });

  it('reads the domain of the sending address', () => {
    expect(domainOf(email.from)).toBe('notify.dxt.example');
    expect(domainOf('alerts@plain.example')).toBe('plain.example');
    expect(domainOf('nobody')).toBe('localhost');
  });
});
