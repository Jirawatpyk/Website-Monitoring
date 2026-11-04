import { describe, expect, it } from 'vitest';
import { buildDownAlert, type ChatMessage } from './chat-alerts';
import { buildClientUpdateDueAlert } from './client-update-alerts';
import { buildClientUpdateDueEmail, buildDownEmail, buildStepEmail } from './email-alerts';
import { buildStepAlert } from './escalation-alerts';
import { buildAgainAlert } from './relapse-alerts';

// Spec §30 sample (test data only): realme.link opened by hand as INC-0143 at Sat 26 Sep 02:31 while the
// status engine was down; Ploy on call, Arm backup, Thee the AM; Escalate now L1 at 02:35 (S12b, D-055).
const at = (iso: string) => new Date(`${iso}+07:00`);
const ploy = { name: 'Ploy', chatUserId: 'PLOY' };
const arm = { name: 'Arm', chatUserId: 'ARM' };
const tao = { name: 'Tao', chatUserId: 'TAO' };
const thee = { name: 'Thee', chatUserId: 'THEE' };
const url = 'https://monitor.example.test/incidents/i143';
const manual = { openedBy: 'Tao', note: 'Home page shows a 502 error' };
const emailBase = {
  incidentId: 'i143',
  incidentNumber: 143,
  site: 'realme.link',
  tier: 1,
  recipientId: 'ploy',
  reason: 'oncall' as const,
  why: 'You got this because you’re on call.',
  incidentUrl: url,
  threadId: '<inc-i143@notify.example.test>',
  startsThread: true,
};

const widgets = (m: ChatMessage) => m.cardsV2[0]!.card.sections[0]!.widgets;
const rows = (m: ChatMessage) =>
  widgets(m).flatMap((w) => ('decoratedText' in w ? [[w.decoratedText.topLabel, w.decoratedText.text]] : []));

describe('DOWN opened by hand (spec §30.2, §30.5)', () => {
  const msg = buildDownAlert({
    incidentId: 'i143',
    incidentNumber: 143,
    site: 'realme.link',
    tier: 1,
    confirmedAt: at('2026-09-26T02:31:05'),
    now: at('2026-09-26T02:31:08'),
    cause: 'Hard fail',
    confirmingLocations: 2,
    owner: ploy,
    backup: arm,
    incidentUrl: `${url}?ack=1`,
    manual,
  });

  it('says it was opened by hand, by whom, in the text line', () => {
    expect(msg.text).toBe('<users/PLOY> DOWN · realme.link (Tier 1) · opened by hand by Tao');
  });

  it('the card: opened-by-hand time, what they saw as the cause, no probe confirmation', () => {
    expect(msg.cardsV2[0]!.card.header.subtitle).toBe('Tier 1 · INC-0143 · Opened by hand 02:31:05 (UTC+7)');
    expect(rows(msg)).toEqual(
      expect.arrayContaining([
        ['Cause', 'Hand check by Tao · “Home page shows a 502 error”'],
        ['Confirmed by', 'No probe check — opened by hand while the status engine was down'],
      ]),
    );
  });

  it('without a note the cause is the hand check alone', () => {
    const plain = buildDownAlert({
      incidentId: 'i143',
      incidentNumber: 143,
      site: 'realme.link',
      tier: 1,
      confirmedAt: at('2026-09-26T02:31:05'),
      now: at('2026-09-26T02:31:08'),
      cause: 'Hard fail',
      confirmingLocations: 2,
      owner: ploy,
      backup: arm,
      incidentUrl: url,
      manual: { openedBy: 'Tao', note: null },
    });
    expect(rows(plain)).toContainEqual(['Cause', 'Hand check by Tao']);
  });

  it('the L0 email carries the same facts', () => {
    const mail = buildDownEmail({
      ...emailBase,
      confirmedAt: at('2026-09-26T02:31:05'),
      cause: 'Hard fail',
      confirmingLocations: 2,
      now: at('2026-09-26T02:36:05'),
      manual,
    });
    expect(mail.text).toContain('Opened by hand');
    expect(mail.text).toContain('Hand check by Tao · “Home page shows a 502 error”');
    expect(mail.text).toContain('No probe check — opened by hand while the status engine was down');
    expect(mail.text).not.toContain('Confirmed down');
    expect(mail.html).toContain('“Home page shows a 502 error”');
  });

  it('escapes what the person typed in the email', () => {
    const mail = buildDownEmail({
      ...emailBase,
      confirmedAt: at('2026-09-26T02:31:05'),
      cause: 'Hard fail',
      confirmingLocations: 2,
      manual: { openedBy: 'Tao', note: '<script>x</script>' },
    });
    expect(mail.html).not.toContain('<script>');
  });
});

