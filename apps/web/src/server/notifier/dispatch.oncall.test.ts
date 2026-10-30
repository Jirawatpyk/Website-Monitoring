// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb, type FakeCall } from '../../../test/fake-db';
import { dispatchNotifications } from './dispatch';

// On-call messages (S10 B2b, D-048): the subject's own Chat thread and mail thread; the reason and the
// test token are read as the service role at render time, never from `notifications.context`.
const webhookUrl = 'https://chat.googleapis.com/v1/spaces/S/messages?key=K&token=T';
const appUrl = 'https://monitor.dxt.example';
const email = { apiKey: 're_test', from: 'DxT Monitor <alerts@notify.dxt.example>' };
const now = () => new Date('2026-09-25T03:10:00Z');

const people = [
  { id: 'u-arm', email: 'arm@example.test', display_name: 'Arm', google_chat_user_id: 'ARM' },
  { id: 'u-nok', email: 'nok@example.test', display_name: 'Nok', google_chat_user_id: 'NOK' },
];
const row = (over: Record<string, unknown> = {}) => ({
  id: 'n-chat',
  incident_id: null,
  system_alert_id: null,
  maintenance_window_id: null,
  oncall_event_id: 'e1',
  user_id: null as string | null,
  channel: 'google_chat',
  template: 'oncall',
  thread_key: 'oncall-swap-s1',
  attempts: 1,
  hold_until: null,
  created_at: '2026-09-25T03:08:00Z',
  context: { kind: 'swap_requested', people: [{ id: 'u-nok', role: 'asked' }] } as Record<string, unknown>,
  ...over,
});
const db = (
  chat: unknown[],
  emails: unknown[] = [],
  event: Record<string, unknown> = {},
  extra: Parameters<typeof fakeDb>[0] = {},
) =>
  fakeDb({
    'rpc.claim_notifications': (c: FakeCall) => ({
      data: (c.values as { p_channel: string }).p_channel === 'email' ? emails : chat,
    }),
    'incidents.select': { data: [] },
    'profiles.select': { data: people },
    'oncall_events.select': {
      data: [
        {
          id: 'e1',
          kind: 'swap_requested',
          at: '2026-09-25T03:08:00Z',
          actor_id: 'u-arm',
          user_id: 'u-nok',
          swap_id: 's1',
          shift_id: 'sh-a',
          payload: {},
          ...event,
        },
      ],
    },
    'oncall_swaps.select': {
      data: [
        {
          id: 's1',
          requester_id: 'u-arm',
          counterpart_id: 'u-nok',
          requester_shift_id: 'sh-a',
          counterpart_shift_id: 'sh-n',
          reason: 'Family trip',
          response_note: null,
          decision_note: null,
          decided_by: null,
        },
      ],
    },
    'oncall_shifts.select': {
      data: [
        { id: 'sh-a', user_id: 'u-arm', starts_at: '2026-10-05T02:00:00Z', ends_at: '2026-10-12T02:00:00Z' },
        { id: 'sh-n', user_id: 'u-nok', starts_at: '2026-10-19T02:00:00Z', ends_at: '2026-10-26T02:00:00Z' },
      ],
    },
    'notifications.select': { data: [] },
    'notifications.update': { data: [{ id: 'x' }] },
    ...extra,
  });
const okPost = () => vi.fn(async () => ({ ok: true as const, messageName: 'spaces/S/messages/M' }));
const okSend = () => vi.fn(async () => ({ ok: true as const, id: 'em_1' }));

