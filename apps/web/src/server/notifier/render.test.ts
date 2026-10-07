// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IncidentFacts, Notification } from './facts';
import { renderChat, renderEmail, renderSystemAlertEmail } from './render';

// The PROBLEM thread (spec §19, D-022) as the notifier renders a claimed row.
const incident: IncidentFacts = {
  id: 'inc-141',
  number: 141,
  state: 'unacked',
  severity: 'problem',
  trigger: 'slow',
  started_at: '2026-09-25T02:48:00Z',
  detected_at: '2026-09-25T02:52:00Z',
  acked_at: null,
  recovered_at: '2026-09-25T03:14:00Z',
  acker: null,
  sites: {
    name: 'Fuji Links',
    tier: 2,
    primary: { id: 'u-ploy', display_name: 'Ploy', google_chat_user_id: 'PLOY' },
    backup: { id: 'u-nok', display_name: 'Nok', google_chat_user_id: 'NOK' },
  },
};
const row = (template: string, context: Notification['context'] = {}): Notification =>
  ({
    id: 'n1',
    incident_id: 'inc-141',
    system_alert_id: null,
    user_id: 'u-ploy',
    channel: 'google_chat',
    template,
    context,
    created_at: '2026-09-25T02:52:01Z',
  }) as Notification;
const appUrl = 'https://monitor.example.test';
const now = new Date('2026-09-25T02:52:05Z');
const problemContext = {
  cause: 'p50 5.8 s (BKK, SIN, TYO) · over the Tier 2 limit of 5 s for 3 checks in a row',
  summary: 'slow, p50 5.8 s',
  detail: { kind: 'slow', p50Ms: 5800, thresholdMs: 5000, locations: ['BKK', 'SIN', 'TYO'] },
  reporting: 3,
};

describe('render — PROBLEM rows', () => {
  it('renders the PROBLEM card with the stored cause, summary and where it was seen', () => {
    const m = renderChat(row('problem', problemContext), incident, appUrl, now)!;
    expect(m.text).toBe('<users/PLOY> PROBLEM · Fuji Links (Tier 2) · slow, p50 5.8 s · please take a look');
    expect(JSON.stringify(m.cardsV2)).toContain('3 of 3 locations — the site loads, just slowly');
    expect(JSON.stringify(m.cardsV2)).toContain('https://monitor.example.test/incidents/inc-141?ack=1');
  });

  it('words ACKNOWLEDGED and RECOVERED of a PROBLEM as one, and keeps DOWN as it was', () => {
    const ack = renderChat(
      row('acknowledged', { ackedBy: 'Ploy', ackedAt: '2026-09-25T02:58:12Z' }),
      incident,
      appUrl,
      now,
    )!;
    expect(ack.cardsV2[0]!.card.header.title).toBe('ACKNOWLEDGED · Fuji Links still slow · by Ploy 09:58');
    const rec = renderChat(row('recovered', { okLocations: 3 }), incident, appUrl, now)!;
    expect(rec.text).toContain('problem cleared after 26 min');
    expect(JSON.stringify(rec.cardsV2)).toContain('Response time back under 5 s from 3 locations.');
    const down = renderChat(
      row('recovered', { okLocations: 3 }),
      { ...incident, severity: 'down' },
      appUrl,
      now,
    )!;
    expect(down.text).toContain('down 26 min');
  });

  it('emails the owner the PROBLEM, then ACKNOWLEDGED and RECOVERED in its thread', () => {
    const to = { id: 'u-ploy', email: 'ploy@example.test', display_name: 'Ploy' };
    const thread = { threadId: '<inc-inc-141@notify.example.test>', startsThread: true };
    const first = renderEmail(row('problem', problemContext), incident, to, appUrl, thread)!;
    expect(first.text).toMatch(/^PROBLEM — Fuji Links is slow/);
    expect(first.text).toContain('You got this because you own Fuji Links.');
    const ack = renderEmail(
      row('acknowledged', { ackedBy: 'Ploy', ackedAt: '2026-09-25T02:58:12Z' }),
      incident,
      to,
      appUrl,
      { ...thread, startsThread: false },
    )!;
    expect(ack.text).toContain('Slow for:');
    const rec = renderEmail(row('recovered', { okLocations: 3 }), incident, to, appUrl, thread)!;
    expect(rec.text).toMatch(/^RECOVERED — Fuji Links is back to normal/);
  });

  it('renders the fewer-than-2-locations Admin email from the alert context', () => {
    const m = renderSystemAlertEmail(
      {
        ...row('probe_locations_low'),
        incident_id: null,
        system_alert_id: 'a1',
        channel: 'email',
      } as Notification,
      {
        id: 'a1',
        kind: 'probe_locations_low',
        opened_at: '2026-09-22T08:40:00Z',
        context: { active: ['TYO', 'XX'] },
      },
      'DxT Monitor <alerts@notify.example.test>',
    )!;
    expect(m.subject).toBe('DxT Monitor · System · Fewer than 2 probe locations · Tue 22 Sep 15:40');
    expect(m.text).toContain('Still reporting: TYO (Tokyo)');
  });
});
