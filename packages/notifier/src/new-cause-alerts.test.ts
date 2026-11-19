import { describe, expect, it } from 'vitest';
import { buildRecoveredAlert } from './chat-alerts';
import { buildNewCauseEmail, buildRecoveredEmail, type EmailBaseInput } from './email-alerts';
import { buildNewCauseAlert } from './new-cause-alerts';

// D-067: an incident open for an SSL / domain expiry takes a more urgent PROBLEM as its cause.
const base = {
  incidentId: 'inc-136',
  incidentNumber: 136,
  site: 'DxT AI',
  tier: 3,
  was: 'ssl' as const,
  trigger: 'keyword' as const,
  summary: '“บาคาร่า” found on the page (as Googlebot)',
  cause: 'Found “บาคาร่า” on / (as Googlebot)',
  mention: { name: 'Tao', chatUserId: '111' },
  ackedBy: null,
  at: new Date('2026-09-24T03:00:00Z'),
};

describe('buildNewCauseAlert', () => {
  it('the text line: STATE · site · new cause · was · same incident, @mentioning whoever acts now', () => {
    const m = buildNewCauseAlert(base);
    expect(m.text).toBe(
      '<users/111> PROBLEM · DxT AI (Tier 3) · new cause: “บาคาร่า” found on the page (as Googlebot) · was SSL expiring · same incident INC-0136',
    );
    expect(m.cardsV2[0]!.card.header.title).toBe('PROBLEM · DxT AI · new cause: Keyword');
  });

  it('acknowledged earlier: says so; no Chat id: no mention; page text never carries markup', () => {
    const m = buildNewCauseAlert({
      ...base,
      mention: { name: 'Nok', chatUserId: null },
      ackedBy: 'Nok',
      cause: 'Found “<users/all>” on /',
    });
    expect(m.text.startsWith('PROBLEM · DxT AI')).toBe(true);
    const w = m.cardsV2[0]!.card.sections[0]!.widgets[0]!;
    const text = 'textParagraph' in w ? w.textParagraph.text : '';
    expect(text).toContain('Nok acknowledged earlier, so only Nok is mentioned.');
    expect(text).not.toContain('<users/all>');
  });
});

// Spec §40, D-068 (INC-0136 DxT AI, Wed 23 Sep; sample data, tests only).
const email: EmailBaseInput = {
  incidentId: 'inc-136',
  incidentNumber: 136,
  site: 'DxT AI',
  tier: 3,
  recipientId: 'u-tao',
  incidentUrl: 'https://monitor.example.test/incidents/inc-136',
  reason: 'owner',
  threadId: '<t@example.test>',
  startsThread: false,
};
const newCause = {
  ...email,
  now: 'Keyword',
  was: 'SSL expiring',
  wasCause: 'SSL certificate expires in 13 days (Tue 6 Oct)',
  cause: 'Found “บาคาร่า” on / (as Googlebot)',
  at: new Date('2026-09-23T02:14:00Z'),
  openedAt: new Date('2026-09-23T02:00:00Z'),
};

describe('buildNewCauseAlert — the ack set aside (§40.3)', () => {
  it('adds the set-aside line under the body', () => {
    const m = buildNewCauseAlert({ ...base, ackedBy: 'Tao', setAside: true });
    const widgets = m.cardsV2[0]!.card.sections[0]!.widgets;
    expect(widgets).toHaveLength(2);
    expect(JSON.stringify(widgets[1])).toContain(
      'Tao’s acknowledgement of the expiry is set aside — Keyword needs its own.',
    );
  });
});

