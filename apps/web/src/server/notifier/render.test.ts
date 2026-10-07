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

describe('render — relapse, flapping and auto-resolve rows (S04b, D-024)', () => {
  const voca: IncidentFacts = {
    ...incident,
    id: 'inc-133',
    number: 133,
    state: 'unacked',
    severity: 'down',
    trigger: 'hard_fail',
    started_at: '2026-09-20T20:12:00Z',
    detected_at: '2026-09-20T20:12:40Z',
    recovered_at: null,
    sites: { ...incident.sites, name: 'VOCA' },
    incident_events: [
      { type: 'detected', payload: {}, at: '2026-09-20T20:12:40Z' },
      { type: 'recovered', payload: {}, at: '2026-09-20T20:19:00Z' },
      {
        type: 'relapsed',
        payload: { startedAt: '2026-09-20T20:24:00Z', severity: 'down' },
        at: '2026-09-20T20:24:40Z',
      },
    ],
  };

  it('DOWN AGAIN: mentions the owner while nobody acked, counts the downtime before the drop', () => {
    const m = renderChat(
      row('down_again', {
        startedAt: '2026-09-20T20:24:00Z',
        backSince: '2026-09-20T20:19:00Z',
        fromState: 'monitoring',
        nowFlapping: true,
        flapping: true,
      }),
      voca,
      appUrl,
      now,
    )!;
    expect(m.text).toBe('<users/PLOY> DOWN AGAIN · VOCA (Tier 2) · same incident INC-0133');
    expect(m.cardsV2[0]!.card.header.title).toBe('DOWN AGAIN · VOCA · was back for 5 min (03:19–03:24)');
    expect(JSON.stringify(m.cardsV2)).toContain('Down 7 min so far in this incident.');
  });

  it('PROBLEM AGAIN mentions whoever acknowledged, not the owner', () => {
    const acked = {
      ...voca,
      acked_at: '2026-09-20T20:14:00Z',
      acker: { display_name: 'Nok', google_chat_user_id: 'NOK' },
    };
    const m = renderChat(
      row('problem_again', { summary: 'slow, p50 5.4 s', startedAt: '2026-09-20T20:24:00Z' }),
      acked,
      appUrl,
      now,
    )!;
    expect(m.text).toMatch(/^<users\/NOK> PROBLEM AGAIN · VOCA \(Tier 2\) · slow again, p50 5\.4 s/);
  });

  it('the flapping summary lists the closed drops; its email goes in the thread', () => {
    const closed = {
      ...voca,
      incident_events: [
        ...voca.incident_events!,
        { type: 'recovered', payload: {}, at: '2026-09-20T20:35:00Z' },
      ],
    };
    const m = renderChat(row('flap_summary'), closed, appUrl, now)!;
    expect(m.text).toBe(
      '<users/PLOY> RECOVERED · VOCA · stable 15 min · flapped ×2, down 18 min in total · add a root cause',
    );
    const to = { id: 'u-ploy', email: 'ploy@example.test', display_name: 'Ploy' };
    const e = renderEmail(row('flap_summary'), closed, to, appUrl, {
      threadId: '<inc-inc-133@x.test>',
      startsThread: false,
    })!;
    expect(e.text).toMatch(/^RECOVERED — VOCA is stable again/);
  });

  it('RECOVERED renders from its own recovery even after a relapse cleared the incident’s', () => {
    const m = renderChat(
      row('recovered', { okLocations: 3, recoveredAt: '2026-09-20T20:19:00Z' }),
      voca,
      appUrl,
      now,
    )!;
    expect(m.text).toContain('down 7 min');
  });

  it('an auto-resolved PROBLEM: RECOVERED with no mention, counted from when it was flagged', () => {
    const fuji: IncidentFacts = {
      ...incident,
      state: 'resolved',
      trigger: 'key_page',
      detected_at: '2026-09-25T03:02:00Z',
      incident_events: [
        {
          type: 'detected',
          payload: {
            keyPage: { path: '/contact', failure: 'HTTP 500', cause: '/contact → HTTP 500 (BKK, SIN, TYO)' },
          },
          at: '2026-09-25T03:02:00Z',
        },
      ],
    };
    const m = renderChat(
      row('recovered', { okLocations: 3, recoveredAt: '2026-09-25T03:05:00Z', autoResolved: true }),
      fuji,
      appUrl,
      now,
    )!;
    expect(m.text).toBe(
      'RECOVERED · Fuji Links · /contact back 3 min after it was flagged, before anyone acknowledged · resolved automatically',
    );
  });
});
