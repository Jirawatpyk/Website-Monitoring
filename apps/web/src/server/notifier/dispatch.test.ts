// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fake-db';
import { dispatchNotifications } from './dispatch';

const webhookUrl = 'https://chat.googleapis.com/v1/spaces/S/messages?key=K&token=T';
const appUrl = 'https://monitor.dxt.example';
const now = new Date('2026-10-06T03:00:00Z');

const notification = (template: string, context: Record<string, unknown> = {}) => ({
  id: `n-${template}`,
  incident_id: 'i1',
  channel: 'google_chat',
  template,
  thread_key: 'i1',
  attempts: 1,
  context,
});
const incident = {
  id: 'i1',
  number: 7,
  started_at: '2026-10-06T02:47:30Z',
  detected_at: '2026-10-06T02:48:41Z',
  recovered_at: '2026-10-06T03:30:30Z',
  sites: {
    name: 'Test target',
    tier: 1,
    primary: { display_name: 'Arm', google_chat_user_id: 'ARM' },
    backup: null,
  },
};

describe('dispatchNotifications', () => {
  it('claims nothing without a webhook', async () => {
    const { db, rpcCalls } = fakeDb();
    expect(await dispatchNotifications({ db, webhookUrl: undefined, appUrl })).toEqual({
      ok: false,
      skipped: 'no_webhook',
    });
    expect(rpcCalls).toEqual([]);
  });

  it('does nothing when no message is due', async () => {
    const { db } = fakeDb({ 'rpc.claim_notifications': { data: [] } });
    expect(await dispatchNotifications({ db, webhookUrl, appUrl })).toEqual({ ok: true, sent: 0, failed: 0 });
  });

  it('renders DOWN and RECOVERED in the incident thread and records each delivery', async () => {
    const { db, calls } = fakeDb({
      'rpc.claim_notifications': {
        data: [
          notification('down', { cause: 'HTTP 500 (SIN, TYO)', confirmingLocations: 2 }),
          notification('recovered', { okLocations: 2 }),
        ],
      },
      'incidents.select': { data: [incident] },
    });
    const post = vi.fn(async () => ({ ok: true as const, messageName: 'spaces/S/messages/M' }));

    expect(await dispatchNotifications({ db, webhookUrl, appUrl, now, post })).toEqual({
      ok: true,
      sent: 2,
      failed: 0,
    });

    const [downCall, recoveredCall] = post.mock.calls as unknown as [
      string,
      { text: string; cardsV2: unknown[] },
      { threadKey: string },
    ][];
    expect(downCall?.[1].text).toBe('<users/ARM> DOWN · Test target (Tier 1)');
    expect(JSON.stringify(downCall?.[1].cardsV2)).toContain('INC-0007');
    expect(JSON.stringify(downCall?.[1].cardsV2)).toContain('https://monitor.dxt.example/incidents/i1');
    expect(downCall?.[2]).toEqual({ threadKey: 'i1', messageId: 'client-n-down' });
    expect(recoveredCall?.[1].text).toBe(
      '<users/ARM> RECOVERED · Test target · down 43 min · add a root cause',
    );

    const updates = calls.filter((c) => c.table === 'notifications' && c.op === 'update');
    expect(updates[0]?.values).toMatchObject({
      status: 'sent',
      provider_message_id: 'spaces/S/messages/M',
      error: null,
    });
    expect(calls.filter((c) => c.table === 'incident_events').map((c) => c.values)).toEqual([
      { incident_id: 'i1', type: 'alerted', payload: { channel: 'google_chat', template: 'down' } },
      { incident_id: 'i1', type: 'alerted', payload: { channel: 'google_chat', template: 'recovered' } },
    ]);
  });

  it('keeps a failed post queued for a retry, then gives up after 3 attempts', async () => {
    const post = vi.fn(async () => ({ ok: false as const, error: 'HTTP 503' }));
    const first = fakeDb({
      'rpc.claim_notifications': { data: [notification('down')] },
      'incidents.select': { data: [incident] },
    });
    expect(await dispatchNotifications({ db: first.db, webhookUrl, appUrl, post })).toEqual({
      ok: true,
      sent: 0,
      failed: 1,
    });
    expect(first.calls.find((c) => c.table === 'notifications')?.values).toEqual({
      status: 'queued',
      error: 'HTTP 503',
    });
    expect(first.calls.some((c) => c.table === 'incident_events')).toBe(false);

    const last = fakeDb({
      'rpc.claim_notifications': { data: [{ ...notification('down'), attempts: 3 }] },
      'incidents.select': { data: [incident] },
    });
    await dispatchNotifications({ db: last.db, webhookUrl, appUrl, post });
    expect(last.calls.find((c) => c.table === 'notifications')?.values).toEqual({
      status: 'failed',
      error: 'HTTP 503',
    });
  });

  it('posts with a client message id so a retry can never duplicate a message', async () => {
    const { db } = fakeDb({
      'rpc.claim_notifications': { data: [notification('down')] },
      'incidents.select': { data: [incident] },
    });
    const post = vi.fn(async () => ({ ok: true as const, messageName: null }));
    await dispatchNotifications({ db, webhookUrl, appUrl, post });
    expect((post.mock.calls[0] as unknown as [string, unknown, unknown])[2]).toEqual({
      threadKey: 'i1',
      messageId: 'client-n-down',
    });
  });

  it('marks a message it can’t render as failed without posting', async () => {
    const { db, calls } = fakeDb({
      'rpc.claim_notifications': { data: [notification('escalated')] },
      'incidents.select': { data: [incident] },
    });
    const post = vi.fn();
    await dispatchNotifications({ db, webhookUrl, appUrl, post });
    expect(post).not.toHaveBeenCalled();
    expect(calls.find((c) => c.table === 'notifications')?.values).toEqual({
      status: 'failed',
      error: "Can't render template escalated",
    });
  });

  it('uses safe defaults when the stored context is missing', async () => {
    const { db } = fakeDb({
      'rpc.claim_notifications': { data: [notification('down'), notification('recovered')] },
      'incidents.select': { data: [{ ...incident, sites: { ...incident.sites, primary: null } }] },
    });
    const post = vi.fn(async () => ({ ok: true as const, messageName: null }));
    await dispatchNotifications({ db, webhookUrl, appUrl, now, post });
    const texts = (post.mock.calls as unknown as [string, { text: string; cardsV2: unknown }][]).map(
      (c) => c[1],
    );
    expect(JSON.stringify(texts[0]?.cardsV2)).toContain('2 locations, 2 checks');
    expect(texts[1]?.text).toBe('RECOVERED · Test target · down 43 min · add a root cause');
  });

  it.each([
    ['rpc.claim_notifications', 'claim_notifications: boom'],
    ['incidents.select', 'incidents: boom'],
    ['notifications.update', 'notifications: boom'],
    ['incident_events.insert', 'incident_events: boom'],
  ])('throws when %s fails', async (key, message) => {
    const { db } = fakeDb({
      'rpc.claim_notifications': { data: [notification('down')] },
      'incidents.select': { data: [incident] },
      [key]: { error: { message: 'boom' } },
    });
    const post = vi.fn(async () => ({ ok: true as const, messageName: null }));
    await expect(dispatchNotifications({ db, webhookUrl, appUrl, post })).rejects.toThrow(message);
  });
});