describe('on-call messages', () => {
  it('claims on-call rows and posts the swap request in the swap’s own thread, @mentioning the person asked', async () => {
    const post = okPost();
    const { db: d, rpcCalls } = db([row()]);
    const result = await dispatchNotifications({ db: d, webhookUrl, email, appUrl, now, post });
    expect(result).toMatchObject({ chat: { sent: 1 } });
    expect(rpcCalls.find((c) => c.name === 'claim_notifications')?.args).toMatchObject({ p_oncall: true });
    const [, message, options] = post.mock.calls[0] as unknown as [
      string,
      { text: string },
      { threadKey: string },
    ];
    expect(message.text).toBe(
      '<users/NOK> SWAP REQUEST · On-call · Arm asks Nok to swap weeks · Nok would take Mon 5 → 12 Oct · Arm would take Mon 19 → 26 Oct · accept or decline on On-call',
    );
    expect(options).toMatchObject({ threadKey: 'oncall-swap-s1', messageId: 'client-n-chat' });
    expect(JSON.stringify(message)).toContain('https://monitor.dxt.example/oncall?swap=s1');
  });

  it('emails the person asked, with the reason read at render time', async () => {
    const send = okSend();
    const { db: d } = db(
      [],
      [
        row({
          id: 'n-mail',
          channel: 'email',
          user_id: 'u-nok',
          context: { kind: 'swap_requested', role: 'asked' },
        }),
      ],
    );
    const result = await dispatchNotifications({ db: d, webhookUrl, email, appUrl, now, send });
    expect(result).toMatchObject({ email: { sent: 1 } });
    const [message, options] = send.mock.calls[0] as unknown as [
      { subject: string; text: string },
      { to: string },
    ];
    expect(options.to).toBe('nok@example.test');
    expect(message.subject).toBe('DxT Monitor · On-call · Swap · Arm ↔ Nok · Mon 5 → 12 Oct');
    expect(message.text).toContain('“Family trip”');
  });

  it('a test alert posts in the tester’s own thread with the link carrying their token', async () => {
    const post = okPost();
    const { db: d } = db(
      [
        row({
          thread_key: 'oncall-test-u-nok',
          context: { kind: 'test_alert', people: [{ id: 'u-nok', role: 'self' }] },
        }),
      ],
      [],
      { kind: 'test_alert', actor_id: 'u-nok', user_id: 'u-nok', swap_id: null, shift_id: null },
      { 'oncall_checklist.select': { data: [{ user_id: 'u-nok', test_token: 'tok-1' }] } },
    );
    await dispatchNotifications({ db: d, webhookUrl, email, appUrl, now, post });
    const [, message] = post.mock.calls[0] as unknown as [string, { text: string }];
    expect(message.text).toBe('<users/NOK> TEST — no action · alert test for Nok’s phone');
    expect(JSON.stringify(message)).toContain('https://monitor.dxt.example/oncall?test=tok-1');
  });

  it('a hand-over names both people; a rotation change names the next weeks and who left', async () => {
    const post = okPost();
    const { db: d } = db(
      [
        row({
          thread_key: 'oncall-handover-sh-n',
          context: { kind: 'handed_over', people: [{ id: 'u-nok', role: 'new' }] },
        }),
      ],
      [],
      {
        kind: 'handed_over',
        actor_id: 'u-arm',
        user_id: 'u-nok',
        swap_id: null,
        shift_id: 'sh-n',
        payload: { from: 'u-arm', at: '2026-10-19T11:00:00Z', reason: 'ill tonight' },
      },
    );
    await dispatchNotifications({ db: d, webhookUrl, email, appUrl, now, post });
    const [, message] = post.mock.calls[0] as unknown as [string, { text: string }];
    expect(message.text).toBe(
      '<users/NOK> SHIFT HANDED OVER · On-call · Nok covers Arm from Mon 19 Oct 18:00 until Mon 26 Oct 09:00',
    );
    expect(message.text).not.toContain('ill tonight');

    const post2 = okPost();
    const { db: d2 } = db(
      [
        row({
          thread_key: 'oncall-rotation-e1',
          context: { kind: 'rotation_changed', people: [{ id: 'u-nok', role: 'rotation' }] },
        }),
      ],
      [],
      {
        kind: 'rotation_changed',
        actor_id: 'u-arm',
        user_id: null,
        swap_id: null,
        shift_id: null,
        payload: { order: ['u-nok'], removed: ['u-arm'] },
      },
    );
    await dispatchNotifications({ db: d2, webhookUrl, email, appUrl, now, post: post2 });
    const [, m2] = post2.mock.calls[0] as unknown as [string, { text: string }];
    expect(m2.text).toBe(
      '<users/NOK> ROTATION CHANGED · On-call · by Arm · next weeks: Nok from Mon 19 Oct · Arm no longer in the rotation',
    );
  });

  it('an event that no longer exists fails for good instead of retrying', async () => {
    const post = okPost();
    const { db: d, calls } = db([row({ oncall_event_id: 'gone' })]);
    await dispatchNotifications({ db: d, webhookUrl, email, appUrl, now, post });
    expect(post).not.toHaveBeenCalled();
    expect(
      calls
        .filter((c) => c.table === 'notifications' && c.op === 'update')
        .map((c) => (c.values as { error?: string }).error),
    ).toContain('On-call event not found');
  });
});