describe('Escalate now (spec §30.6)', () => {
  it('ESCALATED · L1 says it was sent by hand', () => {
    const msg = buildStepAlert({
      incidentId: 'i143',
      site: 'realme.link',
      severity: 'down',
      level: 1,
      elapsedMin: 4,
      owner: ploy,
      asked: [{ ...arm, role: 'backup' }],
      fyi: [tao],
      incidentUrl: url,
      byHand: 'Tao',
    });
    expect(msg.text).toBe(
      '<users/ARM> ESCALATED · L1 · realme.link DOWN 4 min, not acknowledged · please acknowledge · Tao FYI · sent by hand by Tao (the status engine is down)',
    );
    expect(JSON.stringify(msg.cardsV2)).toContain(
      'Sent by hand by Tao — the status engine is down, so nothing escalates on its own.',
    );
  });

  it('the L1 email has a Sent row', () => {
    const mail = buildStepEmail({
      ...emailBase,
      recipientId: 'arm',
      reason: 'step',
      why: 'You got this because you’re the backup owner.',
      startsThread: false,
      severity: 'down',
      level: 1,
      elapsedMin: 4,
      confirmedAt: at('2026-09-26T02:31:05'),
      owner: 'Ploy',
      asFyi: false,
      asked: 'Arm',
      byHand: 'Tao',
    });
    expect(mail.text).toContain(
      'By hand by Tao — the status engine is down, so nothing escalates on its own',
    );
  });

  it('without byHand nothing changes', () => {
    const msg = buildStepAlert({
      incidentId: 'i143',
      site: 'realme.link',
      severity: 'down',
      level: 1,
      elapsedMin: 15,
      owner: ploy,
      asked: [{ ...arm, role: 'backup' }],
      fyi: [],
      incidentUrl: url,
    });
    expect(msg.text).not.toContain('by hand');
  });
});

describe('Client-update reminder by hand (spec §30.7, D-055 item 3)', () => {
  it('names no wait it may not have reached, and says who sent it', () => {
    const msg = buildClientUpdateDueAlert({
      incidentId: 'i143',
      site: 'realme.link',
      tier: 1,
      people: [thee],
      noAm: false,
      client: 'realme',
      recovered: false,
      draftUrl: `${url}#client-update`,
      byHand: 'Tao',
    });
    expect(msg.text).toBe(
      '<users/THEE> CLIENT UPDATE DUE · realme.link DOWN · draft ready · sent by hand by Tao (the status engine is down)',
    );
    expect(msg.cardsV2[0]!.card.header.title).toBe('CLIENT UPDATE DUE · realme.link still down');
  });

  it('the AM email says it was sent by hand', () => {
    const mail = buildClientUpdateDueEmail({
      ...emailBase,
      recipientId: 'thee',
      reason: 'step',
      why: 'You got this because you’re the AM for realme.',
      startsThread: false,
      client: 'realme',
      confirmedAt: at('2026-09-26T02:31:05'),
      downMinutes: 5,
      cause: null,
      acked: null,
      noAm: false,
      draftUrl: `${url}#client-update`,
      byHand: 'Tao',
    });
    expect(mail.text).toContain('Tao sent this reminder by hand because the status engine is down');
    expect(mail.text).not.toContain('has been down 15 min');
    // The footer's reason stays true: the wait wasn't over (message check M4).
    expect(mail.text).toContain('Tao sent the reminder by hand while the status engine is down');
    expect(mail.text).not.toContain('site was down 15 min');
  });
});

describe('a display name can never inject a mention (message check M1)', () => {
  it('the opener is named in plain text', () => {
    const msg = buildDownAlert({
      incidentId: 'i143',
      incidentNumber: 143,
      site: 'realme.link',
      tier: 1,
      confirmedAt: at('2026-09-26T02:31:05'),
      now: at('2026-09-26T02:31:08'),
      cause: 'Hard fail',
      confirmingLocations: 2,
      owner: ploy,
      backup: arm,
      incidentUrl: url,
      manual: { openedBy: '<users/all>', note: null },
    });
    expect(msg.text).not.toContain('<users/all>');
    expect(JSON.stringify(msg.cardsV2)).not.toContain('<users/all>');
  });
});

describe('DOWN AGAIN reported by hand (D-055 item 7)', () => {
  const msg = buildAgainAlert({
    incidentId: 'i142',
    incidentNumber: 142,
    site: 'MuvMi',
    tier: 1,
    severity: 'down',
    trigger: 'manual',
    mention: arm,
    ackedBy: null,
    fromState: 'monitoring',
    droppedAt: at('2026-09-26T02:40:00'),
    backSince: at('2026-09-26T00:10:00'),
    minutesSoFar: 10,
    nowFlapping: false,
    flapping: false,
    manual: { openedBy: 'Tao', note: '502 again' },
  });

  it('the text line says who reported it', () => {
    expect(msg.text).toBe(
      '<users/ARM> DOWN AGAIN · MuvMi (Tier 1) · same incident INC-0142 · reported by hand by Tao',
    );
  });

  it('the reply says what they saw and that no probe checked it', () => {
    expect(JSON.stringify(widgets(msg))).toContain(
      'Hand check by Tao · “502 again” — no probe check, the status engine is down.',
    );
  });
});
