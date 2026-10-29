import { describe, expect, it } from 'vitest';
import { buildAcknowledgedAlert, buildDownAlert, buildProblemAlert } from './chat-alerts';
import {
  buildAcknowledgedEmail,
  buildDownEmail,
  buildFlapSummaryEmail,
  buildStepEmail,
} from './email-alerts';
import { buildReminderAlert, buildStepAlert, formatResume, ladderLine } from './escalation-alerts';
import { buildAgainAlert } from './relapse-alerts';

const bkk = (iso: string) => new Date(`${iso}+07:00`);
const arm = { name: 'Arm', chatUserId: 'ARM' };
const ploy = { name: 'Ploy', chatUserId: 'PLOY' };
const nok = { name: 'Nok', chatUserId: 'NOK' };
const tao = { name: 'Tao', chatUserId: 'TAO' };
const url = 'https://monitor.example.test/incidents/i142';
const base = {
  incidentId: 'i142',
  incidentNumber: 142,
  site: 'MuvMi',
  tier: 1,
  incidentUrl: url,
  threadId: '<inc-i142@notify.example.test>',
  startsThread: false,
};
// INC-0142: confirmed down 09:48:41; L1 at 10:03:41 to Ploy (backup) + Tao (spec §4, ChatAlert).
const ladder = { next: { level: 1, at: bkk('2026-09-25T10:03:41'), ask: ['Ploy'], fyi: ['Tao'] } };

describe('DOWN first card with the ladder (ChatAlert MuvMi day, D-034)', () => {
  const msg = buildDownAlert({
    incidentId: 'i142',
    incidentNumber: 142,
    site: 'MuvMi',
    tier: 1,
    confirmedAt: bkk('2026-09-25T09:48:41'),
    now: bkk('2026-09-25T09:48:45'),
    cause: 'Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)',
    confirmingLocations: 3,
    owner: arm,
    backup: ploy,
    incidentUrl: url,
    ladder,
  });
  it('promises the ack deadline in the text line', () => {
    expect(msg.text).toBe('<users/ARM> DOWN · MuvMi (Tier 1) · acknowledge by 10:03 or it escalates');
  });
  it('names the backup as not notified yet and the Next step', () => {
    const rows = JSON.stringify(msg.cardsV2);
    expect(rows).toContain('Arm · backup Ploy (not notified yet)');
    expect(rows).toContain('L1 at 10:03 if not acknowledged — Ploy, Tao');
    expect(rows).not.toContain('CEO');
  });
});

describe('Tier 2 DOWN outside response hours (ChatAlert ORCA row)', () => {
  it('says the timers are paused, with no "acknowledge by"', () => {
    const msg = buildDownAlert({
      incidentId: 'i139',
      incidentNumber: 139,
      site: 'ORCA Thailand',
      tier: 2,
      confirmedAt: bkk('2026-09-24T22:14:00'),
      now: bkk('2026-09-24T22:14:05'),
      cause: 'HTTP 503 (BKK, SIN, TYO)',
      confirmingLocations: 3,
      owner: tao,
      backup: nok,
      incidentUrl: url,
      ladder: {
        pausedUntil: bkk('2026-09-25T09:00:00'),
        next: { level: 1, at: bkk('2026-09-25T09:15:00'), ask: ['Nok'], fyi: [] },
      },
    });
    expect(msg.text).toBe(
      '<users/TAO> DOWN · ORCA Thailand (Tier 2) · outside response hours · timers paused until 09:00',
    );
  });
});

