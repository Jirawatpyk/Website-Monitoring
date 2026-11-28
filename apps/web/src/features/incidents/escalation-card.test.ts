import { describe, expect, it } from 'vitest';
import type { EscalationPlan } from '@dxt/shared';
import { escalationCardOf, pendingClientUpdate } from './escalation-card';

// Spec §30.6–8 sample (test data only): realme.link INC-0143 opened by hand Sat 26 Sep 02:31, the
// engine down since 02:17; Ploy on call (L0), Arm backup, Tao Admin, Thee the AM; L1 sent by hand 02:35.
const at = (hhmm: string) => `2026-09-26T${hhmm}:00+07:00`;
const PLAN: EscalationPlan = {
  severity: 'down',
  tier: 1,
  reminderMin: 15,
  steps: [
    { level: 0, delayMin: 0, targets: ['owner'], channels: ['chat', 'space', 'email'] },
    { level: 1, delayMin: 15, targets: ['backup', 'admins'], channels: ['chat', 'email'] },
    { level: 2, delayMin: 30, targets: ['ceo'], channels: ['chat', 'email', 'voice'] },
    { level: 3, delayMin: 60, targets: ['ceo', 'site_am'], channels: ['chat', 'email'], fyi: true },
  ],
};
const HOURS = { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5], holidays: new Set<string>() };
const base = {
  plan: PLAN,
  tier: 1,
  severity: 'down' as const,
  level: 0,
  state: 'unacked',
  detectedAt: at('02:31'),
  alertedAt: null,
  hours: HOURS,
  steps: [],
  people: { owner: { name: 'Ploy', onCall: true }, backup: 'Arm', am: 'Thee', admins: ['Tao'] },
  acked: null,
  engine: { stopped: true, since: at('02:17') },
  canAct: true,
};

