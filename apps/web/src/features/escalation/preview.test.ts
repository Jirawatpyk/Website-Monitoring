import { describe, expect, it } from 'vitest';
import type { PolicyDraft } from './model';
import { ackCase, isReminderStep, nobodyWhy, scenario, sitesOf, stepNames, tokenRows } from './preview';

const bkk = (iso: string) => new Date(`${iso}+07:00`);
const hours = { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5], holidays: new Set<string>() };
const muvmi = { id: 's1', name: 'MuvMi', tier: 1, owner: 'Arm', backup: 'Ploy', am: 'Bua' };
const orca = { id: 's2', name: 'ORCA Thailand', tier: 2, owner: 'Tao', backup: 'Nok', am: 'Thee' };
const down = (tier: number): PolicyDraft => ({
  id: `p${tier}`,
  key: `t${tier}` as PolicyDraft['key'],
  severity: 'down',
  tier,
  steps: [
    { level: 0, delayMin: 0, targets: ['owner'], channels: ['chat', 'space', 'email'] },
    { level: 1, delayMin: 15, targets: ['backup', 'admins'], channels: ['chat', 'email'] },
  ],
});

describe('preview (S08, D-034)', () => {
  it('resolves the tokens for a site; an internal site has no AM', () => {
    expect(tokenRows(muvmi, ['Tao'])).toEqual([
      { token: 'Owner', name: 'Arm' },
      { token: 'Backup', name: 'Ploy' },
      { token: 'Admin', name: 'Tao' },
      { token: 'Site AM', name: 'Bua' },
      { token: 'CEO', name: 'CEO' },
    ]);
    expect(tokenRows({ ...muvmi, am: null }, [])[3]).toEqual({ token: 'Site AM', name: '— (internal)' });
  });

  it('S10: L2 names the CEO; the FYI tells CEO + AM again; Tier 2–3 L2 reminds the Admin', () => {
    const t1 = [
      ...down(1).steps,
      { level: 2, delayMin: 30, targets: ['ceo' as const], channels: ['chat' as const, 'email' as const] },
      {
        level: 3,
        delayMin: 60,
        targets: ['ceo' as const, 'site_am' as const],
        channels: ['chat' as const, 'email' as const],
        fyi: true,
      },
    ];
    expect(stepNames(t1, 2, muvmi, ['Tao'])).toEqual(['CEO']);
    expect(stepNames(t1, 3, muvmi, ['Tao'])).toEqual(['CEO', 'Bua']);
    const t2 = [
      ...down(2).steps,
      { level: 2, delayMin: 30, targets: ['admins' as const], channels: ['chat' as const, 'email' as const] },
    ];
    expect(stepNames(t2, 2, orca, ['Tao'])).toEqual(['Tao']);
    expect(isReminderStep(t2, 2, orca, ['Tao'])).toBe(true);
    expect(isReminderStep(t1, 2, muvmi, ['Tao'])).toBe(false);
  });

  it('S10: the Tier 1 ack box says §14.1’s sentence', () => {
    const t1 = {
      id: 'p1',
      key: 't1' as const,
      severity: 'down' as const,
      tier: 1,
      steps: [
        ...down(1).steps,
        { level: 2, delayMin: 30, targets: ['ceo' as const], channels: ['chat' as const, 'email' as const] },
        {
          level: 3,
          delayMin: 60,
          targets: ['ceo' as const, 'site_am' as const],
          channels: ['chat' as const],
          fyi: true,
        },
      ],
    };
    const HOURS = { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5], holidays: new Set<string>() };
    expect(ackCase(t1, muvmi, HOURS, new Date('2026-09-25T02:48:41Z'))).toEqual({
      label: 'If Arm acknowledges at 10:07',
      body: 'Acknowledged by Arm → L1–L2 stopped. If MuvMi is still down at 10:48, CEO + Bua get an FYI (no call).',
    });
  });

  it('L1 leaves out whoever L0 already told (the Admin who owns the site)', () => {
    expect(stepNames(down(2).steps, 1, orca, ['Tao'])).toEqual(['Nok']);
    expect(stepNames(down(1).steps, 1, muvmi, ['Tao'])).toEqual(['Ploy', 'Tao']);
  });

  it('MuvMi DOWN at 09:48 on a weekday: L0 09:48, L1 10:03', () => {
    expect(scenario(down(1), muvmi, ['Tao'], hours, bkk('2026-09-25T09:48:00'))).toEqual({
      caseLine: 'MuvMi DOWN confirmed now, nobody acknowledges:',
      rows: [
        { at: '09:48', level: 0, what: 'L0 → Arm + Alerts Space', danger: false },
        { at: '10:03', level: 1, what: 'L1 → Ploy + Tao', danger: false },
        { at: '10:18', what: 'Reminder in the thread (every 15 min)', muted: true },
      ],
    });
  });

  it('a Tier 2 DOWN at Thu 22:14: paused until Fri 09:00, L1 Fri 09:15', () => {
    const s = scenario(down(2), orca, ['Tao'], hours, bkk('2026-09-24T22:14:00'));
    expect(s.caseLine).toBe(
      'ORCA Thailand DOWN confirmed now (outside response hours), nobody acknowledges:',
    );
    expect(s.rows).toEqual([
      { at: '22:14', level: 0, what: 'L0 → Tao + Alerts Space · timers paused', danger: false },
      { at: 'Fri 09:00', what: 'Response hours start · timers run', muted: true },
      { at: 'Fri 09:15', level: 1, what: 'L1 → Nok', danger: false },
      { at: 'Fri 09:30', what: 'Reminder in the thread (every 15 min)', muted: true },
    ]);
  });

  it('a Tier 2 PROBLEM at night is held, L0 included, until the opening (spec §7, D-034)', () => {
    const problem: PolicyDraft = {
      id: 'pp',
      key: 'problem',
      severity: 'problem',
      tier: null,
      steps: [
        { level: 0, delayMin: 0, targets: ['owner'], channels: ['chat', 'space', 'email'] },
        { level: 1, delayMin: 60, targets: ['backup'], channels: ['chat', 'email'] },
      ],
    };
    expect(
      scenario(problem, orca, ['Tao'], hours, bkk('2026-09-24T22:14:00'), { reminderMin: 60 }).rows,
    ).toEqual([
      {
        at: 'Fri 09:00',
        level: 0,
        what: 'L0 → Tao + Alerts Space (held until response hours)',
        danger: false,
      },
      { at: 'Fri 10:00', level: 1, what: 'L1 → Nok', danger: false },
      // The +60 reminder is L1's minute, so the first one is +120 (D-034 over the board's +60).
      { at: 'Fri 11:00', what: 'Reminder in the thread (every 60 min)', muted: true },
    ]);
  });

  it('a step with no channel notifies nobody', () => {
    const p = down(1);
    p.steps[1] = { ...p.steps[1]!, channels: [] };
    expect(scenario(p, muvmi, ['Tao'], hours, bkk('2026-09-25T09:48:00')).rows[1]).toEqual({
      at: '10:03',
      level: 1,
      what: 'L1 → notifies nobody (no channel ticked)',
      danger: true,
    });
  });

  it('a Tier 2 DOWN at Fri 17:50: the timers pause at 18:00 and L1 comes Mon 09:05', () => {
    expect(scenario(down(2), orca, ['Tao'], hours, bkk('2026-09-25T17:50:00')).rows).toEqual([
      { at: '17:50', level: 0, what: 'L0 → Tao + Alerts Space', danger: false },
      { at: '18:00', what: 'Response hours end · timers paused', muted: true },
      { at: 'Mon 09:00', what: 'Response hours start · timers run', muted: true },
      { at: 'Mon 09:05', level: 1, what: 'L1 → Nok', danger: false },
      { at: 'Mon 09:20', what: 'Reminder in the thread (every 15 min)', muted: true },
    ]);
  });

  it('with no site to resolve for, the steps name their role tokens', () => {
    const s = scenario(down(1), undefined, ['Tao'], hours, bkk('2026-09-25T09:48:00'));
    expect(s.caseLine).toBe('A site DOWN confirmed now, nobody acknowledges:');
    expect(s.rows.map((r) => r.what)).toEqual([
      'L0 → Owner + Alerts Space',
      'L1 → Backup + Admin (Tao)',
      'Reminder in the thread (every 15 min)',
    ]);
  });

  it('a reminder due before a late L1 comes first', () => {
    const p = down(1);
    p.steps[1] = { ...p.steps[1]!, delayMin: 45 };
    expect(scenario(p, muvmi, ['Tao'], hours, bkk('2026-09-25T09:48:00')).rows.map((r) => r.at)).toEqual([
      '09:48',
      '10:03',
      '10:33',
    ]);
  });

  it('says why a step reaches nobody: already told, or no backup set (S08 /verify)', () => {
    const solo = { ...muvmi, owner: 'Tao', backup: null };
    const rows = scenario(down(1), solo, ['Tao'], hours, bkk('2026-09-25T09:48:00')).rows;
    expect(rows[1]?.what).toBe('L1 → nobody new (already told · no backup set)');
    const problem: PolicyDraft = {
      ...down(1),
      key: 'problem',
      severity: 'problem',
      tier: null,
      steps: [down(1).steps[0]!, { ...down(1).steps[1]!, delayMin: 60, targets: ['backup'] }],
    };
    expect(
      scenario(problem, solo, ['Tao'], hours, bkk('2026-09-25T09:48:00'), { reminderMin: 60 }).rows[1]?.what,
    ).toBe('L1 → nobody (no backup set)');
    expect(nobodyWhy(down(1).steps[1]!, { ...muvmi, owner: 'Ploy' }, ['Tao'])).toBe(
      'nobody new (already told)',
    );
  });

  it('a policy covers its tier; PROBLEM covers all', () => {
    expect(sitesOf(down(2), [muvmi, orca])).toEqual([orca]);
    expect(
      sitesOf({ ...down(1), tier: null, key: 'problem', severity: 'problem' }, [muvmi, orca]),
    ).toHaveLength(2);
  });
});