describe('ESCALATED · L1 (ChatAlert 10:03)', () => {
  it('@mentions the backup, Tao FYI (no next level named when there is none)', () => {
    const msg = buildStepAlert({
      incidentId: 'i142',
      site: 'MuvMi',
      severity: 'down',
      level: 1,
      elapsedMin: 15,
      owner: arm,
      asked: [{ ...ploy, role: 'backup' }],
      fyi: [tao],
      incidentUrl: url,
    });
    expect(msg.text).toBe(
      '<users/PLOY> ESCALATED · L1 · MuvMi DOWN 15 min, not acknowledged · please acknowledge · Tao FYI',
    );
    expect(msg.cardsV2[0]?.card.header.title).toBe(
      'ESCALATED · L1 · MuvMi still down · 15 min, not acknowledged',
    );
    expect(JSON.stringify(msg.cardsV2)).toContain(
      'Arm hasn’t acknowledged. Ploy (backup) please take it; Tao is informed.',
    );
  });

  it('@mentions the Admin when nobody else is new (L1 · night rule)', () => {
    const msg = buildStepAlert({
      incidentId: 'i1',
      site: 'MuvMi',
      severity: 'down',
      level: 1,
      elapsedMin: 15,
      owner: arm,
      asked: [{ ...tao, role: 'Admin' }],
      fyi: [],
      incidentUrl: url,
    });
    expect(msg.text).toBe(
      '<users/TAO> ESCALATED · L1 · MuvMi DOWN 15 min, not acknowledged · please acknowledge',
    );
  });

  it('PROBLEM L1 at +60: STILL PROBLEM, owner and backup @mentioned (ChatAlert Fuji Links)', () => {
    const msg = buildStepAlert({
      incidentId: 'i141',
      site: 'Fuji Links',
      severity: 'problem',
      level: 1,
      elapsedMin: 60,
      owner: ploy,
      asked: [{ ...nok, role: 'backup' }],
      fyi: [],
      incidentUrl: url,
    });
    expect(msg.text).toBe(
      '<users/PLOY> <users/NOK> STILL PROBLEM · Fuji Links · 1 h, not acknowledged · Nok (backup) please take it',
    );
  });
});

describe('S10 steps: L2 to the CEO, the L3 FYI, the Tier 2–3 L2 reminder (ChatAlert rows, D-048)', () => {
  const ceo = { name: 'CEO', chatUserId: 'CEO' };
  const bua = { name: 'Bua', chatUserId: 'BUA' };
  const step = (over: Partial<Parameters<typeof buildStepAlert>[0]>) =>
    buildStepAlert({
      incidentId: 'i142',
      site: 'MuvMi',
      severity: 'down',
      level: 1,
      elapsedMin: 15,
      owner: arm,
      asked: [],
      fyi: [],
      incidentUrl: `${url}?ack=1`,
      viewUrl: url,
      ...over,
    });

  it('L1 names the next level: "· CEO at 10:18"', () => {
    const msg = step({
      asked: [{ ...ploy, role: 'backup' }],
      fyi: [tao],
      next: { who: 'CEO', at: bkk('2026-09-25T10:18:41') },
    });
    expect(msg.text).toBe(
      '<users/PLOY> ESCALATED · L1 · MuvMi DOWN 15 min, not acknowledged · please acknowledge · Tao FYI · CEO at 10:18',
    );
    expect(JSON.stringify(msg.cardsV2)).toContain(
      'Arm hasn’t acknowledged. Ploy (backup) please take it; Tao is informed. Next: CEO at 10:18.',
    );
  });

  it('L2 (CEO): @mentions the CEO, names who was told', () => {
    const msg = step({
      level: 2,
      elapsedMin: 30,
      kind: 'ceo',
      asked: [{ ...ceo, role: 'CEO' }],
      informed: ['Arm', 'Ploy', 'Tao'],
    });
    expect(msg.text).toBe(
      '<users/CEO> ESCALATED · L2 · MuvMi DOWN 30 min, not acknowledged · Arm, Ploy, Tao informed',
    );
    const card = JSON.stringify(msg.cardsV2);
    expect(card).toContain('Arm, Ploy and Tao were asked.');
    expect(card).toContain('Open incident');
    expect(card).not.toContain('?ack=1');
  });

  it('L3 FYI after an ack: CEO + Bua, no action needed', () => {
    const msg = step({
      level: 3,
      elapsedMin: 60,
      kind: 'fyi',
      asked: [
        { ...ceo, role: 'CEO' },
        { ...bua, role: 'account manager' },
      ],
      acked: { by: 'Arm', at: bkk('2026-09-25T10:07:40') },
    });
    expect(msg.text).toBe(
      '<users/CEO> <users/BUA> FYI · L3 · MuvMi still DOWN 1 h · acknowledged by Arm 10:07 · no action needed',
    );
    expect(JSON.stringify(msg.cardsV2)).toContain('Arm acknowledged at 10:07 and is working on it.');
  });

  it('L3 FYI nobody acknowledged (D-048 draft)', () => {
    const msg = step({
      level: 3,
      elapsedMin: 60,
      kind: 'fyi',
      asked: [
        { ...ceo, role: 'CEO' },
        { ...bua, role: 'account manager' },
      ],
      informed: ['Arm', 'Ploy', 'Tao', 'CEO'],
    });
    expect(msg.text).toBe(
      '<users/CEO> <users/BUA> FYI · L3 · MuvMi still DOWN 1 h · not acknowledged · Arm, Ploy, Tao, CEO informed · no action needed',
    );
  });

  it('Tier 2–3 L2: REMINDER · L2 to Tao (§16.5)', () => {
    const msg = step({
      site: 'WeCare Studio',
      level: 2,
      elapsedMin: 30,
      kind: 'reminder',
      asked: [{ ...tao, role: 'Admin' }],
    });
    expect(msg.text).toBe('<users/TAO> REMINDER · L2 · WeCare Studio DOWN 30 min, not acknowledged');
  });

  it('ACKNOWLEDGED on a Tier 1 ladder: L1–L2 stopped', () => {
    const msg = buildAcknowledgedAlert({
      incidentId: 'i142',
      site: 'MuvMi',
      ackedBy: 'Arm',
      ackedAt: bkk('2026-09-25T10:07:40'),
      stopped: {
        severity: 'down',
        backup: 'Ploy',
        l1Fired: true,
        stopsThrough: 2,
        fyi: { level: 3, at: bkk('2026-09-25T10:48:41') },
      },
    });
    expect(msg.text).toBe('ACKNOWLEDGED · MuvMi · by Arm 10:07 · L1–L2 stopped');
    expect(JSON.stringify(msg.cardsV2)).toContain('Acknowledged by Arm → L1–L2 stopped.');
  });
});

