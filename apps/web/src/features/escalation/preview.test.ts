import { describe, expect, it } from 'vitest';
import type { PolicyDraft } from './model';
import { scenario, sitesOf, stepNames, tokenRows } from './preview';

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
    ]);
    expect(tokenRows({ ...muvmi, am: null }, [])[3]).toEqual({ token: 'Site AM', name: '— (internal)' });
  });

  it('L1 leaves out whoever L0 already told (the Admin who owns the site)', () => {
    expect(stepNames(down(2).steps, 1, orca, ['Tao'])).toEqual(['Nok']);
    expect(stepNames(down(1).steps, 1, muvmi, ['Tao'])).toEqual(['Ploy', 'Tao']);
  });

  it('MuvMi DOWN at 09:48 on a weekday: L0 09:48, L1 10:03', () => {
    expect(scenario(down(1), muvmi, ['Tao'], hours, bkk('2026-09-25T09:48:00'))).toEqual({
      caseLine: 'MuvMi DOWN confirmed now, nobody acknowledges:',
      rows: [
        { at: '09:48', what: 'L0 → Arm + Alerts Space', danger: false },
        { at: '10:03', what: 'L1 → Ploy + Tao', danger: false },
      ],
    });
  });

  it('a Tier 2 DOWN at Thu 22:14: paused until Fri 09:00, L1 Fri 09:15', () => {
    const s = scenario(down(2), orca, ['Tao'], hours, bkk('2026-09-24T22:14:00'));
    expect(s.caseLine).toBe(
      'ORCA Thailand DOWN confirmed now (outside response hours), nobody acknowledges:',
    );
    expect(s.rows).toEqual([
      { at: '22:14', what: 'L0 → Tao + Alerts Space · timers paused', danger: false },
      { at: 'Fri 09:00', what: 'Response hours start · timers run', muted: true },
      { at: 'Fri 09:15', what: 'L1 → Nok', danger: false },
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
    expect(scenario(problem, orca, ['Tao'], hours, bkk('2026-09-24T22:14:00')).rows).toEqual([
      { at: 'Fri 09:00', what: 'L0 → Tao + Alerts Space (held until response hours)', danger: false },
      { at: 'Fri 10:00', what: 'L1 → Nok', danger: false },
    ]);
  });

  it('a step with no channel notifies nobody', () => {
    const p = down(1);
    p.steps[1] = { ...p.steps[1]!, channels: [] };
    expect(scenario(p, muvmi, ['Tao'], hours, bkk('2026-09-25T09:48:00')).rows[1]).toEqual({
      at: '10:03',
      what: 'L1 → notifies nobody (no channel ticked)',
      danger: true,
    });
  });

  it('a policy covers its tier; PROBLEM covers all', () => {
    expect(sitesOf(down(2), [muvmi, orca])).toEqual([orca]);
    expect(
      sitesOf({ ...down(1), tier: null, key: 'problem', severity: 'problem' }, [muvmi, orca]),
    ).toHaveLength(2);
  });
});
