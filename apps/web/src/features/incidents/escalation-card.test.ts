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