describe('S10 emails (EmailAlert L2 / L3)', () => {
  const email = (over: Partial<Parameters<typeof buildStepEmail>[0]>) =>
    buildStepEmail({
      ...base,
      recipientId: 'ceo',
      reason: 'step',
      why: 'You got this because …',
      severity: 'down',
      level: 2,
      elapsedMin: 30,
      confirmedAt: bkk('2026-09-25T09:48:41'),
      owner: 'Arm',
      asFyi: false,
      asked: 'CEO',
      ...over,
    });
  it('L2 to the CEO: voice configured, next step L3', () => {
    const m = email({
      kind: 'ceo',
      informed: ['Arm', 'Ploy', 'Tao'],
      voiceConfigured: true,
      nextStep: 'L3 (CEO + Bua, no call) at 10:48',
    });
    expect(m.html).toContain('ESCALATED · L2');
    expect(m.html).toContain('MuvMi down 30 min — nobody has acknowledged');
    expect(m.html).toContain('Arm, Ploy and Tao were asked.');
    expect(m.html).toContain('Configured · off until approved');
    expect(m.html).toContain('L3 (CEO + Bua, no call) at 10:48');
  });
  it('L3 FYI to the AM after an ack', () => {
    const m = email({
      level: 3,
      elapsedMin: 60,
      kind: 'fyi',
      readerIs: 'site_am',
      acked: { by: 'Arm', at: bkk('2026-09-25T10:07:40') },
    });
    expect(m.html).toContain('FYI · L3');
    expect(m.html).toContain('MuvMi still down after 1 h — Arm is on it');
    expect(m.html).toContain(
      'If the client needs a second update, the draft on the incident page is current.',
    );
    expect(m.html).toContain('Recovery email when it’s back · no more escalation');
  });
});

describe('reminders (PRD §7, D-034)', () => {
  it('STILL DOWN at +30', () => {
    const msg = buildReminderAlert({
      incidentId: 'i142',
      site: 'MuvMi',
      severity: 'down',
      elapsedMin: 30,
      mention: [arm, ploy],
      incidentUrl: url,
    });
    expect(msg.text).toBe(
      '<users/ARM> <users/PLOY> STILL DOWN · MuvMi · 30 min, not acknowledged · please acknowledge',
    );
  });
  it('STILL PROBLEM at 2 h', () => {
    const msg = buildReminderAlert({
      incidentId: 'i141',
      site: 'Fuji Links',
      severity: 'problem',
      elapsedMin: 120,
      mention: [ploy, nok],
      incidentUrl: url,
    });
    expect(msg.text).toBe('<users/PLOY> <users/NOK> STILL PROBLEM · Fuji Links · 2 h, not acknowledged');
  });
});