describe('escalationCardOf (S12b, spec §30.6–8, D-055)', () => {
  it('engine down, nothing sent yet: the ladder, the danger note, Escalate now · L1', () => {
    const card = escalationCardOf(base)!;
    expect(card.title).toBe('Escalation · Tier 1 DOWN');
    expect(card.rows.map((r) => [r.label, r.when, r.status])).toEqual([
      ['L0', '0 min · 02:31', 'Sent 02:31'],
      ['L1', '+15 min · 02:46', 'Waits — engine down'],
      ['L2', '+30 min · 03:01', 'Waits'],
      ['L3', '+60 min · 03:31', 'Waits'],
    ]);
    expect(card.rows[0]!.who).toBe('Ploy (on call) + Alerts Space');
    expect(card.rows[1]!.who).toBe('Arm (backup) + Tao');
    expect(card.stopped).toBe(
      'Nothing escalates on its own — the status engine is down since 02:17. Send the next level by hand if nobody acknowledges.',
    );
    expect(card.button).toEqual({
      level: 1,
      label: 'Escalate now · L1 (Arm, backup · Tao)',
      title: 'Send L1 now?',
      people: [
        { name: 'Arm', role: 'backup' },
        { name: 'Tao', role: 'Admin' },
      ],
      cta: 'Send L1 now',
    });
    expect(card.footer).toBe('Acknowledge stops escalation. It does not stop the client update.');
  });

  it('after L1 by hand: "Sent 02:35 by Tao", the button moves to L2 (CEO), then L3', () => {
    const l1 = escalationCardOf({
      ...base,
      level: 1,
      state: 'escalated',
      steps: [{ level: 1, at: at('02:35'), sentBy: 'Tao' }],
    })!;
    expect(l1.rows[1]!.status).toBe('Sent 02:35 by Tao');
    // Sent early by hand: the schedule column keeps its +15 time (D-058 review).
    expect(l1.rows[1]!.when).toBe('+15 min · 02:46');
    expect(l1.rows[2]!.status).toBe('Waits — engine down');
    expect(l1.button?.label).toBe('Escalate now · L2 (CEO)');
    const l2 = escalationCardOf({
      ...base,
      level: 2,
      state: 'escalated',
      steps: [
        { level: 1, at: at('02:35'), sentBy: 'Tao' },
        { level: 2, at: at('02:36'), sentBy: 'Tao' },
      ],
    })!;
    expect(l2.button?.label).toBe('Escalate now · L3 (CEO + Thee, Site AM)');
    expect(l2.button?.people).toEqual([
      { name: 'CEO', role: 'L3' },
      { name: 'Thee', role: 'Site AM' },
    ]);
  });

  it('engine back at 02:44 (§30.8): no button, the running-again line, the next level at its normal time', () => {
    const card = escalationCardOf({
      ...base,
      level: 1,
      state: 'escalated',
      steps: [{ level: 1, at: at('02:35'), sentBy: 'Tao' }],
      engine: { stopped: false, since: at('02:44') },
    })!;
    expect(card.button).toBeNull();
    expect(card.stopped).toBeNull();
    expect(card.back).toBe('Automatic escalation is running again — levels already sent won’t repeat.');
    // the engine-back timeline line ends with it (§30.8, §31.7)
    expect(card.nextLine).toBe('Next: L2 at 03:01 if still unacked.');
    expect(card.rows.map((r) => r.status)).toEqual([
      'Sent 02:31',
      'Sent 02:35 by Tao',
      'At 03:01 if unacked',
      'If still unacked',
    ]);
  });

  it('the ESCALATION fact: the last level sent, what comes next, or that the ack stopped it', () => {
    expect(escalationCardOf(base)!.fact).toEqual({
      value: 'L0 · Ploy',
      caption: 'Engine down — nothing escalates on its own',
    });
    const running = escalationCardOf({
      ...base,
      engine: { stopped: false, since: at('02:40') },
      now: new Date(at('02:35')),
    })!;
    expect(running.fact).toEqual({ value: 'L0 · Ploy', caption: 'L1 at 02:46 (in 11 min)' });
    expect(
      escalationCardOf({ ...base, state: 'acknowledged', acked: { by: 'Ploy' }, problemSince: '09:35' })!
        .fact,
    ).toEqual({
      value: 'Stopped · acked',
      caption: 'Still acknowledged as a PROBLEM — nothing more is sent',
    });
    const live = { ...base, engine: { stopped: false, since: null } };
    // Acked with the Tier 1 FYI still to go: say what the ack stopped (board "L1–L2 stopped").
    expect(
      escalationCardOf({ ...live, state: 'acknowledged', acked: { by: 'Ploy' }, now: new Date(at('02:40')) })!
        .fact,
    ).toEqual({ value: 'L1–L2 stopped', caption: 'L3 FYI at 03:31 if still down' });
    // The next level is the CEO: named as the CEO step (Incident board, Probes case).
    expect(
      escalationCardOf({
        ...live,
        level: 1,
        state: 'escalated',
        steps: [{ level: 1, at: at('02:46'), sentBy: null }],
        now: new Date(at('02:50')),
      })!.fact,
    ).toEqual({ value: 'L1 · Arm + Tao', caption: 'CEO step at 03:01 (in 11 min)' });
    // A level sent by hand, then the engine back: the Manual case's words.
    expect(
      escalationCardOf({
        ...live,
        level: 1,
        state: 'escalated',
        steps: [{ level: 1, at: at('02:35'), sentBy: 'Tao' }],
        now: new Date(at('02:44')),
      })!.fact,
    ).toEqual({ value: 'L1 · sent by hand', caption: 'Running again · next at 03:01' });
    // One person in two roles is named once.
    expect(
      escalationCardOf({
        ...live,
        people: { ...base.people, backup: 'Tao' },
        level: 1,
        state: 'escalated',
        steps: [{ level: 1, at: at('02:46'), sentBy: null }],
      })!.fact.value,
    ).toBe('L1 · Tao');
  });

  it('§37: an unacked DOWN whose home page came back — the levels wait, not "Recovered"', () => {
    const card = escalationCardOf({
      ...base,
      engine: { stopped: false, since: null },
      episodes: [{ severity: 'down', start: new Date(at('02:31')), end: new Date(at('02:40')) }],
      problemSince: '02:40',
      now: new Date(at('02:50')),
    })!;
    expect(card.fact.caption).toBe('DOWN levels wait · home page back 02:40');
    expect(card.rows[1]!.status).toBe('Waits · home page back 02:40');
  });

  it('the footer names the ack time (Incident board §37)', () => {
    expect(
      escalationCardOf({
        ...base,
        state: 'acknowledged',
        acked: { by: 'Ploy', at: '09:06' },
        problemSince: '09:35',
      })!.footer,
    ).toBe(
      'Acknowledged by Ploy 09:06 → escalation stopped. From 09:35 the same incident carries on as a PROBLEM and stays acknowledged, so no PROBLEM reminders go out.',
    );
  });

  it('§37.6: one person named once with both roles; a held Tier 2–3 alert says the Space had it first', () => {
    const tao = { ...base, people: { ...base.people, backup: 'Tao' } };
    expect(escalationCardOf(tao)!.rows[1]!.who).toBe('Tao (backup, Admin)');
    // INC-0140 (§37): Tier 2, confirmed Thu 24 Sep 23:42 — the Space had it at once, the timers waited.
    const held = escalationCardOf({
      ...base,
      tier: 2,
      detectedAt: '2026-09-24T23:42:08+07:00',
      now: new Date('2026-09-25T10:07:00+07:00'),
    })!;
    // The DOWN's L0 went with the first card at 23:42 (D-065: a DOWN is never held; the board's "09:00" isn't)
    expect(held.rows[0]).toEqual({
      label: 'L0',
      when: '0 min · Thu 23:42',
      who: 'Ploy (on call) + Alerts Space · posted to the Space at 23:42, outside response hours — timers paused until 09:00',
      status: 'Sent Thu 23:42',
      tone: 'sent',
    });
    // A Tier 2–3 PROBLEM at night: the first card itself waits for the opening (D-034 `holdFor`).
    const problem = { ...PLAN, severity: 'problem' as const, tier: 2 as const };
    const heldProblem = (now: string) =>
      escalationCardOf({
        ...base,
        plan: problem,
        tier: 2,
        severity: 'problem',
        detectedAt: '2026-09-24T23:42:08+07:00',
        now: new Date(now),
      })!.rows[0]!;
    expect(heldProblem('2026-09-25T02:00:00+07:00')).toEqual({
      label: 'L0',
      when: '0 min · 09:00',
      who: 'Ploy (on call) + Alerts Space · held until 09:00, outside response hours',
      status: 'Held until 09:00',
      tone: 'waits',
    });
    expect(heldProblem('2026-09-25T10:00:00+07:00').status).toBe('Sent 09:00');
    // Sat 02:31: the next opening is Monday's, so it carries its weekday.
    expect(escalationCardOf({ ...base, tier: 2 })!.rows[0]!.who).toBe(
      'Ploy (on call) + Alerts Space · posted to the Space at 02:31, outside response hours — timers paused until Mon 09:00',
    );
    // Inside response hours (Fri 10:00) and Tier 1: no note.
    expect(
      escalationCardOf({ ...base, tier: 2, detectedAt: '2026-09-25T10:00:00+07:00' })!.rows[0]!.who,
    ).toBe('Ploy (on call) + Alerts Space');
    expect(escalationCardOf(base)!.rows[0]!.who).toBe('Ploy (on call) + Alerts Space');
    // Held by a mute over the night (D-036): a muted incident posted nothing, so no "posted to the Space".
    const muted = escalationCardOf({
      ...base,
      tier: 2,
      detectedAt: '2026-09-24T23:42:00+07:00',
      alertedAt: '2026-09-25T10:00:00+07:00',
    })!;
    expect(muted.rows[0]!.who).toBe('Ploy (on call) + Alerts Space');
  });

  it('Acknowledge stops it: the button goes, the rest is cancelled', () => {
    const card = escalationCardOf({ ...base, state: 'acknowledged', acked: { by: 'Tao' } })!;
    expect(card.button).toBeNull();
    expect(card.stopped).toBeNull();
    expect(card.rows.slice(1, 3).every((r) => r.status === 'Cancelled · acked')).toBe(true);
    // The Tier 1 CEO + AM FYI still goes after an ack while it is DOWN (§14.1, engine review M2).
    expect(card.rows[3]!.status).toBe('Waits — engine down');
    const running = escalationCardOf({
      ...base,
      state: 'acknowledged',
      acked: { by: 'Tao' },
      engine: { stopped: false, since: at('02:40') },
    })!;
    expect(running.rows[3]!.status).toBe('At 03:31 · FYI');
    expect(card.footer).toBe('Acknowledged by Tao → escalation stopped. The client-update track continues.');
  });

  it('§37.6: no client-update promise on an internal site; a DOWN carrying on as a PROBLEM says so', () => {
    const acked = { ...base, state: 'acknowledged', acked: { by: 'Ploy' } };
    expect(escalationCardOf({ ...acked, clientTrack: false })!.footer).toBe(
      'Acknowledged by Ploy → escalation stopped.',
    );
    expect(escalationCardOf({ ...base, clientTrack: false })!.footer).toBe('Acknowledge stops escalation.');
    expect(escalationCardOf({ ...acked, clientTrack: false, problemSince: '09:35' })!.footer).toBe(
      'Acknowledged by Ploy → escalation stopped. From 09:35 the same incident carries on as a PROBLEM and stays acknowledged, so no PROBLEM reminders go out.',
    );
  });

  it('only those who may acknowledge get the button; the engine running: none and no note', () => {
    expect(escalationCardOf({ ...base, canAct: false })!.button).toBeNull();
    const running = escalationCardOf({ ...base, engine: { stopped: false, since: at('02:30') } })!;
    expect(running.button).toBeNull();
    expect(running.back).toBeNull();
    // nothing to say while the engine is down, or once acknowledged
    expect(escalationCardOf(base)!.nextLine).toBeNull();
    expect(
      escalationCardOf({
        ...running,
        ...base,
        state: 'acknowledged',
        engine: { stopped: false, since: null },
      })!.nextLine,
    ).toBeNull();
  });

  it('every level sent: no button', () => {
    expect(escalationCardOf({ ...base, level: 3, state: 'escalated' })!.button).toBeNull();
  });

  it('no plan (an incident from before S08): no card', () => {
    expect(escalationCardOf({ ...base, plan: null })).toBeNull();
  });
});

