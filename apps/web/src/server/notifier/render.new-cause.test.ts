// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IncidentFacts, Notification } from './facts';
import { renderChat, renderEmail } from './render';

// D-067: INC-0136 DxT AI (Tier 3) was open for SSL expiring; a forbidden word took over as its cause.
const incident: IncidentFacts = {
  id: 'inc-136',
  number: 136,
  state: 'unacked',
  severity: 'problem',
  trigger: 'keyword',
  started_at: '2026-09-23T02:00:00Z',
  detected_at: '2026-09-23T02:00:00Z',
  acked_at: null,
  recovered_at: null,
  acker: null,
  sites: {
    name: 'DxT AI',
    tier: 3,
    primary: { id: 'u-tao', display_name: 'Tao', google_chat_user_id: 'TAO' },
    backup: null,
  },
  incident_events: [
    {
      type: 'detected',
      at: '2026-09-23T02:00:00Z',
      payload: {
        cause: 'SSL certificate expires in 13 days (Tue 6 Oct)',
        detail: { kind: 'ssl', expiresAt: '2026-10-06T13:00:00Z', daysLeft: 13 },
      },
    },
    {
      type: 'new_cause',
      at: '2026-09-24T03:00:00Z',
      payload: { cause: 'Found “บาคาร่า” on / (as Googlebot)', trigger: 'keyword', was: 'ssl' },
    },
  ],
};
const context = {
  cause: 'Found “บาคาร่า” on / (as Googlebot)',
  summary: '“บาคาร่า” found on the page (as Googlebot)',
  trigger: 'keyword',
  was: 'ssl',
  newCause: true,
};
const row = (over: Partial<Notification> = {}): Notification =>
  ({
    id: 'n1',
    incident_id: 'inc-136',
    system_alert_id: null,
    user_id: null,
    channel: 'google_chat',
    template: 'problem_again',
    context,
    created_at: '2026-09-24T03:00:01Z',
    ...over,
  }) as Notification;
const appUrl = 'https://monitor.example.test';
const now = new Date('2026-09-24T03:00:05Z');
const thread = { threadId: '<inc-inc-136@notify.example.test>', startsThread: false };
const tao = { id: 'u-tao', email: 'tao@example.test', display_name: 'Tao' };

describe('render — a new cause (D-067)', () => {
  it('the Chat reply: new cause, was SSL expiring, @mentioning L0', () => {
    const m = renderChat(row(), incident, appUrl, now)!;
    expect(m.text).toBe(
      '<users/TAO> PROBLEM · DxT AI (Tier 3) · new cause: “บาคาร่า” found on the page (as Googlebot) · was SSL expiring · same incident INC-0136',
    );
  });

  it('the L0 email: PROBLEM, not AGAIN, in the incident’s thread, with why they got it', () => {
    const email = renderEmail(row({ channel: 'email', user_id: 'u-tao' }), incident, tao, appUrl, thread)!;
    expect(email.subject).toBe('DxT AI · Tier 3 · INC-0136');
    expect(email.headers).toMatchObject({ 'In-Reply-To': thread.threadId });
    expect(email.text).toContain('DxT AI has a new problem');
    expect(email.text).toMatch(/^PROBLEM — DxT AI has a new problem/);
    expect(email.text).toContain('Was: SSL expiring');
    // The preheader (html only).
    expect(email.html).toContain('DxT AI · new cause: Keyword · was SSL expiring · same incident INC-0136');
    expect(email.text).not.toMatch(/AGAIN|again/);
    expect(email.text).toContain('You got this because you own DxT AI.');
  });

  it('acknowledged: the lede says who, once (no Chat sentence)', () => {
    const acked: IncidentFacts = {
      ...incident,
      state: 'acknowledged',
      acked_at: '2026-09-24T03:00:02Z',
      acker: { display_name: 'Nok', google_chat_user_id: 'NOK' },
    };
    const email = renderEmail(row({ channel: 'email', user_id: 'u-tao' }), acked, tao, appUrl, thread)!;
    expect(email.text).toContain('Nok acknowledged it at');
    expect(email.text).not.toContain('so only Nok is mentioned');
  });

  it('renewed, then a keyword PROBLEM AGAIN: the ACKNOWLEDGED email names the keyword, never the SSL recounted (message-checker H1)', () => {
    const relapsed: IncidentFacts = {
      ...incident,
      state: 'acknowledged',
      acked_at: '2026-09-26T03:00:00Z',
      acker: { display_name: 'Nok', google_chat_user_id: 'NOK' },
      incident_events: [
        incident.incident_events![0]!,
        { type: 'recovered', at: '2026-09-24T03:00:00Z', payload: {} },
        {
          type: 'relapsed',
          at: '2026-09-26T02:00:00Z',
          payload: { severity: 'problem', trigger: 'keyword', cause: 'Found “บาคาร่า” on / (BKK, SIN, TYO)' },
        },
      ],
    };
    const email = renderEmail(
      row({ channel: 'email', user_id: 'u-tao', template: 'acknowledged', context: {} }),
      relapsed,
      tao,
      appUrl,
      thread,
    )!;
    expect(email.text).toContain('Found “บาคาร่า” on / (BKK, SIN, TYO)');
    expect(email.text).not.toContain('SSL certificate expires');
  });

  it('a PROBLEM email queued for SSL says SSL even after a new cause took over (message-checker M1)', () => {
    const email = renderEmail(
      row({
        channel: 'email',
        user_id: 'u-tao',
        template: 'problem',
        context: { cause: 'SSL certificate expires in 13 days (Tue 6 Oct)', summary: 'x', trigger: 'ssl' },
      }),
      incident,
      tao,
      appUrl,
      thread,
    )!;
    expect(email.text).toContain('SSL expiring');
    expect(email.text).not.toMatch(/Trigger:?\s+Keyword/);
  });

  it('a plain PROBLEM AGAIN row is still an AGAIN reply', () => {
    const m = renderChat(row({ context: { summary: 'slow, p50 5.4 s' } }), incident, appUrl, now)!;
    expect(m.text).toContain('PROBLEM AGAIN');
  });
});