describe('ACKNOWLEDGED says what stopped', () => {
  it('DOWN with no L2 (an edited ladder): L1 stopped', () => {
    const msg = buildAcknowledgedAlert({
      incidentId: 'i142',
      site: 'MuvMi',
      ackedBy: 'Arm',
      ackedAt: bkk('2026-09-25T10:07:40'),
      stopped: { severity: 'down', backup: 'Ploy', l1Fired: true },
    });
    expect(msg.text).toBe('ACKNOWLEDGED · MuvMi · by Arm 10:07 · L1 stopped');
    expect(JSON.stringify(msg.cardsV2)).toContain('Acknowledged by Arm → L1 stopped.');
  });
  it('PROBLEM: the 60-min reminder and the backup step are stopped (ChatAlert Fuji Links 09:58)', () => {
    const msg = buildAcknowledgedAlert({
      incidentId: 'i141',
      site: 'Fuji Links',
      ackedBy: 'Ploy',
      ackedAt: bkk('2026-09-25T09:58:00'),
      problem: { trigger: 'slow', slowLimitMs: 5000 },
      stopped: { severity: 'problem', backup: 'Nok', l1Fired: false, reminderMin: 60 },
    });
    expect(msg.text).toBe('ACKNOWLEDGED · Fuji Links · by Ploy 09:58 · reminders stopped');
    expect(JSON.stringify(msg.cardsV2)).toContain(
      'Acknowledged by Ploy → the 60-min reminder and the Nok (backup) step are stopped. The site is up; it’s only slow.',
    );
  });
});

describe('DOWN AGAIN outside response hours (ChatAlert VOCA)', () => {
  it('adds the paused timers', () => {
    const msg = buildAgainAlert({
      incidentId: 'i133',
      incidentNumber: 133,
      site: 'VOCA',
      tier: 2,
      severity: 'down',
      trigger: 'hard_fail',
      mention: ploy,
      ackedBy: null,
      fromState: 'monitoring',
      droppedAt: bkk('2026-09-21T03:24:00'),
      backSince: bkk('2026-09-21T03:19:00'),
      minutesSoFar: 7,
      nowFlapping: false,
      flapping: false,
      pausedUntil: bkk('2026-09-21T09:00:00'),
    });
    expect(msg.text).toBe(
      '<users/PLOY> DOWN AGAIN · VOCA (Tier 2) · same incident INC-0133 · outside response hours · timers paused until 09:00',
    );
  });

  it('on a Friday night the resume carries its day', () => {
    const msg = buildAgainAlert({
      incidentId: 'i133',
      incidentNumber: 133,
      site: 'VOCA',
      tier: 2,
      severity: 'down',
      trigger: 'hard_fail',
      mention: ploy,
      ackedBy: null,
      fromState: 'monitoring',
      droppedAt: bkk('2026-09-25T22:00:00'),
      backSince: bkk('2026-09-25T21:50:00'),
      minutesSoFar: 7,
      nowFlapping: false,
      flapping: false,
      pausedUntil: bkk('2026-09-28T09:00:00'),
    });
    expect(msg.text).toContain('timers paused until Mon 28 Sep 09:00');
  });
});