describe('pendingClientUpdate — the Resolve card agrees with the pre-fire reminder (D-055 item 3)', () => {
  const gate = {
    conditions: [
      { key: 'recovery', met: false, detail: 'Still down' },
      { key: 'client_update', met: true, detail: 'Not required — the client-update track didn’t fire' },
      { key: 'root_cause', met: false, detail: 'Not written yet' },
    ],
    metCount: 1,
    lockedReason: 'Resolve locked · 1 of 3 met — Test target is still down',
  };
  it('the condition is due, not met, and the locked line counts the same', () => {
    const g = pendingClientUpdate({ dueAt: '02:46' }, gate);
    expect(g.conditions[1]).toMatchObject({ met: false, detail: 'Due 02:46 · client site' });
    expect(g.metCount).toBe(0);
    expect(g.lockedReason).toBe('Resolve locked · 0 of 3 met — Test target is still down');
  });
  it('no reminder: unchanged', () => expect(pendingClientUpdate(null, gate)).toBe(gate));
});

describe('escalationCardOf — after a relapse (D-058)', () => {
  it('down 5 min at 02:31, back, down again 08:00: L1 at 08:10, L0 stays at its first alert', () => {
    const drop = (start: string, confirmed: string, end: string | null) => ({
      start: new Date(at(start)),
      confirmedAt: new Date(at(confirmed)),
      end: end ? new Date(at(end)) : null,
      severity: 'down' as const,
    });
    const card = escalationCardOf({
      ...base,
      engine: { stopped: false, since: at('08:00') },
      episodes: [drop('02:30', '02:31', '02:36'), drop('07:59', '08:00', null)],
    })!;
    expect(card.rows.map((r) => [r.label, r.when])).toEqual([
      ['L0', '0 min · 02:31'],
      ['L1', '+15 min · 08:10'],
      ['L2', '+30 min · 08:25'],
      ['L3', '+60 min · 08:55'],
    ]);
  });

  it('L1 sent in the first drop keeps its time; L2 counts on from the relapse (engine review L1)', () => {
    const drop = (start: string, confirmed: string, end: string | null) => ({
      start: new Date(at(start)),
      confirmedAt: new Date(at(confirmed)),
      end: end ? new Date(at(end)) : null,
      severity: 'down' as const,
    });
    const card = escalationCardOf({
      ...base,
      level: 1,
      state: 'escalated',
      steps: [{ level: 1, at: at('02:46'), sentBy: null }],
      engine: { stopped: false, since: at('08:00') },
      episodes: [drop('02:30', '02:31', '02:50'), drop('07:59', '08:00', null)],
    })!;
    expect(card.rows.map((r) => [r.label, r.when, r.status])).toEqual([
      ['L0', '0 min · 02:31', 'Sent 02:31'],
      ['L1', '+15 min · 02:46', 'Sent 02:46'],
      ['L2', '+30 min · 08:11', 'At 08:11 if unacked'],
      ['L3', '+60 min · 08:41', 'If still unacked'],
    ]);
  });

  it('a D-023 key-page drop on a DOWN incident: the DOWN levels wait, nothing promised (engine review L2)', () => {
    const card = escalationCardOf({
      ...base,
      engine: { stopped: false, since: at('03:00') },
      episodes: [
        {
          start: new Date(at('02:30')),
          confirmedAt: new Date(at('02:31')),
          end: new Date(at('02:40')),
          severity: 'down',
        },
        { start: new Date(at('02:40')), confirmedAt: new Date(at('02:40')), end: null, severity: 'problem' },
      ],
    })!;
    expect(card.rows.slice(1).every((r) => r.tone === 'cancelled')).toBe(true);
    expect(card.nextLine).toBeNull();
    expect(card.rows[1]!.status).toBe('Not sent · recovered 02:40');
  });

  // spec-check, D-058: a key-page drop with the home page back.
  const keyPageDrop = [
    {
      start: new Date(at('02:30')),
      confirmedAt: new Date(at('02:31')),
      end: new Date(at('02:40')),
      severity: 'down' as const,
    },
    {
      start: new Date(at('02:40')),
      confirmedAt: new Date(at('02:40')),
      end: null,
      severity: 'problem' as const,
    },
  ];

  it('…with the engine down: no danger note, no Escalate now', () => {
    const card = escalationCardOf({ ...base, episodes: keyPageDrop })!;
    expect(card.stopped).toBeNull();
    expect(card.button).toBeNull();
  });

  it.each([
    ['engine running', { stopped: false, since: at('03:00') }],
    ['engine down', { stopped: true, since: at('02:17') }],
  ])('acknowledged, %s: the L3 FYI promises nothing — "Not sent · recovered 02:40"', (_n, engine) => {
    const card = escalationCardOf({
      ...base,
      level: 1,
      state: 'acknowledged',
      acked: { by: 'Ploy' },
      steps: [{ level: 1, at: at('02:46'), sentBy: null }],
      engine,
      episodes: keyPageDrop,
    })!;
    expect(card.rows[3]!.status).toBe('Not sent · recovered 02:40');
    expect(card.rows[2]!.status).toBe('Cancelled · acked');
  });

  it('a level that went in a drop two days ago carries its day (spec §13)', () => {
    const drop = (start: string, confirmed: string, end: string | null) => ({
      start: new Date(start),
      confirmedAt: new Date(confirmed),
      end: end ? new Date(end) : null,
      severity: 'down' as const,
    });
    const card = escalationCardOf({
      ...base,
      level: 1,
      state: 'escalated',
      steps: [{ level: 1, at: at('02:46'), sentBy: null }],
      engine: { stopped: false, since: '2026-09-28T08:00:00+07:00' },
      episodes: [
        drop(at('02:30'), at('02:31'), at('02:50')),
        drop('2026-09-28T07:59:00+07:00', '2026-09-28T08:00:00+07:00', null),
      ],
      now: new Date('2026-09-28T08:01:00+07:00'),
    })!;
    expect(card.rows.slice(0, 2).map((r) => [r.when, r.status])).toEqual([
      ['0 min · Sat 02:31', 'Sent Sat 02:31'],
      ['+15 min · Sat 02:46', 'Sent Sat 02:46'],
    ]);
    expect(card.rows[2]!.when).toBe('+30 min · 08:11');
  });
});

