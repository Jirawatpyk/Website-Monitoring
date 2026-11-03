// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IncidentFacts, Notification } from './facts';
import { renderChat, renderEmail } from './render';

// INC-0142 MuvMi (Tier 1): first failed 09:48:12, confirmed 09:48:41 Bangkok; Bua is the AM (spec §4).
const arm = { id: 'u-arm', display_name: 'Arm', google_chat_user_id: 'ARM' };
const bua = { id: 'u-bua', display_name: 'Bua', google_chat_user_id: 'BUA' };
const tao = { id: 'u-tao', display_name: 'Tao', google_chat_user_id: 'TAO' };
const HOURS = { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5], holidays: new Set<string>() };
const incident: IncidentFacts = {
  id: 'inc-142',
  number: 142,
  state: 'escalated',
  severity: 'down',
  trigger: 'hard_fail',
  started_at: '2026-09-25T02:48:12Z',
  detected_at: '2026-09-25T02:48:41Z',
  acked_at: null,
  recovered_at: null,
  acker: null,
  sites: { name: 'MuvMi', tier: 1, primary: arm, backup: null, client: { name: 'MuvMi', am: bua } },
  ladder: { admins: [tao], hours: HOURS },
};
const row = (context: Notification['context'], over: Partial<Notification> = {}) =>
  ({
    id: 'n1',
    incident_id: 'inc-142',
    system_alert_id: null,
    user_id: null,
    channel: 'google_chat',
    template: 'client_update_due',
    context,
    created_at: '2026-09-25T03:03:39Z',
    hold_until: null,
    ...over,
  }) as Notification;
const appUrl = 'https://monitor.example.test';
const ctx = { dueAt: '2026-09-25T03:03:12+00:00', tier: 1, minutes: 15, mentioned: ['u-bua'], noAm: false };

describe('render — client update due (S11)', () => {
  it('Chat: @mentions Bua, the card opens the draft', () => {
    const m = renderChat(row(ctx), incident, appUrl, new Date('2026-09-25T03:03:40Z'));
    expect(m?.text).toBe('<users/BUA> CLIENT UPDATE DUE · MuvMi DOWN 15 min · draft ready');
    expect(JSON.stringify(m)).toContain('https://monitor.example.test/incidents/inc-142#client-update');
  });

  it('Chat with no AM: Tao, and the line says so', () => {
    const m = renderChat(row({ ...ctx, mentioned: ['u-tao'], noAm: true }), incident, appUrl, new Date());
    expect(m?.text).toBe(
      '<users/TAO> CLIENT UPDATE DUE · MuvMi DOWN 15 min · no account manager for MuvMi · draft ready',
    );
  });

  const due = {
    client_update_required: true,
    client_update_due_at: '2026-09-25T03:03:12Z',
  };
  const marked = {
    ...due,
    client_updated_at: '2026-09-25T03:12:05Z',
    client_update_note: 'Called MuvMi ops, ETA shared',
    client_update_not_needed: false,
    client_updater: { display_name: 'Bua' },
  };
  const to = { id: 'u-bua', email: 'bua@example.test', display_name: 'Bua' };
  const thread = { threadId: '<inc-inc-142@notify.example.test>', startsThread: false };

  it('the ACKNOWLEDGED email carries the client update row while it waits (EmailAlert)', () => {
    const m = renderEmail(
      row(
        { ackedBy: 'Arm', ackedAt: '2026-09-25T03:07:40Z' },
        { template: 'acknowledged', channel: 'email' },
      ),
      { ...incident, ...due, state: 'acknowledged' },
      to,
      appUrl,
      thread,
    );
    expect(m?.text).toContain('Client update: Due 10:03 · Bua (AM) notified — the AM sends it');
  });

  // EmailAlert Bua rows: the AM emailed at 10:03 reads her own lede, button and footer later on.
  const told = {
    incident_events: [
      { type: 'detected', payload: {}, at: '2026-09-25T02:48:41Z' },
      {
        type: 'client_update_due',
        payload: { notified: ['u-bua'], noAm: false },
        at: '2026-09-25T03:03:12Z',
      },
    ],
  };

  it('ACKNOWLEDGED to Bua: still hers to send, Open draft first, the client-update footer (message-check H1)', () => {
    const m = renderEmail(
      row(
        { ackedBy: 'Arm', ackedAt: '2026-09-25T03:07:40Z' },
        { template: 'acknowledged', channel: 'email', user_id: 'u-bua' },
      ),
      { ...incident, ...due, ...told, state: 'acknowledged' },
      to,
      appUrl,
      thread,
    );
    expect(m?.text).toContain('The client update is still yours to send.');
    expect(m?.text.indexOf('Open draft:')).toBeLessThan(m!.text.indexOf('Open incident:'));
    expect(m?.text).toContain('You got this because you were emailed about the client update at 10:03.');
  });

  it('RECOVERED to Bua once marked: tell the client, already on record, the AM footer', () => {
    const m = renderEmail(
      row({ okLocations: 3 }, { template: 'recovered', channel: 'email', user_id: 'u-bua' }),
      {
        ...incident,
        ...marked,
        state: 'monitoring',
        recovered_at: '2026-09-25T03:31:00Z',
        incident_events: [
          ...told.incident_events,
          { type: 'recovered', payload: {}, at: '2026-09-25T03:31:00Z' },
        ],
      },
      to,
      appUrl,
      thread,
    );
    expect(m?.text).toContain(
      'MuvMi is back after 43 min. Let the client know it’s back — no need to mark it again; your 10:12 update is already on record.',
    );
    expect(m?.text).toContain('Still to do: Root cause (Arm) · tell the client it’s back (Bua)');
    expect(m?.text).toContain('You got this because you’re the AM for MuvMi and handled its client update.');
    expect(m?.text).not.toContain('Open draft');
  });

  it('RECOVERED: the card says who marked it; the email row has the note', () => {
    const facts = {
      ...incident,
      ...marked,
      state: 'monitoring',
      recovered_at: '2026-09-25T03:31:00Z',
      incident_events: [
        { type: 'detected', payload: {}, at: '2026-09-25T02:48:41Z' },
        { type: 'recovered', payload: {}, at: '2026-09-25T03:31:00Z' },
      ],
    };
    const card = renderChat(row({ okLocations: 3 }, { template: 'recovered' }), facts, appUrl, new Date());
    expect(JSON.stringify(card)).toContain(
      'Needs a root cause before it can be resolved. Client update marked by Bua 10:12.',
    );
    const email = renderEmail(
      row({ okLocations: 3 }, { template: 'recovered', channel: 'email' }),
      facts,
      to,
      appUrl,
      thread,
    );
    expect(email?.text).toContain('Client update: Marked by Bua 10:12 — “Called MuvMi ops, ETA shared”');
  });

  it('email to Bua: down 15 min from the first failed check, acked by Arm', () => {
    const m = renderEmail(
      row(ctx, { channel: 'email', user_id: 'u-bua' }),
      {
        ...incident,
        state: 'acknowledged',
        acker: { display_name: 'Arm' },
        acked_at: '2026-09-25T03:07:40Z',
      },
      { id: 'u-bua', email: 'bua@example.test', display_name: 'Bua' },
      appUrl,
      { threadId: '<inc-inc-142@notify.example.test>', startsThread: false },
    );
    expect(m?.text).toContain('Down for: 15 min (confirmed down 09:48:41)');
    expect(m?.text).toContain('Acknowledged: Arm at 10:07');
    expect(m?.text).toContain('Open draft: https://monitor.example.test/incidents/inc-142#client-update');
    expect(m?.text).toContain('You got this because you’re the AM for MuvMi');
  });
});
