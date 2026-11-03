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
    expect(m?.text).toBe('<users/BUA> CLIENT UPDATE DUE · MuvMi · DOWN 15 min · draft ready');
    expect(JSON.stringify(m)).toContain('https://monitor.example.test/incidents/inc-142#client-update');
  });

  it('Chat with no AM: Tao, and the line says so', () => {
    const m = renderChat(row({ ...ctx, mentioned: ['u-tao'], noAm: true }), incident, appUrl, new Date());
    expect(m?.text).toBe(
      '<users/TAO> CLIENT UPDATE DUE · MuvMi · DOWN 15 min · no account manager for MuvMi · draft ready',
    );
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