describe('escalationCardOf — the night-time L0 row (D-065, engine re-review)', () => {
  const thu = (hhmm: string) => `2026-09-24T${hhmm}:00+07:00`;
  const fri = (hhmm: string) => `2026-09-25T${hhmm}:00+07:00`;
  const problem = { ...PLAN, severity: 'problem' as const, tier: 2 as const };
  const night = {
    ...base,
    plan: problem,
    tier: 2,
    severity: 'problem' as const,
    detectedAt: thu('23:42'),
    engine: { stopped: false, since: null },
  };
  const ep = (start: string, end: string | null) => ({
    start: new Date(start),
    confirmedAt: new Date(start),
    end: end ? new Date(end) : null,
    severity: 'problem' as const,
  });
  it('a held PROBLEM that recovered before 09:00 never went: not "Sent 09:00"', () => {
    const row = escalationCardOf({
      ...night,
      state: 'resolved',
      episodes: [ep(thu('23:42'), thu('23:45'))],
      now: new Date(fri('10:00')),
    })!.rows[0]!;
    expect([row.status, row.tone]).toEqual(['Not sent · recovered Thu 23:45', 'cancelled']);
  });
  it('acked before the opening: the card was cancelled, at 08:30 and at 10:00', () => {
    const acked = { ...night, state: 'acknowledged', acked: { by: 'Ploy' }, ackedAt: fri('08:04') };
    expect(escalationCardOf({ ...acked, now: new Date(fri('08:30')) })!.rows[0]!.status).toBe(
      'Not sent · acked 08:04',
    );
    expect(escalationCardOf({ ...acked, now: new Date(fri('10:00')) })!.rows[0]!.status).toBe(
      'Not sent · acked 08:04',
    );
  });
  it('recovered at 01:00, PROBLEM AGAIN at 10:30: still no "Sent 09:00"', () => {
    const row = escalationCardOf({
      ...night,
      episodes: [ep(thu('23:42'), fri('01:00')), ep(fri('10:30'), null)],
      now: new Date(fri('10:40')),
    })!.rows[0]!;
    expect(row.status).toBe('Not sent · recovered 01:00');
  });
  it('a mute covered the detection: no "posted to the Space", nothing sent', () => {
    const muted = {
      ...base,
      tier: 2,
      detectedAt: thu('23:42'),
      mutedAtDetection: true,
      engine: { stopped: false, since: null },
    };
    const open = escalationCardOf({ ...muted, now: new Date(fri('01:00')) })!.rows[0]!;
    expect(open.who).toBe('Ploy (on call) + Alerts Space');
    expect([open.status, open.tone]).toEqual(['Held by a mute', 'waits']);
    expect(
      escalationCardOf({ ...muted, state: 'resolved', now: new Date(fri('03:00')) })!.rows[0]!.status,
    ).toBe('Not sent · muted');
  });
  it('a PROBLEM whose mute ended at 02:00: the late card waits for 09:00, not "Sent 02:00"', () => {
    const late = { ...night, alertedAt: fri('02:00') };
    expect(escalationCardOf({ ...late, now: new Date(fri('02:30')) })!.rows[0]!.status).toBe(
      'Held until 09:00',
    );
    expect(escalationCardOf({ ...late, now: new Date(fri('09:30')) })!.rows[0]!.status).toBe('Sent 09:00');
  });
});

