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
  it('@mentions the backup, Tao FYI, no CEO until S10', () => {
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
  it('DOWN: L1 stopped (the board’s L1–L2 comes with S10)', () => {
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
