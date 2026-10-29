import type { EscalationPlan } from '@dxt/shared';
import { describe, expect, it } from 'vitest';
import {
  firstReminderOf,
  ladderClockStart,
  ladderDue,
  problemHoldUntil,
  scheduleOf,
  type LadderInput,
} from './escalation';

const bkk = (iso: string) => new Date(`${iso}+07:00`);

// Spec §7: Tier 2–3 respond Mon–Fri 09:00–18:00 (D-034); Fri 25 Sep 2026 as a holiday where noted.
const HOURS = { startMin: 9 * 60, endMin: 18 * 60, days: [1, 2, 3, 4, 5], holidays: new Set<string>() };
const FRIDAY_OFF = { ...HOURS, holidays: new Set(['2026-09-25']) };

// The seeded policies (D-034): DOWN L1 +15 backup + Admin, reminders every 15; PROBLEM L1 +60, every 60.
const down = (tier: 1 | 2 | 3): EscalationPlan => ({
  severity: 'down',
  tier,
  reminderMin: 15,
  steps: [
    { level: 0, delayMin: 0, targets: ['owner'], channels: ['chat', 'space', 'email'] },
    { level: 1, delayMin: 15, targets: ['backup', 'admins'], channels: ['chat', 'email'] },
  ],
});
const problem = (tier: 1 | 2 | 3): EscalationPlan => ({
  severity: 'problem',
  tier,
  reminderMin: 60,
  steps: [
    { level: 0, delayMin: 0, targets: ['owner'], channels: ['chat', 'space', 'email'] },
    { level: 1, delayMin: 60, targets: ['backup'], channels: ['chat', 'email'] },
  ],
});

// INC-0142 MuvMi (Tier 1): confirmed down 09:48:41 (spec §4).
const inc0142 = (now: string, over: Partial<LadderInput> = {}): LadderInput => ({
  plan: down(1),
  detectedAt: bkk('2026-09-25T09:48:41'),
  level: 0,
  state: 'unacked',
  hours: HOURS,
  now: bkk(now),
  ...over,
});
// INC-0139 ORCA Thailand (Tier 2): confirmed Thu 24 Sep 22:14, outside response hours.
const inc0139 = (now: string, over: Partial<LadderInput> = {}): LadderInput => ({
  plan: down(2),
  detectedAt: bkk('2026-09-24T22:14:00'),
  level: 0,
  state: 'unacked',
  hours: HOURS,
  now: bkk(now),
  ...over,
});

describe('ladderDue — the DOWN ladder (spec §8, D-034)', () => {
  it.each([
    ['INC-0142 at 10:03:40, a second early: nothing', inc0142('2026-09-25T10:03:40'), null],
    ['INC-0142 at 10:03:41: L1 (15 min after confirmed)', inc0142('2026-09-25T10:03:41'), 1],
    ['INC-0142 at 10:07 still unacked: L1', inc0142('2026-09-25T10:07:12'), 1],
    [
      'INC-0142 acknowledged (the ack stops the ladder): no L1',
      inc0142('2026-09-25T10:07:12', { state: 'acknowledged' }),
      null,
    ],
    [
      'INC-0142 L1 already fired: no step',
      inc0142('2026-09-25T10:10:00', { level: 1, state: 'escalated' }),
      null,
    ],
    ['INC-0139 Thu 22:14: L0 only, timers paused', inc0139('2026-09-24T22:15:00'), null],
    ['INC-0139 Fri 09:14: still waiting', inc0139('2026-09-25T09:14:59'), null],
    ['INC-0139 Fri 09:15: L1', inc0139('2026-09-25T09:15:00'), 1],
    [
      'INC-0139 on a Friday holiday, Fri 10:00: nothing',
      inc0139('2026-09-25T10:00:00', { hours: FRIDAY_OFF }),
      null,
    ],
    ['INC-0139 on a Friday holiday, Mon 09:15: L1', inc0139('2026-09-28T09:15:00', { hours: FRIDAY_OFF }), 1],
    [
      'recovered (Monitoring): the ladder waits',
      inc0142('2026-09-25T10:07:00', { state: 'monitoring' }),
      null,
    ],
    ['a relapse after a recovered spell fires the overdue L1 once', inc0142('2026-09-25T10:30:00'), 1],
    [
      'Tier 1 runs at 03:00',
      { ...inc0142('2026-09-26T03:20:00'), detectedAt: bkk('2026-09-26T03:05:00') },
      1,
    ],
  ])('%s', (_case, input, level) => {
    expect(ladderDue(input).step?.level ?? null).toBe(level);
  });

  it('gives the step its due time (the L1 message says when)', () => {
    expect(ladderDue(inc0142('2026-09-25T10:07:12')).step?.dueAt).toEqual(bkk('2026-09-25T10:03:41'));
    expect(ladderDue(inc0139('2026-09-25T09:20:00')).step?.dueAt).toEqual(bkk('2026-09-25T09:15:00'));
  });

  it('fires one level at a time (S10 adds more levels)', () => {
    const plan = down(1);
    plan.steps.push({ level: 2, delayMin: 30, targets: ['admins'], channels: ['chat'] });
    expect(ladderDue(inc0142('2026-09-25T10:30:00', { plan })).step?.level).toBe(1);
    expect(
      ladderDue(inc0142('2026-09-25T10:30:00', { plan, level: 1, state: 'escalated' })).step?.level,
    ).toBe(2);
  });
});