describe('escalationCardOf — the ESCALATION fact, board states (spec re-check)', () => {
  const live = { ...base, engine: { stopped: false, since: null } };
  it('Tier 1 acked after L1 went: "L1–L2 stopped", the FYI still to come', () => {
    const card = escalationCardOf({
      ...live,
      level: 1,
      state: 'acknowledged',
      acked: { by: 'Ploy' },
      steps: [{ level: 1, at: at('02:46'), sentBy: null }],
      now: new Date(at('02:50')),
    })!;
    expect(card.fact).toEqual({ value: 'L1–L2 stopped', caption: 'L3 FYI at 03:31 if still down' });
  });
  it('acked with the engine down: the FYI waits, it is not "nothing more is sent"', () => {
    const card = escalationCardOf({ ...base, state: 'acknowledged', acked: { by: 'Ploy' } })!;
    expect(card.fact).toEqual({ value: 'L1–L2 stopped', caption: 'L3 FYI waits — engine down' });
  });
  it('"Running again" only while the latest level sent was by hand', () => {
    const card = escalationCardOf({
      ...live,
      level: 2,
      state: 'escalated',
      steps: [
        { level: 1, at: at('02:35'), sentBy: 'Tao' },
        { level: 2, at: at('03:01'), sentBy: null },
      ],
      now: new Date(at('03:05')),
    })!;
    expect(card.fact).toEqual({ value: 'L2 · CEO', caption: 'L3 at 03:31 (in 26 min)' });
  });
});

describe('escalationCardOf — Tier 1 L2 → Management (D-078, Incident board)', () => {
  const plan: EscalationPlan = {
    ...PLAN,
    steps: PLAN.steps.map((s) =>
      s.level === 2 ? { ...s, targets: ['management'], channels: ['chat', 'email'] } : s,
    ),
  };
  const mg = { ...base, plan, people: { ...base.people, management: ['Vee', 'Pim'] } };
  it('the row, the next caption and Escalate now name the group', () => {
    const live = escalationCardOf({
      ...mg,
      engine: { stopped: false, since: null },
      level: 1,
      steps: [{ level: 1, at: at('02:46'), sentBy: null }],
      now: new Date(at('02:50')),
    })!;
    expect(live.rows[2]!.who).toBe('Management (Vee, Pim)');
    expect(live.fact.caption).toBe('Management (Vee, Pim) at 03:01 (in 11 min)');
    const down = escalationCardOf({
      ...mg,
      level: 1,
      steps: [{ level: 1, at: at('02:35'), sentBy: 'Tao' }],
    })!;
    expect(down.button?.label).toBe('Escalate now · L2 (Management · Vee, Pim)');
  });
});
