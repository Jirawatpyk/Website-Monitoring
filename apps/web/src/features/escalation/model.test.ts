import type { EscalationStep } from '@dxt/shared';
import { describe, expect, it } from 'vitest';
import {
  affectedPolicies,
  affectsLine,
  canAdd,
  delayCheck,
  describeStep,
  diff,
  newStep,
  policyMessage,
  reminderError,
  saveProblems,
  saveWarnings,
  stepErrors,
  toSaveInput,
  unsavedSummary,
  type EscalationDraft,
  type PolicyDraft,
} from './model';

const l0: EscalationStep = {
  level: 0,
  delayMin: 0,
  targets: ['owner'],
  channels: ['chat', 'space', 'email'],
};
const l1 = (over: Partial<EscalationStep> = {}): EscalationStep => ({
  level: 1,
  delayMin: 15,
  targets: ['backup', 'admins'],
  channels: ['chat', 'email'],
  ...over,
});
const t1 = (steps: EscalationStep[] = [l0, l1()]): PolicyDraft => ({
  id: 'p1',
  key: 't1',
  severity: 'down',
  tier: 1,
  steps,
});
const problem = (steps: EscalationStep[]): PolicyDraft => ({
  id: 'pp',
  key: 'problem',
  severity: 'problem',
  tier: null,
  steps,
});
const draft = (policies: PolicyDraft[], downReminder = '15', problemReminder = '60'): EscalationDraft => ({
  policies,
  downReminder,
  problemReminder,
});

describe('stepErrors — the board’s guardrails (spec §14.7, §15.5)', () => {
  it.each([
    ['the seed passes', l1(), []],
    ['under +15 min', l1({ delayMin: 10 }), ['Must be at least +15 min.']],
    ['no channel', l1({ channels: [] }), ['No channel ticked — this step notifies nobody.']],
    ['nobody', l1({ targets: [] }), ['Pick at least one person.']],
    [
      'not later than L0 (+0)',
      l1({ delayMin: 0 }),
      ['Must be at least +15 min.', 'Must be later than L0 (+0 min).'],
    ],
  ])('%s', (_case, step, want) => {
    expect(stepErrors([l0, step], 1)).toEqual(want);
  });
});

describe('policyMessage', () => {
  it('a DOWN policy without a step after L0 blocks the save', () => {
    expect(policyMessage(t1([l0]))).toEqual({
      tone: 'danger',
      text: 'Tier 1 DOWN needs at least one step after L0 — otherwise nobody else is ever told.',
    });
  });
  it('PROBLEM without one only warns', () => {
    expect(policyMessage(problem([l0]))?.tone).toBe('warning');
    expect(saveWarnings(draft([problem([l0])]))).toHaveLength(1);
    expect(saveProblems(draft([problem([l0])]))).toEqual([]);
  });
});

describe('saveProblems — the save dialog’s list', () => {
  it('names the policy, the level and its delay', () => {
    expect(saveProblems(draft([t1([l0, l1({ delayMin: 10 })])]))).toEqual([
      'Tier 1 DOWN · L1 (+10 min): Must be at least +15 min.',
    ]);
  });
  it('refuses a reminder that isn’t whole minutes', () => {
    expect(saveProblems(draft([t1()], 'x'))).toEqual([
      'DOWN reminder: “x” isn’t valid — enter whole minutes above 0.',
    ]);
    expect(reminderError('0')).toBe('Whole minutes above 0, e.g. 15');
    expect(reminderError('15')).toBeNull();
  });
});

describe('diff and the unsaved bar', () => {
  it('lists each changed level and the reminders', () => {
    const rows = diff(draft([t1()]), draft([t1([l0, l1({ delayMin: 20 })])], '10'));
    expect(rows).toEqual([
      {
        where: 'Tier 1 DOWN · L1',
        before: '+15 min · Backup + Admin · Chat @mention, Email',
        after: '+20 min · Backup + Admin · Chat @mention, Email',
      },
      { where: 'DOWN reminder', before: 'every 15 min', after: 'every 10 min' },
    ]);
    expect(unsavedSummary(rows)).toEqual({
      label: '2 unsaved changes',
      hint: 'In Tier 1 DOWN · Reminder interval',
    });
  });
  it('a removed step reads "Removed"; nothing changed is no bar', () => {
    expect(diff(draft([problem([l0, l1()])]), draft([problem([l0])]))[0]?.after).toBe('Removed');
    expect(unsavedSummary([])).toBeNull();
  });
});

describe('delayCheck — the edit dialog', () => {
  it.each([
    ['L0 is pinned', '0', 0, { error: null, hint: 'Pinned — fires immediately.' }],
    ['not a number', '4x', 1, { error: 'Enter whole minutes, e.g. 45', hint: null }],
    ['under 15', '10', 1, { error: 'At least +15 min — L0 covers the first 15 minutes', hint: null }],
    ['fine', '20', 1, { error: null, hint: null }],
  ])('%s', (_case, value, i, want) => {
    expect(delayCheck(value, [l0, l1()], i)).toEqual(want);
  });
});

describe('the rest', () => {
  it('describes a step', () => {
    expect(describeStep(l0)).toBe('+0 · Owner · Chat @mention, Alerts Space, Email');
  });
  it('affects line, as the board', () => {
    expect(affectsLine(5, [142])).toBe(
      'Affects 5 sites · 1 open incident (INC-0142) keeps its current timers',
    );
    expect(affectsLine(9, [])).toBe('Affects 9 sites · no open incidents');
    expect(affectsLine(17, [141, 142])).toBe(
      'Affects 17 sites · 2 open incidents (INC-0141, INC-0142) keep their current timers',
    );
  });
  it('adds an L1 only when there is none (L2+ is S10)', () => {
    expect(canAdd(problem([l0]))).toBe(true);
    expect(canAdd(t1())).toBe(false);
    expect(newStep(problem([l0]))).toEqual({
      level: 1,
      delayMin: 30,
      targets: [],
      channels: ['chat', 'email'],
    });
  });
  it('a reminder change affects every policy of that severity; only changed steps are sent', () => {
    const saved = draft([t1(), problem([l0, l1({ delayMin: 60 })])]);
    const changed = { ...saved, downReminder: '10' };
    expect(affectedPolicies(saved, changed).map((p) => p.key)).toEqual(['t1']);
    expect(toSaveInput(changed, 'x', saved).policies).toEqual([]);
    const edited = draft([t1([l0, l1({ delayMin: 20 })]), problem([l0, l1({ delayMin: 60 })])]);
    expect(toSaveInput(edited, 'x', saved).policies.map((p) => p.policyId)).toEqual(['p1']);
  });
  it('builds the save input', () => {
    expect(toSaveInput(draft([t1()]), 'why')).toEqual({
      policies: [{ policyId: 'p1', steps: [l0, l1()] }],
      downReminderMin: 15,
      problemReminderMin: 60,
      note: 'why',
    });
  });
});