// The S10 seed (spec §8, §14.1, D-009): Tier 1 L2 +30 CEO, L3 +60 CEO + Site AM as an FYI that still
// goes after an ack; Tier 2–3 L2 +30 a reminder to the Admin.
const full = (tier: 1 | 2 | 3): EscalationPlan => ({
  ...down(tier),
  steps: [
    ...down(tier).steps,
    ...(tier === 1
      ? [
          {
            level: 2,
            delayMin: 30,
            targets: ['ceo' as const],
            channels: ['chat' as const, 'email' as const, 'voice' as const],
          },
          {
            level: 3,
            delayMin: 60,
            targets: ['ceo' as const, 'site_am' as const],
            channels: ['chat' as const, 'email' as const],
            fyi: true,
          },
        ]
      : [
          {
            level: 2,
            delayMin: 30,
            targets: ['admins' as const],
            channels: ['chat' as const, 'email' as const],
          },
        ]),
  ],
});

describe('ladderDue — L2 and the L3 FYI (spec §8, §14.1; S10 T05)', () => {
  const t1 = (now: string, over: Partial<LadderInput> = {}) => inc0142(now, { plan: full(1), ...over });
  it.each([
    ['no ack, 10:18:40: nothing yet', t1('2026-09-25T10:18:40', { level: 1, state: 'escalated' }), null],
    ['no ack, 10:18:41: L2 (CEO, +30)', t1('2026-09-25T10:18:41', { level: 1, state: 'escalated' }), 2],
    ['no ack, 10:48:41: L3 (+60)', t1('2026-09-25T10:48:41', { level: 2, state: 'escalated' }), 3],
    ['all four fired: nothing more', t1('2026-09-25T11:30:00', { level: 3, state: 'escalated' }), null],
    // §14.1: "Acknowledged by Arm → L1–L2 stopped. If MuvMi is still down at 10:48, CEO + Bua get an FYI".
    [
      'acked 10:07 after L1, 10:18:41: no L2',
      t1('2026-09-25T10:18:41', { level: 1, state: 'acknowledged' }),
      null,
    ],
    [
      'acked 10:07, 10:48:40: nothing yet',
      t1('2026-09-25T10:48:40', { level: 1, state: 'acknowledged' }),
      null,
    ],
    [
      'acked 10:07, still down 10:48:41: the L3 FYI',
      t1('2026-09-25T10:48:41', { level: 1, state: 'acknowledged' }),
      3,
    ],
    [
      'acked at +5 before L1, 10:48:41: the L3 FYI',
      t1('2026-09-25T10:48:41', { level: 0, state: 'acknowledged' }),
      3,
    ],
    [
      // The level doesn't say whether the FYI went (an FYI after an ack keeps it): the SQL sends it once.
      'acked at level 3 (a D-021 raise from a PROBLEM ladder): the FYI is still offered',
      t1('2026-09-25T11:00:00', { level: 3, state: 'acknowledged' }),
      3,
    ],
    [
      'acked after L2, 10:48:41: the L3 FYI',
      t1('2026-09-25T10:48:41', { level: 2, state: 'acknowledged' }),
      3,
    ],
    [
      'unacked at level 1, 10:48:41: L2 first, one level at a time',
      t1('2026-09-25T10:48:41', { level: 1, state: 'escalated' }),
      2,
    ],
    [
      'recovered by 10:48 (Monitoring): nothing is sent',
      t1('2026-09-25T10:48:41', { level: 1, state: 'monitoring' }),
      null,
    ],
    ['Needs root cause: nothing', t1('2026-09-25T10:48:41', { level: 1, state: 'needs_root_cause' }), null],
    [
      'Tier 2 INC-0139: L2 reminder to the Admin Fri 09:30',
      inc0139('2026-09-25T09:30:00', { plan: full(2), level: 1, state: 'escalated' }),
      2,
    ],
    [
      'Tier 2 acked: no L2 (no FYI step)',
      inc0139('2026-09-25T09:30:00', { plan: full(2), level: 1, state: 'acknowledged' }),
      null,
    ],
  ])('%s', (_case, input, level) => {
    expect(ladderDue(input).step?.level ?? null).toBe(level);
  });

  it('the FYI keeps its due time (Confirmed down + 60), and an ack sends no reminder', () => {
    const due = ladderDue(t1('2026-09-25T10:50:00', { level: 1, state: 'acknowledged' }));
    expect(due.step).toEqual({ level: 3, dueAt: bkk('2026-09-25T10:48:41') });
    expect(due.reminder).toBeUndefined();
  });

  it('INC-0142 schedule: L1 10:03:41, L2 10:18:41, L3 10:48:41', () => {
    expect(scheduleOf(t1('2026-09-25T10:00:00')).map((s) => s.dueAt)).toEqual([
      bkk('2026-09-25T09:48:41'),
      bkk('2026-09-25T10:03:41'),
      bkk('2026-09-25T10:18:41'),
      bkk('2026-09-25T10:48:41'),
    ]);
  });

  it('reminders skip the step minutes: +45 then +75', () => {
    expect(ladderDue(t1('2026-09-25T10:34:00', { level: 2, state: 'escalated' })).reminder?.afterMin).toBe(
      45,
    );
    expect(ladderDue(t1('2026-09-25T10:48:41', { level: 2, state: 'escalated' })).reminder).toBeUndefined();
    expect(ladderDue(t1('2026-09-25T11:04:00', { level: 3, state: 'escalated' })).reminder?.afterMin).toBe(
      75,
    );
  });
});

