// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IncidentFacts, Notification } from './facts';
import { emailReason, renderChat, renderEmail } from './render';

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
    // EmailAlert "New cause · not acknowledged yet" (spec §40, D-068).
    expect(email.text).toMatch(/^PROBLEM — NEW CAUSE: KEYWORD — DxT AI has a new problem/);
    expect(email.text).toContain('and the incident now reads Keyword.');
    expect(email.text).toContain('Was: SSL expiring — SSL certificate expires in 12 days (Tue 6 Oct)');
    expect(email.text).toContain('Next step: Acknowledge to stop the PROBLEM reminders');
    expect(email.text).toContain('Incident: INC-0136, open since Wed 23 Sep 09:00 · now reads Keyword');
    expect(email.html).toContain('?ack=1');
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

  it('Tier 1 at night: the person on call the row names, and their email says why (Tao, 17 Nov)', () => {
    const night = {
      ...context,
      mention: { id: 'u-oncall', name: 'Arm', chatUserId: 'ARM' },
    };
    const m = renderChat(row({ context: night }), incident, appUrl, now)!;
    expect(m.text).toMatch(/^<users\/ARM> PROBLEM · DxT AI/);
    const email = renderEmail(
      row({ channel: 'email', user_id: 'u-oncall', context: night }),
      incident,
      { id: 'u-oncall', email: 'arm@example.test', display_name: 'Arm' },
      appUrl,
      thread,
    )!;
    expect(email.text).not.toContain('couldn’t be delivered');
    // Their RECOVERED email later says why too (the new cause's event names them).
    const told: IncidentFacts = {
      ...incident,
      incident_events: [
        ...incident.incident_events!,
        {
          type: 'new_cause',
          at: '2026-09-24T03:00:00Z',
          payload: { trigger: 'keyword', mention: { id: 'u-oncall' } },
        },
      ],
    };
    expect(
      emailReason(row({ channel: 'email', user_id: 'u-oncall', template: 'recovered', context: {} }), told),
    ).toBe('emailed'); // nothing asked of them: the owner adds the root cause (message-checker)
    expect(
      emailReason(row({ channel: 'email', user_id: 'u-tao', template: 'recovered', context: {} }), told),
    ).toBe('owner');
  });

  it('a DOWN incident back up on SSL: the body says so, not “open for SSL expiring”', () => {
    const m = renderChat(row({ context: { ...context, afterDown: true } }), incident, appUrl, now)!;
    const body = JSON.stringify(m.cardsV2);
    expect(body).toContain('was back up in INC-0136 with SSL expiring still open');
    expect(body).not.toContain('was already open');
  });

  it('a plain PROBLEM AGAIN row is still an AGAIN reply', () => {
    const m = renderChat(row({ context: { summary: 'slow, p50 5.4 s' } }), incident, appUrl, now)!;
    expect(m.text).toContain('PROBLEM AGAIN');
  });

  // Spec §40.3, D-068 item 3 (Tao, 19 Nov): the ack of the expiry set aside names its acker.
  describe('the ack of the expiry set aside (spec §40.3, D-068)', () => {
    const aside = {
      ...context,
      mention: { id: 'u-nok', name: 'Nok', chatUserId: 'NOK', acked: true, ackedAt: '2026-09-24T02:20:00Z' },
    };
    const nok = { id: 'u-nok', email: 'nok@example.test', display_name: 'Nok' };

    it('the reply @mentions the acker and says it was set aside', () => {
      const m = renderChat(row({ context: aside }), incident, appUrl, now)!;
      expect(m.text).toMatch(/^<users\/NOK> PROBLEM · DxT AI \(Tier 3\) · new cause/);
      const body = JSON.stringify(m.cardsV2);
      expect(body).toContain('Nok acknowledged earlier, so only Nok is mentioned.');
      expect(body).toContain('Nok’s acknowledgement of the expiry is set aside — Keyword needs its own.');
    });

    it('the acker’s email: the sentence, the Acknowledge button, the set-aside row and why they got it', () => {
      const email = renderEmail(
        row({ channel: 'email', user_id: 'u-nok', context: aside }),
        incident,
        nok,
        appUrl,
        thread,
      )!;
      expect(email.text).toContain(
        'Nok acknowledged earlier, so only Nok is mentioned. That acknowledgement was for the SSL expiry — please acknowledge the new problem.',
      );
      expect(email.text).toContain(
        'Acknowledged: Nok at 09:20 for SSL expiring — set aside, Keyword needs its own',
      );
      expect(email.text).toContain('Incident: INC-0136 · now reads Keyword · not acknowledged for it yet');
      expect(email.html).toContain('?ack=1');
      expect(email.text).toContain('You got this because you acknowledged this incident.');
    });

    it('acknowledged again for the new cause meanwhile: no ask, the new ack named', () => {
      const acked: IncidentFacts = {
        ...incident,
        state: 'acknowledged',
        acked_at: '2026-09-24T03:02:00Z',
        acker: { display_name: 'Nok', google_chat_user_id: 'NOK' },
      };
      const email = renderEmail(
        row({ channel: 'email', user_id: 'u-nok', context: aside }),
        acked,
        nok,
        appUrl,
        thread,
      )!;
      expect(email.text).toContain('Nok acknowledged it at 10:02.');
      expect(email.text).not.toContain('please acknowledge');
      expect(email.html).not.toContain('?ack=1');
    });
  });

  // Spec §40.2, D-068 (INC-0136, Wed 23 Sep): DOWN 16:10 → back 16:18 with the certificate 13 days out.
  describe('back up, still SSL expiring (spec §40.2, D-068)', () => {
    const back: IncidentFacts = {
      ...incident,
      severity: 'down',
      trigger: 'ssl',
      incident_events: [
        incident.incident_events![0]!,
        {
          type: 'escalated_to_down',
          at: '2026-09-23T09:10:00Z',
          payload: { startedAt: '2026-09-23T09:10:00Z' },
        },
        { type: 'recovered', at: '2026-09-23T09:18:00Z', payload: {} },
        {
          type: 'relapsed',
          at: '2026-09-23T09:18:00Z',
          payload: {
            severity: 'problem',
            trigger: 'ssl',
            homeBackAt: '2026-09-23T09:18:00Z',
            stillExpiry: true,
            detail: { kind: 'ssl', expiresAt: '2026-10-06T13:00:00Z', daysLeft: 13 },
          },
        },
      ],
    };
    const ctx = {
      okLocations: 3,
      recoveredAt: '2026-09-23T09:18:00Z',
      stillExpiry: {
        trigger: 'ssl',
        detail: { kind: 'ssl', expiresAt: '2026-10-06T13:00:00Z', daysLeft: 13 },
      },
    };
    const sent = new Date('2026-09-23T09:18:05Z');

    it('one RECOVERED: back after N min down · still SSL expiring · same incident, @mentioning L0', () => {
      const m = renderChat(
        row({ template: 'recovered', context: ctx, created_at: '2026-09-23T09:18:01Z' }),
        back,
        appUrl,
        sent,
      )!;
      expect(m.text).toBe(
        '<users/TAO> RECOVERED · DxT AI (Tier 3) · back after 8 min down · still SSL expiring · same incident INC-0136',
      );
      const card = m.cardsV2[0]!.card;
      expect(card.header.title).toBe('RECOVERED · DxT AI · back up, still SSL expiring');
      expect(JSON.stringify(card.sections)).toContain(
        'DxT AI answered again at 16:18 after 8 min down. The incident stays open for SSL expiring — SSL certificate expires in 13 days (Tue 6 Oct). The DOWN needs a root cause before it can be resolved.',
      );
    });

    it('the DOWN’s acker is the one mentioned', () => {
      const acked: IncidentFacts = {
        ...back,
        state: 'acknowledged',
        acked_at: '2026-09-23T09:12:00Z',
        acker: { display_name: 'Nok', google_chat_user_id: 'NOK' },
      };
      const m = renderChat(row({ template: 'recovered', context: ctx }), acked, appUrl, sent)!;
      expect(m.text).toMatch(/^<users\/NOK> RECOVERED/);
    });

    it('the email uses the Chat words (Tao, 19 Nov)', () => {
      const email = renderEmail(
        row({
          template: 'recovered',
          channel: 'email',
          user_id: 'u-tao',
          context: ctx,
          created_at: '2026-09-23T09:18:01Z',
        }),
        back,
        tao,
        appUrl,
        thread,
      )!;
      expect(email.text).toContain('DxT AI is back up, still SSL expiring');
      expect(email.text).toContain(
        'The incident stays open for SSL expiring — SSL certificate expires in 13 days (Tue 6 Oct).',
      );
      expect(email.text).toContain(
        'Still open for: SSL expiring — SSL certificate expires in 13 days (Tue 6 Oct)',
      );
    });

    it('a RECOVERED without it stays the plain one', () => {
      const m = renderChat(
        row({ template: 'recovered', context: { okLocations: 3, recoveredAt: '2026-09-23T09:18:00Z' } }),
        back,
        appUrl,
        sent,
      )!;
      expect(m.text).not.toContain('still SSL expiring');
    });
  });

  it('back up with an unreadable expiry detail still says it stays open (code review)', () => {
    const facts: IncidentFacts = {
      ...incident,
      severity: 'down',
      trigger: 'ssl',
      incident_events: [
        incident.incident_events![0]!,
        {
          type: 'escalated_to_down',
          at: '2026-09-23T09:10:00Z',
          payload: { startedAt: '2026-09-23T09:10:00Z' },
        },
        { type: 'recovered', at: '2026-09-23T09:18:00Z', payload: {} },
      ],
    };
    const ctx = {
      okLocations: 3,
      recoveredAt: '2026-09-23T09:18:00Z',
      stillExpiry: { trigger: 'ssl', detail: {} },
    };
    const m = renderChat(row({ template: 'recovered', context: ctx }), facts, appUrl, now)!;
    expect(m.cardsV2[0]!.card.header.title).toBe('RECOVERED · DxT AI · back up, still SSL expiring');
    expect(JSON.stringify(m.cardsV2)).toContain('The incident stays open for SSL expiring. The DOWN');
    const email = renderEmail(
      row({ template: 'recovered', channel: 'email', user_id: 'u-tao', context: ctx }),
      facts,
      tao,
      appUrl,
      thread,
    )!;
    expect(email.text).toContain('Still open for: SSL expiring');
  });
});
