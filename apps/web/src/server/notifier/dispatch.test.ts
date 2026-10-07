// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb, type FakeCall } from '../../../test/fake-db';
import { TEST_ENV } from '../../../test/env';
import {
  afterAttempt,
  BACKOFF_MS,
  dispatchNotifications,
  MAX_ATTEMPTS,
  ROW_BUDGET_MS,
  runNotifierSweep,
} from './dispatch';
import { notifierDeps } from './deps';

const webhookUrl = 'https://chat.googleapis.com/v1/spaces/S/messages?key=K&token=T';
const appUrl = 'https://monitor.dxt.example';
const email = { apiKey: 're_test', from: 'DxT Monitor <alerts@notify.dxt.example>' };
const NOW = new Date('2026-10-06T03:00:00Z');
const now = () => NOW;
/** NOW for the first reading (before the claim), 5 s later after that. */
const later = () => {
  let reads = 0;
  return () => new Date(NOW.getTime() + (reads++ === 0 ? 0 : 5_000));
};
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
  state: 'unacked',
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

/** Claims by channel; every row update succeeds unless a test says otherwise. */
const queue = (chat: unknown[], emails: unknown[] = [], over: Partial<typeof incident> = {}) => ({
  'rpc.claim_notifications': (c: FakeCall) => ({
    data: (c.values as { p_channel: string }).p_channel === 'email' ? emails : chat,
  }),
  'incidents.select': { data: [{ ...incident, ...over }] },
  'profiles.select': { data: people },
  'notifications.update': { data: [{ id: 'x' }] },
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
    const empty = { sent: 0, retrying: 0, failed: 0, superseded: 0, released: 0 };
    expect(await dispatchNotifications({ db, webhookUrl, email, appUrl })).toEqual({
      ok: true,
      chat: empty,
      email: empty,
    });
  });

  it('posts DOWN, ACKNOWLEDGED and RECOVERED in the incident thread and records each delivery', async () => {
    const rows = [
      notification('down', { context: { cause: 'HTTP 500 (SIN, TYO)', confirmingLocations: 2 } }),
      notification('acknowledged', {
        hold_until: '2026-10-06T02:55:20Z',
        context: { ackedBy: 'Arm', ackedById: 'u-arm', ackedAt: '2026-10-06T02:55:10Z' },
      }),
      notification('recovered', { context: { okLocations: 2 } }),
    ];
    const { db, calls } = fakeDb(queue(rows));
    const post = okPost();
    expect(
      await dispatchNotifications({ db, webhookUrl, email: undefined, appUrl, now, post }),
    ).toMatchObject({ chat: { sent: 3, retrying: 0, failed: 0 } });

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

    const first = calls.find((c) => c.table === 'notifications' && c.op === 'update');
    expect(first?.values).toEqual({
      status: 'sent',
      sent_at: '2026-10-06T03:00:00.000Z',
      provider_message_id: 'spaces/S/messages/M',
      error: null,
      next_retry_at: null,
    });
    // Written only while the claim is still ours.
    expect(first?.filters).toEqual([
      ['eq', 'id', 'n-down'],
      ['eq', 'status', 'queued'],
      ['eq', 'attempts', 1],
    ]);
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

  it('emails each person with their own footer, replying to the first email they really got', async () => {
    const { db } = fakeDb({
      ...queue(
        [],
        [
          mail('down', { context: { cause: 'HTTP 500 (SIN, TYO)', confirmingLocations: 2 } }),
          mail('acknowledged', {
            id: 'e-ack',
            context: { ackedBy: 'Arm', ackedById: 'u-arm', ackedAt: '2026-10-06T02:55:10Z' },
          }),
          mail('recovered', { id: 'e-rec-tao', user_id: 'u-tao', context: { okLocations: 2 } }),
        ],
        { state: 'acknowledged' },
      ),
      // Tao's first email of the incident was the ACKNOWLEDGED fallback, not a DOWN.
      'notifications.select': {
        data: [
          { id: 'e-down', incident_id: 'i1', user_id: 'u-arm', provider_message_id: 'em_down' },
          { id: 'e-ack-tao', incident_id: 'i1', user_id: 'u-tao', provider_message_id: 'em_ack_tao' },
          { id: 'e-rec-tao', incident_id: 'i1', user_id: 'u-tao', provider_message_id: null },
        ],
      },
    });
    const send = okSend();
    // Even with the incident acknowledged the DOWN email goes: it is the owner's record (PRD §7).
    expect(
      await dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send }),
    ).toMatchObject({ email: { sent: 3, superseded: 0 } });

    const sent = send.mock.calls as unknown as [
      { subject: string; text: string; headers: Record<string, string> },
      { to: string; idempotencyKey: string },
    ][];
    sent.shift(); // the DOWN record
    expect(sent.map(([m, o]) => [m.subject, o.to, o.idempotencyKey])).toEqual([
      ['Test target · Tier 1 · INC-0007', 'arm@example.test', 'notification-e-ack'],
      ['Test target · Tier 1 · INC-0007', 'tao@example.test', 'notification-e-rec-tao'],
    ]);
    expect(sent[0]?.[0].text).toContain('You got this because you acknowledged this incident.');
    // Everyone's emails hang on the incident's thread id; only a person's first starts it.
    const thread = '<inc-i1@notify.dxt.example>';
    expect(sent[0]?.[0].headers).toEqual({ 'In-Reply-To': thread, References: thread });
    expect(sent[1]?.[0].headers).toEqual({ 'In-Reply-To': thread, References: thread });
    expect(sent[1]?.[0].text).toContain('couldn’t be delivered');
  });

  it('starts a person’s thread with their first email: no reply headers on it', async () => {
    const { db } = fakeDb({
      ...queue([], [mail('down')]),
      'notifications.select': {
        data: [{ id: 'e-down', incident_id: 'i1', user_id: 'u-arm', provider_message_id: null }],
      },
    });
    const send = okSend();
    await dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send });
    const [m] = send.mock.calls[0] as unknown as [{ headers: Record<string, string> }];
    expect(m.headers).toEqual({ References: '<inc-i1@notify.dxt.example>' });
  });

  it('drops a DOWN that hasn’t left once the incident has moved on (ChatAlert: latest reply = status)', async () => {
    const { db, calls } = fakeDb(queue([notification('down')], [], { state: 'monitoring' }));
    const post = okPost();
    expect(
      await dispatchNotifications({ db, webhookUrl, email: undefined, appUrl, now, post }),
    ).toMatchObject({ chat: { superseded: 1, sent: 0 } });
    expect(post).not.toHaveBeenCalled();
    expect(updates(calls)).toEqual([
      // The claim's attempt never happened: it is given back.
      {
        status: 'cancelled',
        error: 'Superseded: the incident moved on first',
        next_retry_at: null,
        attempts: 0,
      },
    ]);
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

  it('does nothing more when another run took the message over (lease lost)', async () => {
    const { db, calls, rpcCalls } = fakeDb({
      ...queue([notification('down', { attempts: MAX_ATTEMPTS })]),
      'notifications.update': { data: [] },
    });
    const post = vi.fn(async () => ({ ok: false as const, error: 'HTTP 500' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      await dispatchNotifications({ db, webhookUrl, email: undefined, appUrl, now, post }),
    ).toMatchObject({ chat: { sent: 0, failed: 0 } });
    expect(rpcCalls.some((c) => c.name === 'queue_fallback_emails')).toBe(false);
    expect(calls.some((c) => c.table === 'incident_events')).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('delivery_lease_lost'));
    warn.mockRestore();
  });

  it('starts no send that could end after the deadline, and hands the rest back', async () => {
    const rows = [notification('down', { attempts: 2 }), notification('recovered', { id: 'n-rec' })];
    const { db, calls } = fakeDb(queue(rows));
    const post = okPost();
    // Time passes between the claim and the first send (another channel, a slow claim).
    const result = await dispatchNotifications(
      { db, webhookUrl, email: undefined, appUrl, now: later(), post },
      { deadline: NOW.getTime() + ROW_BUDGET_MS + 1_000 },
    );
    expect(result).toMatchObject({ chat: { sent: 0, released: 2 } });
    expect(post).not.toHaveBeenCalled();
    const back = calls.filter((c) => c.table === 'notifications' && c.op === 'update');
    expect(back.map((c) => [c.values, c.filters])).toEqual([
      [
        { attempts: 1, next_retry_at: null },
        [
          ['eq', 'id', 'n-down'],
          ['eq', 'status', 'queued'],
          ['eq', 'attempts', 2],
        ],
      ],
      [
        { attempts: 0, next_retry_at: null },
        [
          ['eq', 'id', 'n-rec'],
          ['eq', 'status', 'queued'],
          ['eq', 'attempts', 1],
        ],
      ],
    ]);
  });

  it('claims only one incident’s messages for an ack’s own flush', async () => {
    const { db, rpcCalls } = fakeDb(queue([]));
    await dispatchNotifications({ db, webhookUrl, email, appUrl }, { incidentId: 'i9' });
    expect(rpcCalls.map((c) => c.args)).toEqual([
      { p_channel: 'google_chat', p_limit: 20, p_incident_id: 'i9' },
      { p_channel: 'email', p_limit: 20, p_incident_id: 'i9' },
    ]);
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
    [mail('recovered', { user_id: 'u-nobody' }), 'Recipient not found or inactive'],
  ])('fails a message it can’t send without sending (%#)', async (row, error) => {
    const isEmail = row.channel === 'email';
    const { db, calls } = fakeDb(queue(isEmail ? [] : [row], isEmail ? [row] : []));
    const post = okPost();
    const send = okSend();
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, post, send });
    expect(post).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(updates(calls)[0]).toMatchObject({ status: 'failed', error });
  });

  it('asks only for active recipients and their first emails', async () => {
    const { db, calls } = fakeDb(queue([], [mail('down')]));
    await dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send: okSend() });
    expect(calls.find((c) => c.table === 'profiles')?.filters).toContainEqual(['eq', 'is_active', true]);
    expect(calls.find((c) => c.table === 'notifications' && c.op === 'select')?.filters).toEqual([
      ['eq', 'channel', 'email'],
      ['eq', 'status', 'sent'],
      ['in', 'incident_id', ['i1']],
      ['in', 'user_id', ['u-arm']],
    ]);
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
    ['notifications.select', 'notifications: boom'],
    ['notifications.update', 'notifications: boom'],
    ['notification_attempts.insert', 'notification_attempts: boom'],
    ['incident_events.insert', 'incident_events: boom'],
  ])('throws when %s fails', async (key, message) => {
    const { db } = fakeDb({ ...queue([], [mail('down')]), [key]: { error: { message: 'boom' } } });
    await expect(
      dispatchNotifications({ db, webhookUrl: undefined, email, appUrl, now, send: okSend() }),
    ).rejects.toThrow(message);
  });

  it.each([
    ['superseded', { state: 'monitoring' }, okPost()],
    ['released', {}, okPost()],
  ] as const)('throws when the %s update fails', async (kind, over, post) => {
    const { db } = fakeDb({
      ...queue([notification('down')], [], over),
      'notifications.update': { error: { message: 'boom' } },
    });
    const deadline = kind === 'released' ? NOW.getTime() + ROW_BUDGET_MS + 1_000 : undefined;
    await expect(
      dispatchNotifications({ db, webhookUrl, email: undefined, appUrl, now: later(), post }, { deadline }),
    ).rejects.toThrow('notifications: boom');
  });

  it('claims nothing when there is no time left to send anything', async () => {
    const { db, rpcCalls } = fakeDb(queue([notification('down')]));
    expect(
      await dispatchNotifications({ db, webhookUrl, email, appUrl, now }, { deadline: NOW.getTime() }),
    ).toEqual({ ok: true, chat: 'no_time', email: 'no_time' });
    expect(rpcCalls).toEqual([]);
  });

  it('waits for both channels before failing, so nothing keeps running detached', async () => {
    const send = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true as const, id: 'em_1' };
    });
    const { db } = fakeDb({
      ...queue([notification('down')], [mail('down')]),
      'notification_attempts.insert': (c) =>
        (c.values as { notification_id: string }).notification_id === 'n-down'
          ? { error: { message: 'boom' } }
          : { data: [] },
    });
    await expect(
      dispatchNotifications({ db, webhookUrl, email, appUrl, now, post: okPost(), send }),
    ).rejects.toThrow('notification_attempts: boom');
    expect(send).toHaveBeenCalled();
  });

  it('keeps a DOWN that may still be undone (inside the 10 s window), even if acknowledged', async () => {
    const { db } = fakeDb(
      queue([notification('down')], [], { state: 'acknowledged', acked_at: '2026-10-06T02:59:55Z' }),
    );
    const post = okPost();
    expect(
      await dispatchNotifications({ db, webhookUrl, email: undefined, appUrl, now, post }),
    ).toMatchObject({ chat: { sent: 1, superseded: 0 } });
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
  it('runs a second pass 30 s after the start, each pass under its own deadline', async () => {
    const { db, rpcCalls } = fakeDb(queue([]));
    let t = 1_000_000;
    const clock = () => t;
    const sleep = vi.fn(async (ms: number) => {
      t += ms;
    });
    t += 0; // pass 1 starts at the run's start
    const result = await runNotifierSweep(
      { db, webhookUrl, email, appUrl, now: () => new Date(t) },
      { sleep, clock },
    );
    expect(sleep).toHaveBeenCalledWith(30_000);
    expect(rpcCalls.filter((c) => c.name === 'claim_notifications')).toHaveLength(4);
    expect(result).toMatchObject({ ok: true, passes: [{ ok: true }, { ok: true }] });
  });

  it('sleeps only what is left of the 30 s after a slow first pass', async () => {
    const { db } = fakeDb(queue([]));
    const times = [0, 12_000, 30_000];
    const sleep = vi.fn(async () => {});
    await runNotifierSweep(
      { db, webhookUrl, email, appUrl },
      { sleep, clock: () => times.shift() ?? 30_000 },
    );
    expect(sleep).toHaveBeenCalledWith(18_000);
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
});

describe('Admin alerts that aren’t about one incident (D-019)', () => {
  const alertRow = (over: Record<string, unknown> = {}) =>
    mail('verifier_unavailable', {
      id: 'e-alert',
      incident_id: null,
      system_alert_id: 'a1',
      user_id: 'u-tao',
      thread_key: 'alert-a1',
      ...over,
    });
  const alerts = {
    'system_alerts.select': {
      data: [
        {
          id: 'a1',
          kind: 'verifier_unavailable',
          opened_at: '2026-10-06T02:59:20Z',
          context: { sites: ['Tubtong'], reason: 'no_poll' },
        },
      ],
    },
  };

  it('emails the Admin under its own subject, with no timeline event and no incident lookup', async () => {
    const send = okSend();
    const { db, calls } = fakeDb({ ...queue([], [alertRow()]), ...alerts });
    const result = await dispatchNotifications({ db, webhookUrl, email, appUrl, now, send });
    expect(result).toMatchObject({ email: { sent: 1 } });
    const [message, options] = send.mock.calls[0] as unknown as [
      { subject: string; text: string },
      { to: string },
    ];
    expect(message.subject).toBe('DxT Monitor · Browser verifier unavailable');
    expect(message.text).toContain('Waiting: Tubtong');
    expect(options).toMatchObject({ to: 'tao@example.test', idempotencyKey: 'notification-e-alert' });
    expect(calls.some((c) => c.table === 'incident_events')).toBe(false);
    expect(calls.find((c) => c.table === 'incidents')?.filters).toEqual([['in', 'id', []]]);
  });

  it.each([
    ['an alert that is gone', {}, 'System alert not found'],
    ['an inactive Admin', { ...alerts, 'profiles.select': { data: [] } }, 'Recipient not found or inactive'],
  ])('fails for good on %s', async (_name, over, error) => {
    const { db, calls } = fakeDb({ ...queue([], [alertRow()]), ...over });
    const send = okSend();
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, send });
    expect(send).not.toHaveBeenCalled();
    expect(updates(calls)).toEqual([expect.objectContaining({ status: 'failed', error })]);
  });

  it('fails for good on a kind it can’t render', async () => {
    const { db, calls } = fakeDb({
      ...queue([], [alertRow({ template: 'mystery' })]),
      ...alerts,
    });
    await dispatchNotifications({ db, webhookUrl, email, appUrl, now, send: okSend() });
    expect(updates(calls)).toEqual([
      expect.objectContaining({ status: 'failed', error: "Can't render template mystery" }),
    ]);
  });
});