describe('ladderDue — reminders in the thread (PRD §7, D-034)', () => {
  it.each([
    ['at +15 the L1 message is the reminder', inc0142('2026-09-25T10:03:41'), null],
    ['+29: nothing new', inc0142('2026-09-25T10:18:00', { level: 1, state: 'escalated' }), null],
    ['+30: STILL DOWN 30 min', inc0142('2026-09-25T10:18:41', { level: 1, state: 'escalated' }), 30],
    ['+52: the latest due is +45', inc0142('2026-09-25T10:40:41', { level: 1, state: 'escalated' }), 45],
    ['acknowledged: none', inc0142('2026-09-25T10:40:41', { state: 'acknowledged' }), null],
  ])('%s', (_case, input, minutes) => {
    expect(ladderDue(input).reminder?.afterMin ?? null).toBe(minutes);
  });

  it('PROBLEM: L1 at +60 is that reminder; then every 60', () => {
    const p = (now: string, over: Partial<LadderInput> = {}) =>
      inc0142(now, { plan: problem(1), detectedAt: bkk('2026-09-25T09:52:00'), ...over });
    expect(ladderDue(p('2026-09-25T10:52:00')).step?.level).toBe(1);
    expect(ladderDue(p('2026-09-25T10:52:00')).reminder).toBeUndefined();
    expect(ladderDue(p('2026-09-25T11:52:00', { level: 1, state: 'escalated' })).reminder).toEqual({
      afterMin: 120,
      dueAt: bkk('2026-09-25T11:52:00'),
    });
  });

  it('Tier 2–3 reminders count response-hours minutes', () => {
    const r = ladderDue(inc0139('2026-09-25T09:31:00', { level: 1, state: 'escalated' })).reminder;
    expect(r).toEqual({ afterMin: 30, dueAt: bkk('2026-09-25T09:30:00') });
  });
});

describe('ladderDue — paused', () => {
  it('Tier 2–3 outside response hours says when the timers resume', () => {
    expect(ladderDue(inc0139('2026-09-24T22:15:00')).pausedUntil).toEqual(bkk('2026-09-25T09:00:00'));
    expect(ladderDue(inc0139('2026-09-25T10:00:00')).pausedUntil).toBeUndefined();
    expect(ladderDue(inc0142('2026-09-26T03:00:00')).pausedUntil).toBeUndefined();
  });

  // Engine review round 2: a paused Tier 2–3 timer fires nothing, even a level that came due earlier.
  const fri = (now: string, over: Partial<LadderInput> = {}) =>
    inc0139(now, { detectedAt: bkk('2026-09-25T09:00:00'), ...over });
  it.each([
    ['relapse Fri 22:00, L1 overdue since 09:15: nothing until Mon 09:00', fri('2026-09-25T22:00:00'), null],
    ['… Mon 09:00: L1', fri('2026-09-28T09:00:00'), 1],
  ])('%s', (_case, input, level) => {
    expect(ladderDue(input).step?.level ?? null).toBe(level);
  });

  it('Tier 2 DOWN at 17:00, L1 fired, 18:00:30: no reminder (closed)', () => {
    const late = inc0139('2026-09-25T18:00:30', {
      detectedAt: bkk('2026-09-25T17:00:00'),
      level: 1,
      state: 'escalated',
    });
    expect(ladderDue(late).reminder).toBeUndefined();
    expect(ladderDue(late).pausedUntil).toEqual(bkk('2026-09-28T09:00:00'));
  });
});