describe('emails', () => {
  it('Down email: "acknowledge by 10:03" and the Next step', () => {
    const e = buildDownEmail({
      ...base,
      recipientId: 'arm',
      reason: 'owner',
      startsThread: true,
      confirmedAt: bkk('2026-09-25T09:48:41'),
      cause: 'Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)',
      confirmingLocations: 3,
      ladder,
      now: bkk('2026-09-25T09:48:45'),
    });
    expect(e.text).toContain('Next step: L1 at 10:03 if not acknowledged — Ploy, Tao');
    expect(e.html).toContain('acknowledge by 10:03');
  });

  it('L1 email to the backup asks; to the Admin it informs (EmailAlert 10:03)', () => {
    const common = {
      ...base,
      severity: 'down' as const,
      level: 1,
      elapsedMin: 15,
      confirmedAt: bkk('2026-09-25T09:48:41'),
      owner: 'Arm',
      asked: 'Ploy',
      reason: 'step' as const,
    };
    const toPloy = buildStepEmail({
      ...common,
      recipientId: 'ploy',
      asFyi: false,
      why: 'You got this because you’re backup for MuvMi and it wasn’t acknowledged in 15 min.',
    });
    expect(toPloy.text).toContain('ESCALATED · L1 — MuvMi still down — 15 min, no ack');
    expect(toPloy.text).toContain(
      'Arm hasn’t acknowledged. Please acknowledge — you’re the next person for this incident.',
    );
    expect(toPloy.text).toContain('Already told: Arm — Chat + email 09:48');
    expect(toPloy.text).toContain('You got this because you’re backup for MuvMi');
    const toTao = buildStepEmail({
      ...common,
      recipientId: 'tao',
      asFyi: true,
      why: 'You got this because you’re the Admin — L1 keeps you informed.',
    });
    expect(toTao.text).toContain(
      'For your information — Ploy has been asked to acknowledge. Nothing needed from you.',
    );
    expect(toTao.text).not.toContain('Acknowledge:');
    expect(toTao.text).not.toContain('CEO');
  });

  it('the D-016 fallback: the L1 Chat reply failed, so this email is the alert — with Acknowledge', () => {
    const e = buildStepEmail({
      ...base,
      recipientId: 'tao',
      reason: 'fallback',
      severity: 'down',
      level: 1,
      elapsedMin: 15,
      confirmedAt: bkk('2026-09-25T09:48:41'),
      owner: 'Arm',
      asked: 'Ploy',
      asFyi: true,
      fallback: true,
    });
    expect(e.text).toContain(
      'Arm hasn’t acknowledged. The Google Chat reply couldn’t be delivered, so this email is the alert.',
    );
    expect(e.text).toContain(`Acknowledge: ${url}?ack=1`);
    expect(e.text).not.toContain('For your information');
  });

  it('a held Tier 2 PROBLEM: the Cause row, detection with its day, told at the opening', () => {
    const e = buildStepEmail({
      ...base,
      site: 'ORCA Thailand',
      tier: 2,
      recipientId: 'nok',
      reason: 'step',
      why: 'You got this because you’re backup for ORCA Thailand.',
      severity: 'problem',
      level: 1,
      elapsedMin: 60,
      // Flagged Thu 22:14, held until Fri 09:00 (spec §7); L1 at +60 response-hours minutes.
      confirmedAt: bkk('2026-09-24T22:14:00'),
      toldAt: bkk('2026-09-25T09:00:00'),
      cause: 'Slow — 6.2 s (limit 5 s)',
      owner: 'Tao',
      asked: 'Nok',
      asFyi: false,
    });
    expect(e.text).toContain('STILL PROBLEM — ORCA Thailand still has a problem — 1 h, no ack');
    // The fact row is how long it has been wrong (wall clock); the headline how long unacknowledged.
    expect(e.text).toContain('Problem for: 11 h 46 min (detected Thu 24 Sep 22:14:00)');
    expect(e.html).toContain('ORCA Thailand problem not acknowledged for 1 h');
    expect(e.text).toContain('Cause: Slow — 6.2 s (limit 5 s)');
    expect(e.text).toContain('Already told: Tao — Chat + email 09:00');
    expect(e.text).toContain('Please take it — you’re the next person for this incident.');
  });

  it('INC-0139: a Tier 2 DOWN from the night, L1 at Fri 09:15 — the detection carries its day', () => {
    const e = buildStepEmail({
      ...base,
      site: 'ORCA Thailand',
      tier: 2,
      recipientId: 'nok',
      reason: 'step',
      severity: 'down',
      level: 1,
      elapsedMin: 661,
      confirmedAt: bkk('2026-09-24T22:14:00'),
      owner: 'Tao',
      asked: 'Nok',
      asFyi: false,
    });
    expect(e.text).toContain('Down for: 11 h 1 min (confirmed down Thu 24 Sep 22:14:00)');
  });

  it('an L1 email the same day shows the time alone', () => {
    const e = buildStepEmail({
      ...base,
      recipientId: 'ploy',
      reason: 'step',
      severity: 'down',
      level: 1,
      elapsedMin: 15,
      confirmedAt: bkk('2026-09-25T09:48:41'),
      owner: 'Arm',
      asked: 'Ploy',
      asFyi: false,
    });
    expect(e.text).toContain('Down for: 15 min (confirmed down 09:48:41)');
  });

  it('Acknowledged email, PROBLEM: the reminders and the backup step stopped', () => {
    const e = buildAcknowledgedEmail({
      ...base,
      site: 'Fuji Links',
      recipientId: 'arm',
      reason: 'emailed',
      ackedBy: 'Arm',
      ackedAt: bkk('2026-09-25T09:58:00'),
      startedAt: bkk('2026-09-25T09:52:00'),
      confirmedAt: bkk('2026-09-25T09:52:00'),
      problem: { trigger: 'slow' },
      stopped: { severity: 'problem', backup: 'Nok', l1Fired: false, reminderMin: 60 },
    });
    expect(e.text).toContain('Acknowledged by Arm → reminders stopped.');
    expect(e.text).toContain('Reminders: 60-min reminder and the Nok (backup) step are stopped');
    // Acked the morning after: the detection carries its day.
    const next = buildAcknowledgedEmail({
      ...base,
      recipientId: 'tao',
      reason: 'emailed',
      ackedBy: 'Tao',
      ackedAt: bkk('2026-09-25T10:05:00'),
      startedAt: bkk('2026-09-24T22:14:00'),
      confirmedAt: bkk('2026-09-24T22:14:00'),
      problem: { trigger: 'slow' },
    });
    expect(next.text).toContain('(detected Thu 24 Sep 22:14)');
  });

  it('Acknowledged email says L1 stopped', () => {
    const e = buildAcknowledgedEmail({
      ...base,
      recipientId: 'arm',
      reason: 'emailed',
      ackedBy: 'Arm',
      ackedAt: bkk('2026-09-25T10:07:40'),
      startedAt: bkk('2026-09-25T09:48:12'),
      confirmedAt: bkk('2026-09-25T09:48:41'),
      stopped: { severity: 'down', backup: 'Ploy', l1Fired: true },
    });
    expect(e.text).toContain('Acknowledged by Arm → L1 stopped.');
  });

  it('flap summary: not acknowledged outside response hours (EmailAlert VOCA)', () => {
    const e = buildFlapSummaryEmail({
      ...base,
      site: 'VOCA',
      tier: 2,
      recipientId: 'ploy',
      reason: 'owner',
      severity: 'down',
      drops: [{ start: bkk('2026-09-21T03:12:00'), end: bkk('2026-09-21T03:19:00') }],
      owner: 'Ploy',
      ack: null,
      pausedUntil: bkk('2026-09-21T09:00:00'),
    });
    expect(e.text).toContain('Acknowledged: Not yet — outside response hours, timers paused until 09:00');
  });
});