describe('buildNewCauseEmail (EmailAlert "New cause", §40.3)', () => {
  it('not acknowledged yet: the board rows, Acknowledge + Open incident', () => {
    const m = buildNewCauseEmail(newCause);
    expect(m.text).toMatch(/^PROBLEM — NEW CAUSE: KEYWORD — DxT AI has a new problem/);
    expect(m.text).toContain('New cause: Keyword · found 09:14');
    expect(m.text).toContain('Was: SSL expiring — SSL certificate expires in 13 days (Tue 6 Oct)');
    expect(m.text).toContain('Incident: INC-0136, open since Wed 23 Sep 09:00 · now reads Keyword');
    expect(m.text).toContain('Next step: Acknowledge to stop the PROBLEM reminders');
    expect(m.html).toContain('?ack=1');
    expect(m.html).toContain('Open incident');
  });

  it('acknowledged for the expiry, set aside: the sentence, the row, still the Acknowledge button', () => {
    const m = buildNewCauseEmail({
      ...newCause,
      reason: 'acked',
      at: new Date('2026-09-23T07:20:00Z'),
      setAside: { by: 'Tao', at: new Date('2026-09-23T02:20:00Z') },
    });
    expect(m.text).toContain(
      'Tao acknowledged earlier, so only Tao is mentioned. That acknowledgement was for the SSL expiry — please acknowledge the new problem.',
    );
    expect(m.text).toContain(
      'Acknowledged: Tao at 09:20 for SSL expiring — set aside, Keyword needs its own',
    );
    expect(m.text).toContain('Incident: INC-0136 · now reads Keyword · not acknowledged for it yet');
    expect(m.html).toContain('?ack=1');
  });

  it('a domain expiry reads "domain expiry"; acknowledged for the new cause: no ask', () => {
    const m = buildNewCauseEmail({
      ...newCause,
      was: 'Domain expiring',
      wasCause: null,
      acknowledged: { by: 'Nok', at: new Date('2026-09-23T02:16:00Z') },
    });
    expect(m.text).toContain('Was: Domain expiring');
    expect(m.text).toContain('Nok acknowledged it at 09:16.');
    expect(m.text).toContain('Acknowledged: Nok at 09:16');
    expect(m.html).not.toContain('?ack=1');
    const aside = buildNewCauseEmail({
      ...newCause,
      was: 'Domain expiring',
      reason: 'acked',
      setAside: { by: 'Tao', at: new Date('2026-09-23T02:20:00Z') },
    });
    expect(aside.text).toContain('That acknowledgement was for the domain expiry');
  });

  it('the Chat reply failed: the fallback says so; after a DOWN: back up with it still open', () => {
    expect(buildNewCauseEmail({ ...newCause, reason: 'fallback' }).text).toContain('couldn’t be delivered');
    const after = buildNewCauseEmail({ ...newCause, afterDown: true });
    expect(after.text).toContain('was back up in INC-0136 with SSL expiring still open');
    expect(after.text).toContain('Incident: INC-0136, open since Wed 23 Sep 09:00');
  });
});

describe('RECOVERED · back up, still SSL expiring (§40.2)', () => {
  const still = { label: 'SSL expiring', cause: 'SSL certificate expires in 13 days (Tue 6 Oct)' };
  const times = {
    startedAt: new Date('2026-09-23T09:10:00Z'),
    recoveredAt: new Date('2026-09-23T09:18:00Z'),
    okLocations: 3,
  };

  it('Chat: the text line and card as ChatAlert draws them', () => {
    const m = buildRecoveredAlert({
      incidentId: 'inc-136',
      site: 'DxT AI',
      owner: { name: 'Tao', chatUserId: 'TAO' },
      ...times,
      clientUpdate: 'Client update marked by Bua 16:20',
      stillExpiry: { ...still, incidentNumber: 136, tier: 3, mention: { name: 'Tao', chatUserId: 'TAO' } },
    });
    expect(m.text).toBe(
      '<users/TAO> RECOVERED · DxT AI (Tier 3) · back after 8 min down · still SSL expiring · same incident INC-0136',
    );
    expect(m.cardsV2[0]!.card.header.title).toBe('RECOVERED · DxT AI · back up, still SSL expiring');
    expect(JSON.stringify(m.cardsV2)).toContain('Client update marked by Bua 16:20.');
  });

  it('email: the Chat words; the owner adds the root cause, anyone else opens the incident', () => {
    const owner = buildRecoveredEmail({ ...email, ...times, owner: 'Tao', ack: null, stillExpiry: still });
    expect(owner.text).toContain('DxT AI is back up, still SSL expiring');
    expect(owner.text).toContain(
      'Still open for: SSL expiring — SSL certificate expires in 13 days (Tue 6 Oct)',
    );
    expect(owner.html).toContain('#resolve');
    const other = buildRecoveredEmail({
      ...email,
      ...times,
      reason: 'emailed',
      owner: 'Tao',
      ack: { by: 'Nok', at: new Date('2026-09-23T09:12:00Z') },
      clientUpdate: 'Due 16:25 · Bua (AM) notified — the AM sends it',
      stillExpiry: still,
    });
    expect(other.text).toContain('Acknowledged: Nok at 16:12');
    expect(other.text).toContain('Client update: Due 16:25');
    expect(other.html).not.toContain('#resolve');
  });
});