describe('scheduleOf — when each step fires if nobody acknowledges', () => {
  it('INC-0142: L0 09:48:41, L1 10:03:41', () => {
    expect(scheduleOf(inc0142('2026-09-25T10:00:00'))).toEqual([
      { level: 0, dueAt: bkk('2026-09-25T09:48:41') },
      { level: 1, dueAt: bkk('2026-09-25T10:03:41') },
    ]);
  });
  it('INC-0139: L0 Thu 22:14, L1 Fri 09:15', () => {
    expect(scheduleOf(inc0139('2026-09-24T22:15:00')).map((s) => s.dueAt)).toEqual([
      bkk('2026-09-24T22:14:00'),
      bkk('2026-09-25T09:15:00'),
    ]);
  });
});

describe('problemHoldUntil — a PROBLEM outside response hours waits until 09:00 (spec §7, §19.2)', () => {
  it.each([
    ['Tier 2 PROBLEM Thu 22:14 → Fri 09:00', 2, '2026-09-24T22:14:00', '2026-09-25T09:00:00'],
    ['Tier 2 PROBLEM inside hours → now', 2, '2026-09-25T10:00:00', null],
    ['Tier 1 PROBLEM at night → now (24/7)', 1, '2026-09-24T22:14:00', null],
  ])('%s', (_case, tier, at, want) => {
    expect(problemHoldUntil(tier as 1 | 2 | 3, bkk(at), HOURS)).toEqual(want ? bkk(want) : null);
  });
});

describe('firstReminderOf — the preview’s first reminder, skipped on a step minute (D-034)', () => {
  it.each([
    ['Tier 1 DOWN (L1 +15, every 15) → +30', down(1), '2026-09-25T09:48:41', 30, '2026-09-25T10:18:41'],
    ['PROBLEM (L1 +60, every 60) → +120', problem(1), '2026-09-25T09:48:41', 120, '2026-09-25T11:48:41'],
    [
      'PROBLEM without L1 → +60',
      { ...problem(1), steps: problem(1).steps.slice(0, 1) },
      '2026-09-25T09:48:41',
      60,
      '2026-09-25T10:48:41',
    ],
    [
      'Tier 2 DOWN Thu 22:14 → Fri 09:30 (response-hours minutes)',
      down(2),
      '2026-09-24T22:14:00',
      30,
      '2026-09-25T09:30:00',
    ],
  ])('%s', (_case, plan, at, afterMin, dueAt) => {
    expect(firstReminderOf({ plan, detectedAt: bkk(at), hours: HOURS })).toEqual({
      afterMin,
      dueAt: bkk(dueAt),
    });
  });
  it('agrees with ladderDue: the reminder ladderDue sends first is the one the preview shows', () => {
    const first = firstReminderOf(inc0142('2026-09-25T10:00:00'))!;
    expect(ladderDue(inc0142('2026-09-25T10:19:00', { level: 1, state: 'escalated' })).reminder).toEqual(
      first,
    );
  });
});

describe('ladderClockStart — an incident a mute silenced (D-036)', () => {
  const detectedAt = bkk('2026-09-25T09:48:41');
  it('counts from Confirmed down when the first alert went at once', () => {
    expect(ladderClockStart({ detectedAt, alertedAt: null })).toEqual(detectedAt);
    expect(ladderClockStart({ detectedAt })).toEqual(detectedAt);
  });

  it('counts from the late alert when a mute held it back: L1 15 min after the mute ended', () => {
    const alertedAt = bkk('2026-09-25T10:30:00');
    const start = ladderClockStart({ detectedAt, alertedAt });
    expect(start).toEqual(alertedAt);
    expect(ladderDue(inc0142('2026-09-25T10:44:59', { detectedAt: start })).step).toBeUndefined();
    expect(ladderDue(inc0142('2026-09-25T10:45:00', { detectedAt: start })).step).toEqual({
      level: 1,
      dueAt: bkk('2026-09-25T10:45:00'),
    });
  });

  it('a Tier 2 PROBLEM alerted late outside response hours is held to the next opening from then', () => {
    const start = ladderClockStart({
      detectedAt: bkk('2026-09-24T17:00:00'),
      alertedAt: bkk('2026-09-24T19:00:00'),
    });
    expect(problemHoldUntil(2, start, HOURS)).toEqual(bkk('2026-09-25T09:00:00'));
  });
});