describe('ladderLine / formatResume', () => {
  it('a resume further than tomorrow carries its day', () => {
    expect(formatResume(bkk('2026-09-28T09:00:00'), bkk('2026-09-25T18:30:00'))).toBe('Mon 28 Sep 09:00');
    expect(ladderLine(null, new Date())).toEqual([]);
  });
});

describe('PROBLEM first card with the ladder (ChatAlert Fuji Links)', () => {
  it('Next: "Reminder at 10:52 … — Ploy, Nok" (the email reads "Reminder + Nok (backup)")', () => {
    const msg = buildProblemAlert({
      incidentId: 'i141',
      incidentNumber: 141,
      site: 'Fuji Links',
      tier: 2,
      trigger: 'slow',
      detectedAt: bkk('2026-09-25T09:52:00'),
      now: bkk('2026-09-25T09:52:05'),
      cause: 'p50 5.8 s',
      summary: 'slow, p50 5.8 s',
      seenFrom: { count: 3, of: 3 },
      owner: ploy,
      backup: nok,
      incidentUrl: url,
      ladder: { next: { level: 1, at: bkk('2026-09-25T10:52:00'), ask: ['Nok'], fyi: [] } },
    });
    const rows = JSON.stringify(msg.cardsV2);
    expect(rows).toContain('Ploy · backup Nok (not notified yet)');
    expect(rows).toContain('Reminder at 10:52 if not acknowledged — Ploy, Nok');
  });
});
